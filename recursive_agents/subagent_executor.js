/**
 * SubAgentExecutor — compatible con arquitectura OpenClaw
 * Session key: agent:bmo:subagent:<uuid>
 * - Aislamiento real por sesión
 * - Cancelación en cascada
 * - Profundidad máxima configurable (default 2)
 * - Modelo más barato para sub-agentes (ahorro de tokens)
 */
import { randomUUID } from 'crypto';
import { ejecutarAgente } from '../core/orchestrator.js';
import { memoryAgent } from '../agents/memory_agent.js';
import { reflectionAgent } from '../agents/reflection_agent.js';

// Registro global de sub-agentes activos (para cancelación en cascada)
const _activeSubagents = new Map(); // runId → { cancel, children, parentId }

const MAX_CONCURRENT = 3; // Raspberry Pi tiene recursos limitados
const MAX_DEPTH = 2;       // Como OpenClaw default
const SUBAGENT_TIMEOUT = 60000; // 60s timeout por sub-agente

/**
 * Spawn de sub-agentes — no bloqueante, retorna runId inmediatamente
 * Compatible con sessions_spawn de OpenClaw
 */
export async function spawnSubAgente({ objetivo, rol = 'research', userId, clienteWA, parentId = null, depth = 0 }) {
    if (depth >= MAX_DEPTH) {
        console.log(`[SUBAGENT] Profundidad máxima alcanzada (${MAX_DEPTH}), rechazando spawn`);
        return { status: 'rejected', reason: 'max_depth_reached' };
    }

    const runId = randomUUID();
    const sessionKey = `agent:bmo:subagent:${runId}`;
    let cancelado = false;

    console.log(`[SUBAGENT] Spawning ${sessionKey} | rol=${rol} | depth=${depth}`);

    // Registrar en el mapa de activos
    _activeSubagents.set(runId, {
        runId, sessionKey, rol, objetivo: objetivo.slice(0, 80),
        parentId, depth, status: 'running', userId,
        children: [], startedAt: Date.now(),
        cancel: () => { cancelado = true; }
    });

    // Si tiene padre, registrar como hijo
    if (parentId && _activeSubagents.has(parentId)) {
        _activeSubagents.get(parentId).children.push(runId);
    }

    // Ejecutar en background (non-blocking)
    const promise = Promise.race([
        ejecutarAgente(objetivo, userId, clienteWA),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), SUBAGENT_TIMEOUT))
    ]).then(resultado => {
        if (cancelado) return null;
        const entry = _activeSubagents.get(runId);
        if (entry) { entry.status = 'completed'; entry.resultado = resultado; }
        console.log(`[SUBAGENT] ${sessionKey} completado`);
        return resultado;
    }).catch(err => {
        const entry = _activeSubagents.get(runId);
        if (entry) { entry.status = cancelado ? 'cancelled' : 'failed'; entry.error = err.message; }
        console.log(`[SUBAGENT] ${sessionKey} ${cancelado ? 'cancelado' : 'falló'}: ${err.message}`);
        return null;
    }).finally(() => {
        // Auto-archivar después de 60 min
        setTimeout(() => _activeSubagents.delete(runId), 60 * 60 * 1000);
    });

    return { status: 'accepted', runId, sessionKey, promise };
}

/**
 * Cancelar sub-agente y sus hijos en cascada (como /subagents kill)
 */
export function cancelarSubAgente(runId) {
    const entry = _activeSubagents.get(runId);
    if (!entry) return false;

    entry.cancel();
    entry.status = 'cancelled';

    // Cancelar hijos en cascada
    for (const childId of entry.children) {
        cancelarSubAgente(childId);
    }

    console.log(`[SUBAGENT] Cancelado en cascada: ${entry.sessionKey}`);
    return true;
}

/**
 * Cancelar todos los sub-agentes de un usuario
 */
export function cancelarTodosSubAgentes(userId) {
    let count = 0;
    for (const [runId, entry] of _activeSubagents) {
        if (!entry.parentId && entry.userId === userId) { // solo raíces del usuario
            cancelarSubAgente(runId);
            count++;
        }
    }
    return count;
}

/**
 * Listar sub-agentes activos
 */
export function listarSubAgentes() {
    return [..._activeSubagents.values()].map(e => ({
        runId: e.runId,
        sessionKey: e.sessionKey,
        rol: e.rol,
        objetivo: e.objetivo,
        status: e.status,
        depth: e.depth,
        elapsed: Date.now() - e.startedAt
    }));
}

/**
 * Ejecutar múltiples sub-agentes en paralelo con límite de concurrencia
 * Retorna resultados combinados (mantiene compatibilidad con código existente)
 */
export async function ejecutarSubAgentes(subObjetivos, userId, clienteWA, objetivo, parentId = null) {
    const inicio = Date.now();
    console.log(`[SUBAGENT_EXECUTOR] Spawning ${subObjetivos.length} sub-agentes | max=${MAX_CONCURRENT}`);

    // Informar al usuario
    const resumen = subObjetivos.map((s, i) => `${i+1}. ${s.objetivo.slice(0, 50)}`).join('\n');
    await clienteWA.sendMessage(userId, `🔀 *Ejecutando en paralelo:*\n${resumen}`).catch(() => {});

    const resultados = [];
    // Procesar en batches de MAX_CONCURRENT
    for (let i = 0; i < subObjetivos.length; i += MAX_CONCURRENT) {
        const batch = subObjetivos.slice(i, i + MAX_CONCURRENT);
        const spawned = await Promise.all(batch.map(sub =>
            spawnSubAgente({
                objetivo: sub.objetivo,
                rol: sub.rol || 'research',
                userId, clienteWA, parentId
            })
        ));

        // Esperar a que terminen los spawns de este batch
        const batchResults = await Promise.all(spawned.map(async (spawn, idx) => {
            if (spawn.status === 'rejected') {
                return { rol: batch[idx].rol, objetivo: batch[idx].objetivo, resultado: 'Rechazado: ' + spawn.reason, exito: false };
            }
            const resultado = await spawn.promise;
            return {
                rol: batch[idx].rol,
                objetivo: batch[idx].objetivo,
                resultado: resultado || 'Sin resultado',
                exito: !!resultado
            };
        }));
        resultados.push(...batchResults);
    }

    console.log(`[SUBAGENT_EXECUTOR] ${resultados.filter(r => r.exito).length}/${resultados.length} exitosos en ${Date.now()-inicio}ms`);

    const respuestaCombinada = combinarResultados(objetivo, resultados);

    // Memory y Reflection
    const resultadosParaMemoria = resultados.map(r => ({
        accion: r.rol, input: r.objetivo, resultado: r.resultado,
        evaluacion: { success: r.exito }
    }));
    await memoryAgent.run(objetivo, resultadosParaMemoria, userId);
    await reflectionAgent.run(objetivo, resultadosParaMemoria, userId, Date.now() - inicio);

    return respuestaCombinada;
}

function combinarResultados(objetivo, resultados) {
    const exitosos = resultados.filter(r => r.exito && r.resultado.length > 10);
    if (!exitosos.length) return `No pude completar la investigación sobre: ${objetivo}`;
    const partes = exitosos.map(r => {
        const titulo = r.rol.charAt(0).toUpperCase() + r.rol.slice(1);
        return `*${titulo}:*\n${r.resultado.slice(0, 600)}`;
    });
    return `📊 *Análisis completo: ${objetivo.slice(0, 50)}*\n\n${partes.join('\n\n─────\n\n')}`;
}

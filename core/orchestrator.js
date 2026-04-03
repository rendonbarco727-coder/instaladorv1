import { EventEmitter } from 'events';
export const bmoEvents = new EventEmitter();
import { activeDocuments } from "./document_state.js";
import { ejecutarLoop } from './agent_loop.js';
let _emitirEvento = null;
try {
    const { emitirEvento } = await import('../bmo_endpoint.js').catch(() => ({}));
    _emitirEvento = emitirEvento || null;
} catch(e) {}
const emitir = (tipo, datos) => { try { _emitirEvento?.(tipo, datos); } catch(e) {} };
import { managerAgent } from '../agents/manager_agent.js';
import { detectIntent } from './intent_router.js';
import { ejecutarTool } from '../tools/tool_registry.js';
import { actualizarDesdeResultado } from '../world_model/world_model.js';
import { EpisodicMemory } from '../memory/episodic_memory.js';
const _episodic = new EpisodicMemory();
import { estadoCache, limpiarCacheVieja } from '../reasoning_cache/cache.js';
import { autoDescubrirSkills } from '../skills/skill_registry.js';

// Auto-descubrir skills al iniciar
autoDescubrirSkills();

import { iniciarScheduler } from './scheduler.js';

export function registrarClienteScheduler(client, userId) {
    iniciarScheduler(client, userId);
}

export async function ejecutarAgente(objetivo, userId, clienteWA) {
    console.log('[ORQUESTADOR] Iniciando:', objetivo.slice(0, 80));
    bmoEvents.emit('action', { type: 'INIT', data: objetivo });

    try {
        // Intent Router — clasificar antes de activar agentes
        const intent = await detectIntent(objetivo);
        console.log(`[ORQUESTADOR] Intent: ${intent.type}${intent.tool ? '/' + intent.tool : ''}`);

        // Tool directo — sin planner ni manager
        if (intent.type === 'tool' && intent.tool) {
            const resultado = await ejecutarTool(intent.tool, intent.input || objetivo, {});
            await clienteWA.sendMessage(userId, resultado).catch(() => {});
            return resultado;
        }

        // Saludo simple
        if (intent.type === 'simple' && intent.response) {
            const msg = intent.response();
            await clienteWA.sendMessage(userId, msg).catch(() => {});
            return msg;
        }

        // Scheduler — dejar que index.js lo maneje (ya tiene handler)
        if (intent.type === 'scheduler') {
            return null;
        }

        // Meta-cognición: evaluar si necesitamos aclaración
        try {
            const { metacognitionAgent } = await import('../agents/metacognition_agent.js');
            const { getShortTerm } = await import('../memory/memory_manager.js');
            const historial = getShortTerm ? getShortTerm(userId, 3) : [];
            const meta = await metacognitionAgent.evaluate(objetivo, { historial });
            if (meta.necesito_ayuda && meta.confianza < 50 && meta.pregunta_aclaratoria) {
                console.log(`[METACOG] Confianza baja (${meta.confianza}%), pidiendo aclaración`);
                await clienteWA.sendMessage(userId, `🤔 ${meta.pregunta_aclaratoria}`);
                return null;
            }
        } catch(e) { /* metacognición no crítica */ }

        // Manager decide estrategia
        const decision = await managerAgent.decidir(objetivo, userId);

        // Log de cache stats ocasionalmente
        if (Math.random() < 0.1) {
            const cache = estadoCache();
            console.log(`[ORQUESTADOR] Cache: ${cache.total} entradas, ${cache.hits} hits`);
            if (cache.total > 400) limpiarCacheVieja();
        }

        // Ejecutar loop con la estrategia decidida
        const activeDoc = activeDocuments.get(userId) || null;
        const resultado = await ejecutarLoop(objetivo, userId, clienteWA, 0, decision, { active_document: activeDoc });
        // Guardar episodio en memoria a largo plazo (solo si fue significativo)
        if (objetivo.length > 30 && !objetivo.startsWith('[AUTO]')) {
            const textoEpisodio = `Tarea: ${objetivo.slice(0,150)} | Resultado: ${String(resultado).slice(0,150)}`;
            _episodic.saveEpisode(userId, textoEpisodio, { objetivo, fecha: new Date().toLocaleDateString('es-MX') }).catch(() => {});
        }
        return resultado;
    } catch(e) {
        console.error('[ORQUESTADOR] Error crítico:', e.message);
        console.error('[ORQUESTADOR] Stack:', e.stack?.split('\n').slice(0,5).join(' | '));
        await clienteWA.sendMessage(userId, 'Tuve un error procesando tu solicitud.').catch(() => {});
        return null;
    }
}

import { ROOT_DIR } from '../config/bmo.config.js';
import { transformarResultadoTool, podarContexto } from './context_pruner.js';
import { plannerAgent } from '../agents/planner_agent.js';
import { researchAgent } from '../agents/research_agent.js';
import { executorAgent } from '../agents/executor_agent.js';
import { criticAgent } from '../agents/critic_agent.js';
import { memoryAgent } from '../agents/memory_agent.js';
import { reflectionAgent } from '../agents/reflection_agent.js';
import { saveShortTerm, saveLongTerm } from '../memory/memory_manager.js';
import { activeDocuments } from './document_state.js';
import { iniciarTareaGlobal, actualizarProgreso, finalizarTareaGlobal } from './session_state.js';
import {
    crearTareasDesdePlan, obtenerSiguienteTarea,
    iniciarTarea, completarTarea, fallarTarea,
    existeTareaDuplicada, estadoSesion, limpiarTareasViejas
} from '../tasks/task_manager.js';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
const _db = new Database(`${ROOT_DIR}/memory/bmo_memory.db`);
import { crearContexto, setDato, getDato, getResumen, agregarMensaje, limpiarContexto } from '../agents/sub_agent_context.js';
import { managerAgent } from '../agents/manager_agent.js';
import { ReinforcementLearning } from '../memory/reinforcement_learning.js';

const rl = new ReinforcementLearning();
import { actualizarDesdeResultado } from '../world_model/world_model.js';
import { detectarTemasFrecuentes, detectarHuecosConocimiento } from '../autonomy/curiosity_engine.js';
import { generarGoalsDesdeHuecos } from '../autonomy/goal_generator.js';
import { detectarYAprender } from '../self_improvement/tool_learner.js';
import { emitirEvento as _sseEmit } from "./sse_emitter.js";
import { checkCancelled, clearCancelSignal } from './cancel_signal.js';
const sseEmit = (t,d) => { try { _sseEmit?.(t,d); } catch(e) {} };

const MAX_ITERACIONES = 6;
const MAX_PASOS = 8;
const MAX_RETRIES_POR_PASO = 3;

function inyectarResultados(input, resultados) {
    let r = String(input || '');
    resultados.forEach((res, i) => {
        const val = String(res.resultado || '');
        r = r.replace(`RESULTADO_${i+1}`, val);
        r = r.replace(`{{RESULTADO_${i+1}}}`, val);
    });
    return r;
}

export async function ejecutarLoop(objetivo, userId, clienteWA, iteracion = 0, decision = null, ctxExtra = {}) {
    if (iteracion >= MAX_ITERACIONES) {
        console.log('[LOOP] Máximo de iteraciones alcanzado');
        return 'Alcancé el límite de intentos para esta tarea.';
    }

    const inicio = Date.now();
    const sesion_id = `sesion_${randomUUID().slice(0,8)}`;
    console.log(`[LOOP] Iteracion ${iteracion+1} | sesion=${sesion_id}`);

    // Recuperar documento activo de sesión anterior
    let activeDoc = null;
    try {
        const row = _db.prepare("SELECT content FROM short_term WHERE userId=? AND (content LIKE '/tmp/bmo_doc_%.docx' OR content LIKE '/tmp/hoja_bmo_%.xlsx' OR content LIKE '/tmp/bmo_%.pptx') ORDER BY timestamp DESC LIMIT 1").get(userId);
        if (row?.content) {
            const { existsSync } = await import('fs');
            if (existsSync(row.content)) {
                activeDoc = row.content;
                console.log(`[LOOP] Recuperado active_document: ${activeDoc}`);
            }
        }
    } catch(e) {}
    const ctx = { userId, clienteWA, objetivo, sesionId: sesion_id, active_document: ctxExtra.active_document || activeDoc };

    saveShortTerm(userId, 'user', objetivo);
    if (Math.random() < 0.2) limpiarTareasViejas();

    // RECURSIVE PLANNING — si la tarea es compleja usar sub-agentes
    if (iteracion === 0 && decision?.usarRecursivo) {
        console.log('[LOOP] Usando recursive planning');
        const respRecursiva = await managerAgent.ejecutarRecursivo(objetivo, userId, clienteWA);
        if (respRecursiva) {
            if (clienteWA && userId) try { await clienteWA.sendMessage(userId, respRecursiva); } catch(e) {};
            return null;
        }
    }

    // 1. CONTEXT COMPACTION — flush preventivo si historial se acerca al límite
    if (iteracion === 0) {
        try {
            const { necesitaCompactar, flushContextoAntesDePoda, leerMemoryMd } = await import('./context_compaction.js');
            const { getHistorial } = await import('./session_history.js');
            const hist = getHistorial(userId);
            if (necesitaCompactar(hist)) {
                console.log(`[COMPACTION] Flush preventivo para ${userId} (${hist.length} msgs)`);
                await flushContextoAntesDePoda(userId, hist);
            }
            // Inyectar MEMORY.md en ctx si existe
            const memoryMd = leerMemoryMd();
            if (memoryMd) ctx.memory_md = memoryMd.slice(-3000);
        } catch(e) { console.log('[COMPACTION] Error en flush preventivo:', e.message); }
    }

    // 1. PLANNER AGENT
    const pasos = await plannerAgent.run(objetivo, userId, ctx);
    if (!pasos?.length) return 'No pude crear un plan para esta tarea.';
    // Registrar estado global de la tarea
    iniciarTareaGlobal(userId, objetivo, pasos);

    // Mostrar plan al usuario
    if (pasos.length > 1 && iteracion === 0) {
        const planTexto = pasos.map((p, i) => `${i+1}. ${p.descripcion || p.accion}`).join('\n');
        try { if (clienteWA?.sendMessage) await clienteWA.sendMessage(userId, `*Plan:*\n${planTexto}`); } catch(e) {}
    }

    // Registrar tareas en Task Manager
    const planParaTM = pasos.map(p => ({ ...p, herramienta: p.accion }));
    crearTareasDesdePlan(planParaTM, userId, sesion_id);

    // 2. RESEARCH AGENT - pre-búsqueda si se necesita
    const datosResearch = await researchAgent.run(objetivo, pasos, ctx);
    if (datosResearch) console.log(`[LOOP] Research completado: ${Object.keys(datosResearch).length} resultados`);

    const resultados = [];
    let fallosConsecutivos = 0;
    const contextoCompartido = {}; // Contexto compartido entre pasos del mismo loop
    const ctxSesion = crearContexto(sesion_id);
    let pasoIndex = 0;

    // 3. EXECUTOR LOOP con CRITIC
    while (pasoIndex < Math.min(pasos.length, MAX_PASOS)) {
        const tarea = obtenerSiguienteTarea(sesion_id);
        if (!tarea) break;

        // Construir paso con resultados inyectados
        const paso = { ...pasos[pasoIndex] };
        paso.input = inyectarResultados(paso.input, resultados);
        // Si enviar_mensaje recibe raw de búsqueda, usar el último generar_contenido disponible
        if (paso.accion === 'enviar_mensaje' && String(paso.input).startsWith('📄')) {
            const contenidoGenerado = resultados.filter(r => r.accion === 'generar_contenido').pop()?.resultado;
            if (contenidoGenerado) paso.input = contenidoGenerado;
        }
        // Generar thought automático si el LLM no lo generó
        if (!paso.thought) {
            const thoughtMap = {
                buscar_web: 'Buscando información actualizada en internet',
                buscar_web_exa: 'Investigando con búsqueda avanzada',
                buscar_clima: 'Consultando el clima en tiempo real',
                buscar_precio: 'Obteniendo precio actual del mercado',
                generar_contenido: 'Procesando y redactando respuesta',
                enviar_mensaje: 'Enviando respuesta al usuario',
                crear_documento_writer: 'Creando documento Word',
                crear_excel: 'Generando hoja de cálculo',
                github_manager: 'Gestionando repositorio en GitHub',
                web_project_builder: 'Construyendo proyecto web',
                code_agent: 'Analizando y generando código',
                check_system_health: 'Revisando estado del sistema',
                memory_search: 'Consultando memoria de conversaciones',
                ejecutar_codigo: 'Ejecutando código en el Pi',
            };
            paso.thought = thoughtMap[paso.accion] || `Ejecutando ${paso.accion}`;
        }

        // Verificar cancelación antes de ejecutar el paso
        if (checkCancelled(userId)) {
            clearCancelSignal(userId);
            console.log(`[LOOP] Cancelado por usuario en paso ${paso.accion}`);
            return '❌ Proceso cancelado.';
        }

        console.log(`[LOOP] paso=${paso.accion} input=${String(paso.input).slice(0,80)} resultados=${resultados.length}`);
        sseEmit('paso', { accion: paso.accion, input: String(paso.input).slice(0,100), descripcion: paso.descripcion, thought: paso.thought, indice: pasoIndex+1, total: pasos.length });
        // CoT en WhatsApp — solo si el paso tiene thought y es el primero
        if (paso.thought && pasoIndex === 0 && ctx?.clienteWA && ctx?.userId) {
            try { await ctx.clienteWA.sendMessage(ctx.userId, `🤔 _${paso.thought}_`); } catch(e) {}
        }

        // Si research ya tiene el resultado, usarlo directamente sin re-ejecutar
        if (datosResearch?.[paso.id]) {
            const resResearch = datosResearch[paso.id];
            if (resResearch && !resResearch.startsWith('Error') && resResearch.length > 5) {
                // Búsquedas simples: usar research directo sin critic
                const esBusqueda = ['buscar_web_exa','buscar_web','buscar_clima','ejecutar_terminal','check_system_health'].includes(paso.accion);
                const esWebMexico = paso.accion === 'buscar_web' && /m[eé]xico|mexicano/i.test(paso.input);
                const yaEjecutadoExa = ctx._exaUsado?.has(paso.id);
                if (esBusqueda && !esWebMexico && !yaEjecutadoExa) {
                    console.log(`[LOOP] Research directo para ${paso.accion}, omitiendo critic`);
                    resultados.push({ ...paso, resultado: resResearch, evaluacion: { success: true, confianza: 85 }, intentos: 0 });
                    completarTarea(tarea.id, resResearch.slice(0, 500));
                    fallosConsecutivos = 0;
                    rl.recordSuccess(paso.accion, { userId }, 0.85);
                    pasoIndex++;
                    continue;
                }
                // Otras acciones: evaluar con critic
                let evalRes = { success: true, confianza: 75 };
                try {
                    evalRes = await criticAgent.run(paso, { result: resResearch });
                } catch(e) {
                    console.log(`[LOOP] Critic falló para research ${paso.accion}, auto-aprobando`);
                }
                if (evalRes.success) {
                    resultados.push({ ...paso, resultado: resResearch, evaluacion: evalRes, intentos: 0 });
                    completarTarea(tarea.id, resResearch.slice(0, 500));
                    fallosConsecutivos = 0;
                    rl.recordSuccess(paso.accion, { userId }, evalRes.confianza / 100);
                    pasoIndex++;
                    continue;
                }
                // Critic rechazó — self-correction
                if (fallosConsecutivos < 2) {
                    const feedback = evalRes.feedback || 'Resultado insuficiente según el crítico';
                    console.log(`[LOOP] Auto-corrigiendo ${paso.accion}: ${feedback}`);
                    sseEmit('agent_update', { step: pasoIndex, status: 'correcting', message: `Corrigiendo: ${feedback.slice(0,40)}...` });
                    paso.input = `ERROR EN INTENTO PREVIO: ${feedback}. INSTRUCCIÓN ORIGINAL: ${paso.input}`;
                    fallosConsecutivos++;
                    continue;
                }
                // Fallback: inyectar research como contexto
                if (!String(paso.input).includes('RESULTADO_') && !['enviar_mensaje','generar_contenido'].includes(paso.accion)) {
                    paso.input = resResearch;
                }
            }
        }
        // Si crear_documento recibe poco texto, usar contenido generado previo
        if (paso.accion === 'crear_documento' && String(paso.input).length < 60) {
            const previo = resultados.find(r => r.accion === 'generar_contenido')?.resultado;
            if (previo) paso.input = previo;
        }

        // Si editar_documento, siempre pasar: ruta|contenido_real
        if (paso.accion === 'editar_documento') {
            const ruta = ctx.active_document || '';
            // Prioridad: generar_contenido > research > input original
            const contenidoGenerado = resultados.filter(r => r.accion === 'generar_contenido').pop()?.resultado || '';
            const contenidoResearch = datosResearch ? Object.values(datosResearch)[0] || '' : '';
            const contenidoReal = contenidoGenerado || contenidoResearch;
            const inputStr = String(paso.input);
            // Detectar si el input es una instrucción vacía (no contenido real)
            const esInstruccion = /^(agregar|editar|añadir|actualizar|incorporar|incluir)/i.test(inputStr.split('|').slice(1).join('|').trim());
            if (ruta && contenidoReal && (!inputStr.includes('|') || esInstruccion)) {
                paso.input = `${ruta}|${contenidoReal}`;
            } else if (ruta && !inputStr.startsWith('/tmp/')) {
                paso.input = `${ruta}|${inputStr}`;
            } else if (!ruta && contenidoReal) {
                paso.input = contenidoReal;
            }
        }

        // Evitar duplicados
        if (existeTareaDuplicada(tarea.herramienta, tarea.input, userId, sesion_id)) {
            console.log(`[LOOP] Duplicado detectado: ${paso.accion}, saltando`);
            completarTarea(tarea.id, 'duplicado omitido');
            pasoIndex++;
            continue;
        }

        // Avisos al usuario
        const avisos = {
            generar_contenido: 'Generando contenido...',
            buscar_web: 'Buscando información...',
            crear_documento: 'Creando documento...',
            buscar_clima: 'Consultando clima...'
        };
        if (avisos[paso.accion]) {
            try { await clienteWA.sendMessage(userId, avisos[paso.accion]); } catch(e) {};
        }

        iniciarTarea(tarea.id);

        // Reintentos por paso
        let resultado = null;
        let evaluacion = null;
        let intentos = 0;

        while (intentos < MAX_RETRIES_POR_PASO) {
            // EXECUTOR AGENT
            const execResult = await executorAgent.run(paso, ctx);
            resultado = execResult.result || execResult.error || '';
            // tool_result_transform hook (OpenClaw-style)
            if (resultado) resultado = transformarResultadoTool(paso.accion, String(resultado));

            // CRITIC AGENT (circuit breaker: si Ollama falla, auto-aprobar)
            try {
                evaluacion = await criticAgent.run(paso, execResult);
            } catch(e) {
                console.log(`[LOOP] Critic falló (${e.message.slice(0,40)}), auto-aprobando`);
                evaluacion = { success: true, confianza: 70, retry: false, reason: 'Auto-aprobado por fallo de Critic' };
            }
            if (!evaluacion || evaluacion.error) {
                evaluacion = { success: true, confianza: 70, retry: false, reason: 'Auto-aprobado' };
            }
            console.log(`[LOOP] ${paso.accion} intento=${intentos+1} success=${evaluacion.success} confianza=${evaluacion.confianza}%`);

            if (evaluacion.success || !evaluacion.retry) break;
            intentos++;
            if (intentos < MAX_RETRIES_POR_PASO) {
                console.log(`[LOOP] Reintentando: ${evaluacion.reason}`);
                await new Promise(r => setTimeout(r, 800));
            }
        }

        const pasoFinal = { ...paso, resultado, evaluacion, intentos: intentos + 1 };
        resultados.push(pasoFinal);

        if (evaluacion.success) {
            completarTarea(tarea.id, String(resultado).slice(0, 500));
            fallosConsecutivos = 0;
            rl.recordSuccess(paso.accion, { userId }, evaluacion.confianza / 100);
            // Guardar documento activo en contexto de sesión
            // Envío de archivos manejado por enviar_mensaje con ctx
            // Guardar xlsx/pptx en active_document y persistir en memoria
            if (['crear_excel','crear_presentacion','crear_documento_writer'].includes(paso.accion)) {
                if (resultado && resultado.startsWith('/tmp/')) {
                    ctx.active_document = resultado;
                    activeDocuments.set(userId, resultado);
                    saveShortTerm(userId, 'system', resultado);
                    // Registrar en document_manager
                    try {
                        const { registrarDocumento } = await import('./document_manager.js');
                        const tipos = {crear_excel:'xlsx', crear_presentacion:'pptx', crear_documento_writer:'docx'};
                        registrarDocumento(userId, resultado, objetivo.slice(0,60), tipos[paso.accion]||'office');
                    } catch(e) {}
                    console.log(`[LOOP] active_document (office) = ${resultado}`);
                    // Persistir en long_term para sobrevivir reinicios
                    saveLongTerm(userId, 'active_document', resultado, 3);
                }
            }
            if (paso.accion === 'crear_documento') {
                try {
                    // Registrar en document_manager
                    if (resultado && resultado.startsWith('/tmp/')) {
                        try {
                            const { registrarDocumento } = await import('./document_manager.js');
                            registrarDocumento(userId, resultado, objetivo.slice(0,60), 'docx');
                        } catch(e) {}
                    }
                    const match = String(resultado).match(/\/tmp\/bmo_doc_[\w]+\.docx/);
                    if (match) {
                        ctx.active_document = match[0];
                        console.log(`[LOOP] active_document = ${ctx.active_document}`);
                        // Persistir en SQLite para siguiente sesión
                        saveShortTerm(userId, 'system', match[0]);
                    }
                } catch(e) {}
            }
        } else {
            fallarTarea(tarea.id, evaluacion.reason);
            fallosConsecutivos++;
            if (fallosConsecutivos >= 2) {
                // Si el error es irrecuperable (permisos, ruta inválida), no replanificar
                const esIrrecuperable = /permission denied|cannot open|no such file|command not found/i.test(evaluacion.reason);
                if (esIrrecuperable) {
                    console.log('[LOOP] Error irrecuperable, abortando replanificación:', evaluacion.reason);
                    // Invalidar cache para que no repita este error
                    try {
                        const { invalidarCache } = await import('../reasoning_cache/cache.js');
                        invalidarCache(objetivo);
                        console.log('[LOOP] Cache invalidado para:', objetivo.slice(0,50));
                    } catch(e) {}
                    if (clienteWA && userId) {
                        await clienteWA.sendMessage(userId, `❌ ${evaluacion.reason.slice(0, 200)}`);
                    }
                    return '❌ Error irrecuperable, abortando.';
                }
                console.log('[LOOP] 2 fallos consecutivos, replanificando...');
                // Intentar aprender herramienta si la acción no existe
                try {
                    const aprendizaje = await detectarYAprender(paso.accion, `Herramienta para: ${objetivo.slice(0,80)}`);
                    if (aprendizaje?.ok) {
                        console.log(`[LOOP] Tool_learner aprendió: ${paso.accion}`);
                    }
                } catch(e) { console.log('[LOOP] Tool_learner error:', e.message); }
                const nuevoObjetivo = `${objetivo} (corrigiendo: ${evaluacion.reason})`;
                return ejecutarLoop(nuevoObjetivo, userId, clienteWA, iteracion + 1);
            }
        }

        // Enviar mensaje final
        if (paso.accion === 'enviar_mensaje' && resultado) {
            try { await clienteWA.sendMessage(userId, resultado); } catch(e) {};
        }

        pasoIndex++;
    }

    // Resumen sesión
    const sesion = estadoSesion(sesion_id);
    console.log(`[LOOP] Sesion ${sesion_id}: ${sesion.completadas}/${sesion.total} completadas`);

    const duracion = Date.now() - inicio;

    // 4. MEMORY AGENT
    await memoryAgent.run(objetivo, resultados, userId);

    // 5. REFLECTION AGENT
    const reflexion = await reflectionAgent.run(objetivo, resultados, userId, duracion);

    // Guardar respuesta en memoria short-term
    const respFinal = resultados[resultados.length - 1]?.resultado || '';
    if (respFinal) saveShortTerm(userId, 'assistant', String(respFinal).slice(0, 500));

    // Guardar resumen de sesión para memoria histórica
    try {
        const accionesRealizadas = resultados
            .filter(r => r.accion && !['enviar_mensaje','memory_search'].includes(r.accion))
            .map(r => `${r.accion}: ${String(r.resultado||'').slice(0,60)}`)
            .join(' | ');
        if (accionesRealizadas) {
            saveLongTerm(userId, 'sesion', `Objetivo: ${objetivo.slice(0,80)} | Acciones: ${accionesRealizadas}`, 2);
        }
    } catch(e) {}
    finalizarTareaGlobal(userId);
    console.log(`[LOOP] Completado en ${duracion}ms`);

    // Actualizar world model
    actualizarDesdeResultado(userId, objetivo, resultados);
    limpiarContexto(sesion_id);

    // ── Ciclo reflexivo BMO ────────────────────────────────
    // Solo si la reflexión detectó aprendizaje o problemas
    if (reflexion?.aprendizaje || reflexion?.problemas?.length > 0) {
        try {
            const temas = detectarTemasFrecuentes(5);
            const huecos = detectarHuecosConocimiento ? detectarHuecosConocimiento() : [];
            if (huecos?.length > 0 || temas?.length > 0) {
                await generarGoalsDesdeHuecos(userId, huecos, temas).catch(() => {});
                console.log('[CICLO] Goals generados desde reflexión');
            }
        } catch(e) {
            console.log('[CICLO] Error en ciclo reflexivo:', e.message);
        }
    }


    if (reflexion?.necesita_replanificar && iteracion < MAX_ITERACIONES - 1) {
        console.log('[LOOP] Replanificando por reflexión...');
        return ejecutarLoop(objetivo, userId, clienteWA, iteracion + 1, decision);
    }

    return null;
}

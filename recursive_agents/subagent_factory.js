/**
 * SubAgentFactory — crea agentes dinámicos especializados
 * Cada sub-agente tiene su propio planner, executor y critic
 */
import { plannerAgent } from '../agents/planner_agent.js';
import { researchAgent } from '../agents/research_agent.js';
import { executorAgent } from '../agents/executor_agent.js';
import { criticAgent } from '../agents/critic_agent.js';
import { listarTools } from '../tools/tool_registry.js';

const MAX_PASOS_SUBAGENTE = 4;

function inyectarResultados(input, resultados) {
    let r = String(input || '');
    resultados.forEach((res, i) => {
        r = r.replace(`RESULTADO_${i+1}`, String(res.resultado || ''));
    });
    return r;
}

export async function createSubAgent(config) {
    const { rol, objetivo, userId, clienteWA } = config;
    console.log(`[SUBAGENT:${rol.toUpperCase()}] Iniciando: ${objetivo.slice(0, 60)}`);

    // Planner genera plan específico para el sub-objetivo
    const pasos = await plannerAgent.run(objetivo, userId);
    if (!pasos?.length) {
        return { rol, objetivo, resultado: 'No se pudo planificar', exito: false };
    }

    // Research si hay pasos de búsqueda
    const sesionId = `subagent_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    const ctx = { userId, clienteWA, objetivo, sesionId };
    const datosResearch = await researchAgent.run(objetivo, pasos, ctx);

    const resultados = [];
    let exito = true;

    for (const paso of pasos.slice(0, MAX_PASOS_SUBAGENTE)) {
        paso.input = inyectarResultados(paso.input, resultados);

        // Si research ya tiene resultado de búsqueda, usarlo directamente sin re-ejecutar
        if (datosResearch?.[paso.id]) {
            const resResearch = datosResearch[paso.id];
            if (resResearch && !resResearch.startsWith('Error') && resResearch.length > 5) {
                const esBusqueda = ['buscar_web_exa', 'buscar_web', 'buscar_clima'].includes(paso.accion);
                if (esBusqueda) {
                    console.log(`[SUBAGENT] Research directo para ${paso.accion}, omitiendo re-ejecución`);
                    resultados.push({ ...paso, resultado: resResearch, evaluacion: { success: true, confianza: 85 }, intentos: 0 });
                    continue;
                }
            }
            paso.input = datosResearch[paso.id];
        }

        // Saltar enviar_mensaje en sub-agentes (el orquestador lo hace)
        if (paso.accion === 'enviar_mensaje') continue;

        const execResult = await executorAgent.run(paso, ctx);
        const evaluacion = await criticAgent.run(paso, execResult);
        const resultado = execResult.result || execResult.error || '';

        resultados.push({ ...paso, resultado, evaluacion });
        console.log(`[SUBAGENT:${rol.toUpperCase()}] ${paso.accion} → ${evaluacion.success ? '✓' : '✗'}`);

        if (!evaluacion.success && !evaluacion.retry) {
            exito = false;
            break;
        }
    }

    // Resultado más relevante (último no-vacío)
    const resultadoFinal = [...resultados].reverse()
        .find(r => r.resultado && r.resultado.length > 10)?.resultado || 'Sin resultado';

    console.log(`[SUBAGENT:${rol.toUpperCase()}] Completado: ${exito ? '✓' : '✗'}`);
    return { rol, objetivo, resultado: resultadoFinal, pasos: resultados, exito };
}

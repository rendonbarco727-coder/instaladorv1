import { BaseAgent } from './base_agent.js';
import { ejecutarTool } from '../tools/tool_registry.js';
import { optimizarQueries } from '../research/query_optimizer.js';

const SISTEMA = `Eres un investigador experto para BMO, agente autónomo.
Tu trabajo es reunir información relevante para completar una tarea.

REGLAS:
1. Analiza si la tarea requiere búsqueda externa
2. Resume solo información útil y relevante
3. Elimina datos irrelevantes o redundantes
4. Sé conciso pero completo

Responde con un resumen claro que ayude a ejecutar la tarea.
Si no se necesita investigación, responde: {"necesita_investigacion": false}`;

class ResearchAgent extends BaseAgent {
    constructor() { super('RESEARCH', 'rapido', SISTEMA); }

    async run(objetivo, pasos, ctx) {
        // Verificar si algún paso requiere búsqueda
        const toolsBusqueda = ['buscar_web', 'buscar_web_exa', 'buscar_clima'];
        const necesitaBusqueda = pasos.some(p => toolsBusqueda.includes(p.accion));
        if (!necesitaBusqueda) {
            console.log('[AGENT:RESEARCH] No se requiere investigación');
            return null;
        }

        // Separar pasos de clima (no optimizar) y búsqueda web
        const pasosClima = pasos.filter(p => p.accion === 'buscar_clima' &&
            !String(p.input).startsWith('RESULTADO_'));
        const pasosWeb = pasos.filter(p => ['buscar_web','buscar_web_exa'].includes(p.accion) &&
            !String(p.input).startsWith('RESULTADO_') &&
            !String(p.input).includes('Ciudad no encontrada'));

        const resultados = {};

        // Clima directo sin optimizer
        for (const paso of pasosClima) {
            console.log(`[AGENT:RESEARCH] Pre-buscando clima: ${paso.input}`);
            resultados[paso.id] = await ejecutarTool('buscar_clima', paso.input, ctx);
        }

        // Optimizar queries web — máximo 3
        if (pasosWeb.length) {
            const subtemasCrudos = pasosWeb.map(p => String(p.input).slice(0, 120));
            const subtemas = [...new Set(subtemasCrudos)]; // deduplicar antes de optimizar
            const queriesOpt = optimizarQueries(subtemas);  // sin contexto extra para no contaminar query

            // Mapear resultados de queries optimizadas a pasos originales
            for (let i = 0; i < pasosWeb.length; i++) {
                const paso = pasosWeb[i];
                const query = queriesOpt[Math.min(i, queriesOpt.length - 1)] || subtemas[i];

                // EXA primero — marcar en ctx para evitar doble llamada en executor
                console.log(`[AGENT:RESEARCH] EXA: ${query}`);
                const exaResult = await ejecutarTool('buscar_web_exa', query, ctx);
                if (exaResult && !exaResult.startsWith('Sin resultados')) {
                    resultados[paso.id] = exaResult;
                    // Marcar que este paso ya tiene resultado de EXA
                    if (ctx && !ctx._exaUsado) ctx._exaUsado = new Set();
                    ctx._exaUsado.add(paso.id);
                } else {
                    console.log(`[AGENT:RESEARCH] Fallback buscar_web: ${query}`);
                    resultados[paso.id] = await ejecutarTool('buscar_web', query, ctx);
                }

                // Si ya usamos todas las queries optimizadas, reutilizar el último resultado
                if (i >= queriesOpt.length - 1 && i < pasosWeb.length - 1) {
                    for (let j = i + 1; j < pasosWeb.length; j++) {
                        resultados[pasosWeb[j].id] = resultados[paso.id];
                    }
                    break;
                }
            }
        }

        return resultados;
    }
}

export const researchAgent = new ResearchAgent();

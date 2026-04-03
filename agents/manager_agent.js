import fs from 'fs';
import { BaseAgent } from './base_agent.js';
import { plannerAgent } from './planner_agent.js';
import { researchAgent } from './research_agent.js';
import { executorAgent } from './executor_agent.js';
import { criticAgent } from './critic_agent.js';
import { memoryAgent } from './memory_agent.js';
import { reflectionAgent } from './reflection_agent.js';
import { buscarEnCache, guardarEnCache } from '../reasoning_cache/cache.js';
import { recursivePlanner } from '../recursive_agents/recursive_planner.js';
import { ejecutarSubAgentes } from '../recursive_agents/subagent_executor.js';

const SISTEMA = `Eres el supervisor de BMO, sistema multi-agente autónomo.
Analiza el objetivo y decide la estrategia óptima de ejecución.

AGENTES DISPONIBLES:
- planner: divide objetivos en pasos
- research: investiga información (puede ser paralelo)
- executor: ejecuta herramientas
- critic: evalúa resultados
- memory: guarda conocimiento
- reflection: analiza aprendizajes

TIPOS DE TAREA:
- simple: solo executor (clima, estado sistema, pregunta directa)
- research: research + executor (buscar + crear documento)
- complex: todos los agentes (análisis, reportes complejos)
- creative: planner + executor + reflection (generar contenido)

FORMATO JSON:
{"tipo":"simple|research|complex|creative","agentes":["planner","executor"],"paralelo":false,"razon":"una línea"}`;

class ManagerAgent extends BaseAgent {
    constructor() { super('MANAGER', 'razonamiento', SISTEMA); }

    async decidir(objetivo, userId, metaContexto = {}) {
        // Bypass cache para objetivos con datos en tiempo real
        const esTiempoReal = /d[oó]lar|precio|crypto|bitcoin|ethereum|clima|temperatura|cotizaci[oó]n|tipo de cambio/i.test(objetivo);
        // Buscar en reasoning cache primero
        const cached = await buscarEnCache(objetivo);
        if (cached && !esTiempoReal) {
            console.log(`[AGENT:MANAGER] Cache hit: ${cached.tipo}`);
            return { ...cached, fromCache: true };
        }
        if (cached && esTiempoReal) {
            console.log(`[AGENT:MANAGER] Cache bypass — dato tiempo real: ${objetivo.slice(0,40)}`);
        }

        const input = `OBJETIVO: ${objetivo}\nJSON:`;
        const resultado = await super.run(input, { temperature: 0.1, max_tokens: 200 });

        // Detectar complejidad para recursive planning
        const palabrasObjetivo = objetivo.split(' ').length;
        // Deploy/git/github/proyectos web NUNCA recursivo — debe ser secuencial
        const esDespliegue = /github|deploy|git|pages|repositorio|dashboard|telemetry|gh repo/i.test(objetivo);
        const esProyectoWebMgr = /juego|snake|landing|portafolio|dashboard|app|html|css|javascript|web|página/i.test(objetivo);
        const esModoEdicion = (() => {
            try {
                const _p = `/tmp/bmo-proyecto-${userId}.json`;
                if (fs.existsSync(_p)) {
                    const estado = JSON.parse(fs.readFileSync(_p, 'utf8'));
                    return ['editando','esperando_repo','generando'].includes(estado.fase);
                }
            } catch(e) {}
            return false;
        })();
        const nivelRecursivo = 0;
        const complejidadMeta = metaContexto?.complejidad || "media";
        const confianzaMeta = metaContexto?.confianza || 80;
        if (complejidadMeta === "alta" && resultado.tipo === "simple") { resultado.tipo = "complex"; console.log("[MANAGER] Metacog elevó complejidad"); }
        const esComplejo = resultado.tipo === "complex" && palabrasObjetivo > 8
            && !esDespliegue && !esProyectoWebMgr && !esModoEdicion
            && confianzaMeta < 90;

        const decision = {
            tipo: resultado.tipo || 'complex',
            agentes: resultado.agentes || ['planner','research','executor','critic','memory','reflection'],
            paralelo: resultado.paralelo || false,
            razon: resultado.razon || '',
            fromCache: false,
            usarRecursivo: esComplejo
        };

        console.log(`[AGENT:MANAGER] tipo=${decision.tipo} recursivo=${decision.usarRecursivo} | ${decision.razon}`);
        await guardarEnCache(objetivo, decision);
        return decision;
    }

    async ejecutarRecursivo(objetivo, userId, clienteWA) {
        const analisis = await recursivePlanner.analizar(objetivo, userId);
        if (!analisis.complejo) return null;
        return ejecutarSubAgentes(analisis.sub_objetivos, userId, clienteWA, objetivo);
    }

    fallback() {
        return { tipo: 'complex', agentes: ['planner','research','executor','critic','memory','reflection'], paralelo: false };
    }
}

export const managerAgent = new ManagerAgent();

import { BaseAgent } from './base_agent.js';
import { EpisodicMemory } from '../memory/episodic_memory.js';
import { limpiarMemoria } from '../memory/memory_manager.js';
import { limpiarKnowledge } from '../knowledge/vector_store.js';
import { saveShortTerm, saveLongTerm } from '../memory/memory_manager.js';
import { guardarConocimiento } from '../knowledge/vector_store.js';

const SISTEMA = `Eres responsable de la memoria del agente BMO.
Decides qué información guardar y dónde.

Categorías:
- short_term: conversación actual, temporal
- long_term: hechos importantes, resultados clave
- knowledge_base: aprendizajes reutilizables, patrones

FORMATO:
{"guardar":[{"tipo":"long_term|short_term|knowledge_base","contenido":"...","importancia":1-3}]}`;

class MemoryAgent extends BaseAgent {
    constructor() { super('MEMORY', 'rapido', SISTEMA); }

    async run(objetivo, pasos, userId) {
        // Guardar objetivo siempre
        saveLongTerm(userId, 'objetivo_completado', objetivo, 2);

        let guardados = 0;

        // Guardar resultados importantes de cada paso
        for (const paso of pasos) {
            if (!paso.resultado) continue;
            const resultStr = String(paso.resultado).slice(0, 300);
            if (resultStr.length < 5) continue;

            // Fix: critic usa .success no .exitoso
            const exitoso = paso.evaluacion?.success ?? paso.evaluacion?.exitoso ?? true;

            // Guardar resultado de herramientas de búsqueda siempre
            if (['buscar_web', 'buscar_clima', 'estado_sistema'].includes(paso.accion)) {
                saveLongTerm(userId, `resultado_${paso.accion}`, resultStr, 2);
                guardados++;
            }

            // Guardar contenido generado
            if (paso.accion === 'generar_contenido' && resultStr.length > 50) {
                saveLongTerm(userId, 'contenido_generado', resultStr.slice(0, 200), 1);
                guardados++;
            }

            // Guardar conocimiento de herramientas exitosas
            if (exitoso && paso.accion !== 'enviar_mensaje' && paso.accion !== 'escribir_archivo') {
                await guardarConocimiento(
                    'herramienta_exitosa',
                    `Para "${paso.descripcion || paso.accion}" usar ${paso.accion}: ${resultStr.slice(0, 100)}`,
                    { accion: paso.accion },
                    userId, 2
                );
                guardados++;
            }

            // Guardar errores para aprender de ellos
            if (!exitoso && paso.evaluacion?.reason) {
                saveLongTerm(userId, 'error_aprendido', 
                    `${paso.accion} falló: ${paso.evaluacion.reason}`, 1);
            }
        }

        console.log(`[AGENT:MEMORY] Guardados ${guardados} resultados para ${userId}`);
        // Guardar episodio en memoria episódica
        try {
            const { EpisodicMemory } = await import('../memory/episodic_memory.js');
            const ep = new EpisodicMemory();
            const texto = 'Objetivo: ' + (String(objetivo || '').slice(0,200)) + ' | Resultados: ' + JSON.stringify(pasos || []).slice(0,300);
            await ep.saveEpisode(userId, texto, { objetivo: String(objetivo || '').slice(0,100), ts: Date.now() });
        } catch(e) {}
        // Limpieza periódica (5% de probabilidad por ejecución)
        if (Math.random() < 0.05) {
            try { limpiarMemoria(userId); } catch(e) { console.log('[MEMORY] limpiarMemoria error:', e.message); }
            try { limpiarKnowledge(); } catch(e) { console.log('[MEMORY] limpiarKnowledge error:', e.message); }
        }
        return { guardados };
    }
}

export const memoryAgent = new MemoryAgent();

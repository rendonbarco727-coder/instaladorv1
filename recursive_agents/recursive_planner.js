/**
 * RecursivePlanner — divide problemas complejos en sub-objetivos
 * Usa Mistral para detectar complejidad y generar sub-planes
 */
import { BaseAgent } from '../agents/base_agent.js';

const SISTEMA = `Eres un planificador recursivo experto. Tu trabajo es analizar si un objetivo es complejo y dividirlo en sub-objetivos independientes que pueden ejecutarse en paralelo.

REGLAS:
1. Un objetivo es complejo si requiere investigar múltiples fuentes o temas distintos
2. Divide en 2-4 sub-objetivos máximo (Pi tiene recursos limitados)
3. Cada sub-objetivo debe ser autónomo e independiente
4. Los sub-objetivos deben poder ejecutarse en paralelo
5. Responde SOLO JSON válido

FORMATO:
{"complejo":true,"razon":"por qué es complejo","sub_objetivos":[{"id":1,"rol":"research","objetivo":"objetivo específico","prioridad":1}]}

Si NO es complejo: {"complejo":false,"razon":"es una tarea simple"}`;

class RecursivePlanner extends BaseAgent {
    constructor() { super('RECURSIVE_PLANNER', 'razonamiento', SISTEMA); }

    async analizar(objetivo, userId) {
        const input = `OBJETIVO: ${objetivo}\n\nAnaliza si es complejo y genera sub-objetivos si aplica.\nJSON:`;
        const resultado = await super.run(input, { temperature: 0.1, max_tokens: 400 });

        if (!resultado.complejo) {
            console.log(`[RECURSIVE_PLANNER] Simple: ${resultado.razon}`);
            return { complejo: false };
        }

        const subObjetivos = resultado.sub_objetivos || [];
        console.log(`[RECURSIVE_PLANNER] Complejo: ${subObjetivos.length} sub-objetivos detectados`);
        return {
            complejo: true,
            razon: resultado.razon,
            sub_objetivos: subObjetivos
        };
    }

    fallback() {
        return { complejo: false };
    }
}

export const recursivePlanner = new RecursivePlanner();

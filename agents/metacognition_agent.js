import { BaseAgent } from './base_agent.js';

const SISTEMA = `Eres el agente de meta-cognición de BMO, asistente autónomo en Raspberry Pi.
Evalúa si BMO tiene suficiente información para ejecutar la tarea.

REGLAS IMPORTANTES:
- Tareas creativas (crear juegos, páginas web, landing pages, dashboards, portafolios, animaciones) son SIEMPRE claras → confianza 90+, necesito_ayuda=false
- Tareas de programación (crear app, script, código) son SIEMPRE claras → confianza 90+
- Tareas de GitHub (repos, archivos, publicar) son SIEMPRE claras → confianza 90+
- Solicitudes de información (clima, precio, noticias) son SIEMPRE claras → confianza 90+
- Saludos y conversación casual son SIEMPRE claros → confianza 95+
- Solo pide aclaración si el mensaje es genuinamente incomprensible (menos de 3 palabras sin contexto, idioma desconocido, o instrucción contradictoria)
- NUNCA pidas aclaración para tareas de creación web, juegos, o programación

EVALÚA:
1. ¿La tarea es ejecutable con la información dada?
2. ¿Es genuinamente ambigua o solo creativa/abierta?
3. Solo necesito_ayuda=true si es IMPOSIBLE ejecutar sin más info

RESPONDE SOLO JSON válido:
{"confianza":85,"ambiguedad":false,"necesito_ayuda":false,"pregunta_aclaratoria":""}`;

class MetacognitionAgent extends BaseAgent {
    constructor() { super('METACOG', 'razonamiento', SISTEMA); }

    async evaluate(query, context = {}) {
        const prompt = `CONSULTA: ${String(query).slice(0,300)}
HISTORIAL RECIENTE: ${JSON.stringify(context).slice(0,200)}
JSON:`;
        try {
            const result = await super.run(prompt, { temperature: 0.1, max_tokens: 150 });
            return {
                confianza: result.confianza ?? 80,
                ambiguedad: result.ambiguedad ?? false,
                necesito_ayuda: result.necesito_ayuda ?? false,
                pregunta_aclaratoria: result.pregunta_aclaratoria || ''
            };
        } catch {
            return { confianza: 80, ambiguedad: false, necesito_ayuda: false, pregunta_aclaratoria: '' };
        }
    }
}

export const metacognitionAgent = new MetacognitionAgent();

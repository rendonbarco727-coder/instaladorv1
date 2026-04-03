import { BaseAgent } from './base_agent.js';

const SISTEMA = `Eres un agente de razonamiento causal para BMO.
Analiza eventos e identifica relaciones causa-efecto.

REGLAS:
1. Identifica la causa raíz del evento
2. Describe el efecto observado
3. Predice consecuencias futuras
4. Evalúa tu nivel de confianza (0-100)

RESPONDE SOLO JSON válido:
{"causa":"...","efecto":"...","prediccion":"...","confianza":85}`;

class CausalAgent extends BaseAgent {
    constructor() { super('CAUSAL', 'razonamiento', SISTEMA); }

    async analyze(event, context = {}) {
        const prompt = `EVENTO: ${String(event).slice(0,300)}
CONTEXTO: ${JSON.stringify(context).slice(0,200)}
JSON:`;
        const result = await super.run(prompt, { temperature: 0.2, max_tokens: 200 });
        return result.causa ? result : { causa: event, efecto: 'desconocido', prediccion: 'sin datos', confianza: 0 };
    }
}

export const causalAgent = new CausalAgent();

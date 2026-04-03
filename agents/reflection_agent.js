import { BaseAgent } from './base_agent.js';
import { saveLongTerm } from '../memory/memory_manager.js';
import { guardarConocimiento } from '../knowledge/vector_store.js';
import { logTask } from '../memory/memory_manager.js';

const SISTEMA = `Eres un agente de reflexión para BMO.
Analiza el proceso y responde ÚNICAMENTE con JSON válido, sin texto adicional, sin markdown, sin explicaciones.

FORMATO OBLIGATORIO (solo esto, nada más):
{"exito":true,"completado":true,"aprendizaje":"lección aprendida en una frase","mejora":"qué mejorar","confianza":85,"necesita_replanificar":false}

REGLAS:
- SOLO JSON, nada de texto antes o después
- "exito": true si el objetivo se logró aunque sea parcialmente
- "completado": true si no hay pasos pendientes
- "confianza": número entre 0 y 100
- "necesita_replanificar": true solo si falló completamente`;

class ReflectionAgent extends BaseAgent {
    constructor() { super('REFLECTION', 'generacion', SISTEMA); }

    async run(objetivo, pasos, userId, duracion) {
        const resumen = pasos.map((p, i) => {
            const ok = p.evaluacion?.success ?? p.evaluacion?.exitoso ?? true;
            return `Paso ${i+1} [${p.accion}]: ${ok ? '✓' : '✗'} ${String(p.resultado || '').slice(0, 100)}`;
        }).join('\n');

        const input = `OBJETIVO: "${objetivo}"
DURACIÓN: ${Math.round(duracion/1000)}s
PASOS:\n${resumen}
JSON:`;

        const raw = await super.run(input, { temperature: 0.1, max_tokens: 250 });
        
        // Si el modelo devolvió texto plano, extraer info semánticamente
        let final = { exito: true, completado: true, confianza: 70, necesita_replanificar: false };
        if (raw && typeof raw === 'object' && !raw.texto) {
            final = { ...final, ...raw };
        } else {
            // Parsear texto plano
            const texto = raw?.texto || raw?.aprendizaje || String(raw || '');
            const tieneError = /error|falló|fallo|fail/i.test(texto);
            const tieneExito = /exitoso|completado|bien|correcto|success/i.test(texto);
            final.exito = tieneExito || !tieneError;
            final.completado = !/incompleto|pendiente|falta/i.test(texto);
            final.confianza = tieneExito ? 80 : tieneError ? 50 : 70;
            if (texto.length > 10) final.aprendizaje = texto.slice(0, 200);
        }

        // Guardar aprendizaje si existe
        if (final.aprendizaje) {
            saveLongTerm(userId, 'aprendizaje', final.aprendizaje, 2);
            await guardarConocimiento('aprendizaje', final.aprendizaje, { objetivo }, userId, 2);
        }

        // Log de tarea
        logTask(userId, objetivo, final.exito, duracion);
        console.log(`[AGENT:REFLECTION] exito=${final.exito} confianza=${final.confianza}% completado=${final.completado}`);
        return final;
    }

    fallback() { return { exito: true, completado: true, confianza: 70, necesita_replanificar: false }; }
}

export const reflectionAgent = new ReflectionAgent();

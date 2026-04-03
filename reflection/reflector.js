import { callModel } from '../core/model_router.js';
import { saveLongTerm, logTask } from '../memory/memory_manager.js';

export async function reflexionar(objetivo, pasos, userId, duracion) {
    const resumen = pasos.map((p, i) =>
        `Paso ${i+1} [${p.accion}]: ${String(p.resultado || '').slice(0, 150)}`
    ).join('\n');

    const prompt = `Evalúa brevemente si se completó el objetivo. SOLO JSON.

OBJETIVO: "${objetivo}"
PASOS:
${resumen}

JSON: {"exito":true,"confianza":85,"problemas":[],"aprendizaje":"","necesita_replanificar":false}`;

    let resultado = { exito: true, confianza: 70, necesita_replanificar: false };

    try {
        const resp = await callModel('rapido', prompt, { temperature: 0.1, max_tokens: 200 });
        const m = resp.match(/\{[\s\S]*\}/);
        if (m) resultado = { ...resultado, ...JSON.parse(m[0]) };
    } catch(e) {
        console.log('[REFLECTOR] Error:', e.message);
    }

    // Guardar aprendizaje en memoria
    if (resultado.aprendizaje) {
        saveLongTerm(userId, 'aprendizaje', resultado.aprendizaje, 2);
    }

    // Registrar tarea en log
    logTask(userId, objetivo, resultado.exito, duracion);

    console.log(`[REFLECTOR] exito=${resultado.exito} confianza=${resultado.confianza}%`);
    return resultado;
}

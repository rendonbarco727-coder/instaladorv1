import { callModel } from '../core/model_router.js';

export async function evaluarPaso(objetivo, accion, input, resultado) {
    // Evaluación rápida sin IA para casos obvios
    const resultadoStr = String(resultado || '');
    
    if (resultadoStr.startsWith('Error') || resultadoStr.startsWith('error')) {
        return { exitoso: false, confianza: 10, problema: resultadoStr.slice(0, 100), accion: 'reintentar', sugerencia: 'Intenta con parámetros diferentes' };
    }
    if (!resultadoStr || resultadoStr.length < 2) {
        return { exitoso: false, confianza: 20, problema: 'Resultado vacío', accion: 'reintentar', sugerencia: 'El paso no produjo resultado' };
    }
    if (resultadoStr.includes('no encontr') || resultadoStr.includes('Sin resultados')) {
        return { exitoso: false, confianza: 30, problema: 'Sin datos', accion: 'continuar', sugerencia: 'Continuar con datos limitados' };
    }

    // Para pasos críticos usar IA
    if (['crear_documento', 'ejecutar_terminal'].includes(accion)) {
        try {
            const prompt = `Evalúa brevemente si este paso fue exitoso. SOLO JSON.
OBJETIVO: ${objetivo}
ACCION: ${accion}
RESULTADO: ${resultadoStr.slice(0, 300)}
JSON: {"exitoso":true,"confianza":85,"problema":"","accion":"continuar","sugerencia":""}`;
            
            const resp = await callModel('rapido', prompt, { temperature: 0.1, max_tokens: 150 });
            const m = resp.match(/\{[\s\S]*\}/);
            if (m) return { exitoso: true, confianza: 70, accion: 'continuar', ...JSON.parse(m[0]) };
        } catch(e) {}
    }

    return { exitoso: true, confianza: 80, accion: 'continuar', problema: '', sugerencia: '' };
}

export function debeReintentar(evaluacion, intento) {
    return !evaluacion.exitoso && evaluacion.accion === 'reintentar' && intento < 2;
}

export function debeReplantear(evaluacion, fallosConsecutivos) {
    return fallosConsecutivos >= 2 || (!evaluacion.exitoso && evaluacion.accion === 'replantear');
}

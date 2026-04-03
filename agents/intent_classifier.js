import { callGemini, callGroq } from '../models/api_pool.js';

const INTENCIONES = `
codigo        → crear/arreglar/explicar/ejecutar scripts, programas, funciones en Python/JS/Bash/etc
proyecto_web  → crear páginas web, juegos, dashboards, landing pages, apps web completas
github        → ver repos, archivos, commits, borrar, publicar, gestionar GitHub
busqueda      → buscar noticias, información general, preguntas sobre el mundo
clima         → temperatura del clima, pronóstico del tiempo, lluvia
precio        → precio de crypto, divisas, dólar, euro, bitcoin
sistema       → estado del Pi, CPU, RAM, temperatura del procesador/sistema
memoria       → qué hicimos, historial, recordar conversaciones pasadas
identidad     → quién eres, tu creador, tu nombre, tu origen
capacidades   → qué puedes hacer, tus funciones, cómo ayudas
conversacion  → saludos, cómo estás, charla casual, agradecimientos
documento     → crear Word, Excel, PowerPoint, PDF
musica        → descargar música, canciones, YouTube
tarea         → programar recordatorios, alarmas, tareas periódicas
listar_sistema → ver archivos del Pi, listar carpetas del sistema, qué hay en carpeta, revisar scripts, ver directorio
`;

const SYSTEM = `Eres un clasificador de intenciones para BMO, asistente de WhatsApp.
Analiza el mensaje del usuario y determina su intención real.

INTENCIONES DISPONIBLES:
${INTENCIONES}

REGLAS CRÍTICAS:
- "crea un script/programa/función" → codigo (NO proyecto_web)
- "crea un juego/página/app/landing/dashboard" → proyecto_web
- "temperatura del procesador/CPU/Pi" → sistema (NO clima)
- "temperatura en ciudad/Monterrey" → clima
- Si el mensaje contiene código → codigo
- Saludos cortos, gracias, qué día es, qué hora es → conversacion
- "controla/enciende/apaga luces/enchufes/casa" → home_assistant
- "tabla/reporte/lista organizada/Excel/Word" → documento
- "activación BES/chip/SIM/IMEI" → reporte_bes
- Cualquier pregunta sobre precios, costos, cuánto vale → busqueda o precio
- Cualquier dato de 2024, 2025, 2026 o "actual/hoy/ahora" → busqueda
- "busca/encuentra/dime/cuánto/qué pasó/noticias" → busqueda
- NUNCA uses conversacion para preguntas con datos factuales — siempre busqueda
- Evalúa el SIGNIFICADO completo, no solo palabras clave

Responde SOLO JSON:
{"intencion":"codigo","confianza":95,"lenguaje":"bash","accion":"generar","descripcion":"script bash de memoria"}`;

export async function clasificarIntencion(mensaje, userId = '') {
    // Intercepción determinista para gestión de goals — solo mensajes simples
    const esMultiObjetivo = /luego|después|y después|y luego|también|además|ejecuta|script|python|código/i.test(mensaje);
    if (!esMultiObjetivo && /\bgoal\b|\bgoals\b/i.test(mensaje)) {
        let accion = 'listar';
        if (/borra|elimina|quita|cancel/i.test(mensaje)) accion = 'eliminar';
        if (/crea|haz|nuevo|agrega/i.test(mensaje)) accion = 'crear';
        if (/completo|listo|termina|finaliza/i.test(mensaje)) accion = 'completar';
        console.log(`[INTENT_CLASSIFIER] gestionar_goals (${accion}) — determinista`);
        return { intencion: 'gestionar_goals', confianza: 100, accion };
    }
    const prompt = `${SYSTEM}\n\nMENSAJE: "${mensaje}"\n\nJSON:`;
    
    try {
        // Groq 70b como principal — rápido y preciso
        const resp = await callGroq(prompt, { 
            model: 'llama-3.3-70b-versatile',
            max_tokens: 150, 
            temperature: 0.1 
        });
        const limpio = resp.replace(/```json|```/g, '').trim();
        const match = limpio.match(/\{[\s\S]*\}/);
        if (match) {
            const result = JSON.parse(match[0]);
            console.log(`[INTENT_CLASSIFIER] ${result.intencion} (${result.confianza}%) — Groq fallback`);
            return result;
        }
    } catch(e) {
        console.log(`[INTENT_CLASSIFIER] Groq falló: ${e.message.slice(0,50)}, usando Gemini...`);
        try {
            const resp2 = await callGemini(prompt, { model: 'gemini-2.0-flash', max_tokens: 150, temperature: 0.1 });
            const limpio2 = resp2.replace(/\`\`\`json|\`\`\`/g, '').trim();
            const match2 = limpio2.match(/\{[\s\S]*\}/);
            if (match2) {
                const result2 = JSON.parse(match2[0]);
                console.log(`[INTENT_CLASSIFIER] ${result2.intencion} (${result2.confianza}%) — Gemini fallback`);
                return result2;
            }
        } catch(e2) {}
    }

    // Fallback hardcoded mínimo
    return { intencion: 'conversacion', confianza: 50, accion: 'responder' };
}

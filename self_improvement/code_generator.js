import { callModel } from '../core/model_router.js';
import { guardarConocimiento } from '../knowledge/vector_store.js';
import fs from 'fs';
import { ROOT_DIR } from '../config/bmo.config.js';

const BASE_PATH = `${ROOT_DIR}`;

// Genera un módulo nuevo desde cero
export async function generarModulo(nombre, descripcion, contexto = '') {
    console.log(`[CODE_GEN] Generando módulo: ${nombre}`);

    const prompt = `Eres un experto en Node.js. Genera un módulo ES Module completo y funcional.

MÓDULO: ${nombre}
DESCRIPCIÓN: ${descripcion}
CONTEXTO: ${contexto}

REGLAS ESTRICTAS:
1. Solo ES Modules (import/export), NUNCA require()
2. NUNCA usar fetch(), siempre curl via execAsync
3. Exporta todas las funciones principales
4. Incluye manejo de errores en cada función
5. Código listo para producción, sin comentarios innecesarios
6. Máximo 150 líneas

Responde SOLO con el código JavaScript, sin explicaciones ni markdown.`;

    const codigo = await callModel('codigo', prompt, { temperature: 0.2, max_tokens: 2000 });

    // Limpiar backticks si vienen
    const limpio = codigo.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();

    return limpio;
}

// Genera un fix para código con error
export async function generarFix(codigoActual, error, descripcion = '') {
    console.log(`[CODE_GEN] Generando fix para error: ${error.slice(0, 80)}`);

    const prompt = `Eres un experto en Node.js. Corrige el error en este código.

ERROR: ${error}
DESCRIPCIÓN: ${descripcion}

CÓDIGO ACTUAL:
${codigoActual.slice(0, 2000)}

REGLAS:
1. Solo ES Modules (import/export)
2. NUNCA fetch(), siempre curl via execAsync  
3. Corrige SOLO el error, no cambies lógica innecesariamente
4. Responde SOLO con el código corregido completo, sin markdown

CÓDIGO CORREGIDO:`;

    const codigo = await callModel('codigo', prompt, { temperature: 0.1, max_tokens: 2000 });
    return codigo.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
}

// Genera una nueva herramienta para tool_registry
export async function generarHerramienta(nombre, descripcion) {
    console.log(`[CODE_GEN] Generando herramienta: ${nombre}`);

    const prompt = `Genera una función para agregar al tool_registry de BMO (agente autónomo en Node.js/Raspberry Pi).

HERRAMIENTA: ${nombre}
DESCRIPCIÓN: ${descripcion}

La función debe:
1. Ser async y recibir (input, ctx = {})
2. Retornar string con el resultado
3. Manejar errores con try/catch
4. Usar curl via execAsync si necesita HTTP
5. Ser ES Module compatible

Responde SOLO con la función, sin imports ni exports:

${nombre}: async (input, ctx) => {`;

    const fn = await callModel('codigo', prompt, { temperature: 0.2, max_tokens: 800 });
    const limpio = fn.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();

    // Guardar en conocimiento
    await guardarConocimiento('herramienta_generada', `Herramienta ${nombre}: ${descripcion}`, { nombre }, 'global', 2);

    return `    ${nombre}: async (input, ctx) => {\n${limpio}`;
}

// Guardar módulo generado en disco
export function guardarModulo(ruta, codigo) {
    fs.writeFileSync(ruta, codigo, 'utf8');
    console.log(`[CODE_GEN] Módulo guardado: ${ruta}`);
}

import { callModel } from '../core/model_router.js';
import { generarFix } from './code_generator.js';
import { probarModulo } from './module_tester.js';
import { guardarConocimiento } from '../knowledge/vector_store.js';
import fs from 'fs';

const MAX_INTENTOS_PATCH = 3;

// Aplicar patch a un archivo existente
export async function patchearArchivo(ruta, descripcionError, errorMsg = '') {
    if (!fs.existsSync(ruta)) return { ok: false, error: 'Archivo no existe' };

    const codigoActual = fs.readFileSync(ruta, 'utf8');
    console.log(`[PATCHER] Patcheando: ${ruta}`);

    // Backup antes de modificar
    const backup = `${ruta}.backup_${Date.now()}`;
    fs.writeFileSync(backup, codigoActual, 'utf8');

    let intentos = 0;
    let codigoActualizado = codigoActual;

    while (intentos < MAX_INTENTOS_PATCH) {
        intentos++;
        console.log(`[PATCHER] Intento ${intentos}/${MAX_INTENTOS_PATCH}`);

        // Generar fix con IA
        const codigoFix = await generarFix(codigoActualizado, errorMsg || descripcionError, descripcionError);

        if (!codigoFix || codigoFix.length < 50) {
            console.log('[PATCHER] Fix generado muy corto, abortando');
            break;
        }

        // Probar el fix
        const prueba = await probarModulo(codigoFix);

        if (prueba.aprobado) {
            // Guardar fix aprobado
            fs.writeFileSync(ruta, codigoFix, 'utf8');
            console.log(`[PATCHER] Fix aplicado OK en ${ruta}`);

            // Guardar aprendizaje
            await guardarConocimiento(
                'fix_exitoso',
                `Fix para ${ruta}: ${descripcionError}`,
                { ruta, error: errorMsg, intentos },
                'global', 2
            );

            // Limpiar backup
            try { fs.unlinkSync(backup); } catch(e) {}

            return { ok: true, intentos, exports: prueba.import?.exports };
        }

        // Si falla, usar el error nuevo para el siguiente intento
        errorMsg = prueba.sintaxis?.error || prueba.import?.error || errorMsg;
        console.log(`[PATCHER] Fix falló: ${String(errorMsg).slice(0, 80)}`);
        codigoActualizado = codigoFix;
    }

    // Restaurar backup si todos los intentos fallaron
    fs.writeFileSync(ruta, fs.readFileSync(backup, 'utf8'), 'utf8');
    try { fs.unlinkSync(backup); } catch(e) {}
    console.log('[PATCHER] Restaurado backup, no se pudo patchear');

    return { ok: false, error: `Fallaron ${intentos} intentos de patch` };
}

// Aplicar mejora específica (no un fix de error sino una mejora)
export async function mejorarArchivo(ruta, mejora) {
    if (!fs.existsSync(ruta)) return { ok: false, error: 'Archivo no existe' };

    const codigoActual = fs.readFileSync(ruta, 'utf8');

    const prompt = `Mejora este código Node.js ES Module aplicando la siguiente mejora.

MEJORA SOLICITADA: ${mejora}

CÓDIGO ACTUAL:
${codigoActual.slice(0, 2000)}

REGLAS:
1. Solo ES Modules
2. Mantén toda la funcionalidad existente
3. Aplica SOLO la mejora solicitada
4. Responde con el código completo mejorado, sin markdown

CÓDIGO MEJORADO:`;

    const codigoMejorado = await callModel('codigo', prompt, { temperature: 0.2, max_tokens: 2000 });
    const limpio = codigoMejorado.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();

    const prueba = await probarModulo(limpio);
    if (!prueba.aprobado) return { ok: false, error: prueba.sintaxis?.error };

    const backup = `${ruta}.backup_${Date.now()}`;
    fs.writeFileSync(backup, codigoActual, 'utf8');
    fs.writeFileSync(ruta, limpio, 'utf8');
    try { fs.unlinkSync(backup); } catch(e) {}

    console.log(`[PATCHER] Mejora aplicada: ${ruta}`);
    return { ok: true };
}

// Detectar y auto-patchear desde un error capturado
export async function autoPatch(error, contexto = {}) {
    const { ruta, accion, input } = contexto;
    if (!ruta) return null;

    console.log(`[PATCHER] AutoPatch iniciado para: ${ruta}`);
    return await patchearArchivo(ruta, `Error en acción ${accion}: ${input}`, error);
}

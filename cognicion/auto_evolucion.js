/**
 * AUTO-EVOLUCIÓN DE BMO
 * Cuando BMO no puede hacer algo, crea el módulo solo
 */
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const EVOLUCIONES_DIR = path.join(__dirname, '..', 'evoluciones');
const REGISTRO_FILE = path.join(__dirname, 'registro_evoluciones.json');

function cargarRegistro() {
    try { return JSON.parse(fs.readFileSync(REGISTRO_FILE)); }
    catch { return []; }
}

function guardarRegistro(reg) {
    fs.writeFileSync(REGISTRO_FILE, JSON.stringify(reg, null, 2));
}

function nombreModulo(objetivo) {
    return objetivo.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 30);
}

async function generarModulo(objetivo, contexto) {
    const prompt = `Eres BMO, agente en Raspberry Pi con Node.js ES Modules. Necesitas crear un nuevo modulo para: "${objetivo}"

CONTEXTO DEL ERROR O NECESIDAD: ${contexto}

MODULOS EXISTENTES QUE PUEDES IMPORTAR:
- ../evoluciones/agente_autonomo.js → ejecutarTerminal, instalarSoftware, estadoSistema, gestionArchivos
- child_process, fs, path (built-in Node.js)
- axios (disponible en node_modules)
- curl via execAsync para APIs externas (fetch no disponible)

ESTRUCTURA REQUERIDA:
export async function ejecutar({ client, userId, mensaje, args }) {
    // logica aqui
    return 'resultado string';
}

REGLAS CRITICAS:
1. Solo ES Modules (import/export), NUNCA require()
2. Usa curl para HTTP, no fetch
3. Maneja errores con try/catch
4. Retorna siempre un string con el resultado
5. Maximo 80 lineas
6. SOLO el codigo, sin explicaciones ni markdown

Codigo del modulo:`;

    try {
        const body = JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 1200 }
        });
        const { stdout } = await execAsync(
            `curl -s --max-time 20 "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}" -H "Content-Type: application/json" -d ${JSON.stringify(body)}`
        );
        const resp = JSON.parse(stdout);
        let codigo = resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
        codigo = codigo.replace(/```javascript|```js|```/g, '').trim();
        return codigo;
    } catch(e) {
        console.log('[AUTOEVOL] Gemini fallo:', e.message);
        return null;
    }
}

async function validarModulo(rutaArchivo) {
    try {
        await execAsync('node --check ' + rutaArchivo);
        return { valido: true };
    } catch(e) {
        return { valido: false, error: e.message.slice(0, 300) };
    }
}

export async function crearNuevoModulo(objetivo, contexto, clienteWA, userId) {
    console.log('[AUTOEVOL] Creando modulo para:', objetivo);

    const nombre = nombreModulo(objetivo);
    const rutaArchivo = path.join(EVOLUCIONES_DIR, nombre + '.js');

    // No recrear si ya existe
    if (fs.existsSync(rutaArchivo)) {
        console.log('[AUTOEVOL] Modulo ya existe:', nombre);
        return { exito: true, nombre, nuevo: false };
    }

    await clienteWA.sendMessage(userId, 'Nunca hice eso antes. Voy a crear un modulo nuevo para: ' + objetivo).catch(() => {});

    let codigo = null;
    let intentos = 0;
    let errorPrevio = contexto;

    while (intentos < 3) {
        intentos++;
        console.log('[AUTOEVOL] Intento', intentos);

        codigo = await generarModulo(objetivo, errorPrevio);
        if (!codigo) continue;

        fs.writeFileSync(rutaArchivo, codigo);
        const validacion = await validarModulo(rutaArchivo);

        if (validacion.valido) {
            console.log('[AUTOEVOL] Modulo valido:', nombre);
            break;
        } else {
            console.log('[AUTOEVOL] Sintaxis invalida, reintentando:', validacion.error);
            errorPrevio = 'Error de sintaxis en intento anterior: ' + validacion.error;
            fs.unlinkSync(rutaArchivo);
            codigo = null;
        }
    }

    if (!codigo || !fs.existsSync(rutaArchivo)) {
        await clienteWA.sendMessage(userId, 'No pude crear el modulo para "' + objetivo + '" despues de ' + intentos + ' intentos.').catch(() => {});
        return { exito: false };
    }

    // Registrar evolucion
    const registro = cargarRegistro();
    registro.push({
        nombre,
        objetivo,
        fecha: new Date().toISOString(),
        intentos,
        ruta: rutaArchivo
    });
    guardarRegistro(registro);

    await clienteWA.sendMessage(userId, 'Modulo "' + nombre + '" creado y listo. Intentalo de nuevo.').catch(() => {});
    console.log('[AUTOEVOL] Exito:', nombre);
    return { exito: true, nombre, nuevo: true, ruta: rutaArchivo };
}

export async function intentarConModulosDinamicos(mensaje, clienteWA, userId) {
    const registro = cargarRegistro();
    for (const mod of registro) {
        try {
            const modulo = await import(mod.ruta + '?t=' + Date.now());
            if (typeof modulo.ejecutar === 'function') {
                const resultado = await modulo.ejecutar({ client: clienteWA, userId, mensaje, args: mensaje.split(' ') });
                if (resultado) return resultado;
            }
        } catch(e) {
            console.log('[AUTOEVOL] Error ejecutando modulo dinamico:', mod.nombre, e.message);
        }
    }
    return null;
}

export function listarEvoluciones() {
    const registro = cargarRegistro();
    if (!registro.length) return 'No he creado modulos nuevos aun.';
    return 'Modulos que cree yo solo:\n' + registro.map(r =>
        '- ' + r.nombre + ' (' + new Date(r.fecha).toLocaleDateString() + '): ' + r.objetivo
    ).join('\n');
}

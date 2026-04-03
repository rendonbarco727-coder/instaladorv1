import { ejecutarTool } from '../tools/tool_registry.js';
import { routeModel } from '../core/model_router.js';

const MAX_PAGINAS = 3;

function extraerURLs(textoExa) {
    const urls = [];
    const regex = /https?:\/\/[^\s\n*>)]+/g;
    const matches = textoExa.match(regex) || [];
    for (const url of matches) {
        const limpia = url.replace(/[.,;)"']+$/, '');
        if (limpia.startsWith('http') && !urls.includes(limpia)) {
            urls.push(limpia);
        }
        if (urls.length >= MAX_PAGINAS) break;
    }
    return urls;
}

async function resumirContenido(url, contenido) {
    try {
        const dominio = new URL(url).hostname.replace('www.', '');
        const prompt = `Extrae y resume los puntos más importantes del siguiente contenido web.
Fuente: ${dominio}
Sé conciso, máximo 3 puntos clave. Responde en español.

Contenido:
${contenido.slice(0, 2000)}`;

        const resultado = await routeModel('generacion', prompt);
        return `📰 *${dominio}*\n${resultado?.slice(0, 600) || 'Sin resumen disponible.'}`;
    } catch(e) {
        return null;
    }
}

export async function analizarPaginas(urlsOTextoExa) {
    // Acepta array de URLs o texto de EXA del que extrae URLs
    let urls = [];
    if (Array.isArray(urlsOTextoExa)) {
        urls = urlsOTextoExa.slice(0, MAX_PAGINAS);
    } else {
        urls = extraerURLs(String(urlsOTextoExa));
    }

    if (!urls.length) {
        console.log('[WEB_READER] No se encontraron URLs para analizar');
        return null;
    }

    console.log(`[WEB_READER] Analizando ${urls.length} página(s)`);
    const resumenes = [];

    for (const url of urls) {
        try {
            console.log(`[WEB_READER] Leyendo: ${url.slice(0, 70)}`);
            const contenido = await ejecutarTool('leer_web', url, {});
            if (!contenido || contenido.includes('No se pudo') || contenido.length < 100) {
                console.log(`[WEB_READER] Sin contenido útil: ${url.slice(0, 50)}`);
                continue;
            }
            const resumen = await resumirContenido(url, contenido);
            if (resumen) resumenes.push(resumen);
            // Pausa para no saturar CPU
            await new Promise(r => setTimeout(r, 1000));
        } catch(e) {
            console.log(`[WEB_READER] Error en ${url.slice(0, 50)}: ${e.message}`);
        }
    }

    if (!resumenes.length) return null;
    return resumenes.join('\n\n');
}

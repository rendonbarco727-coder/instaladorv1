import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

function limpiarHTML(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#[0-9]+;/g, ' ')
        .replace(/\s{3,}/g, '\n\n')
        .trim();
}

export async function leerWeb(url) {
    if (!url || !url.startsWith('http')) return 'URL inválida.';
    try {
        const { stdout } = await execAsync(
            `curl -L -s --max-time 15 -A "Mozilla/5.0" ` +
            `--max-filesize 500000 "${url.replace(/"/g, '')}"`,
            { maxBuffer: 1024 * 1024 }
        );
        if (!stdout || stdout.length < 100) return 'Página vacía o sin contenido.';
        const texto = limpiarHTML(stdout);
        if (texto.length < 50) return 'No se pudo extraer texto de la página.';
        return texto.slice(0, 4000);
    } catch(e) {
        return 'No se pudo leer la página.';
    }
}

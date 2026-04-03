import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);
const EXA_API_KEY = process.env.EXA_API_KEY || 'ff126781-62ca-4ac4-a564-91fadba98043';
const MAX_CALLS_POR_TAREA = 3;

// Contador por sesión para no saturar CPU
const _contadorSesion = new Map();

export async function buscarWebExa(query, sesionId = 'global') {
    // Usar sesionId limpio — no mezclar sesiones paralelas
    const sid = sesionId.includes('sesion_') ? sesionId : sesionId;
    // Límite de llamadas por tarea
    const count = _contadorSesion.get(sid) || 0;
    if (count >= MAX_CALLS_POR_TAREA) {
        console.log(`[EXA] Límite de ${MAX_CALLS_POR_TAREA} búsquedas alcanzado para sesión ${sesionId}`);
        return null; // null = usar fallback
    }
    _contadorSesion.set(sid, count + 1);

    const tmpFile = `/tmp/exa_req_${Date.now()}.json`;
    try {
        const body = {
            query: query.slice(0, 200),
            numResults: 5,
            useAutoprompt: true
        };
        fs.writeFileSync(tmpFile, JSON.stringify(body));

        const { stdout } = await execAsync(
            `curl -s --max-time 15 "https://api.exa.ai/search" ` +
            `-H "Content-Type: application/json" ` +
            `-H "x-api-key: ${EXA_API_KEY}" ` +
            `-d @${tmpFile}`
        );
        try { fs.unlinkSync(tmpFile); } catch(e) {}

        const data = JSON.parse(stdout);
        if (!data.results || !data.results.length) return null;

        const resultados = data.results
            .filter(r => r.title && r.url)
            .slice(0, 5)
            .map(r => {
                const snippet = r.text ? r.text.slice(0, 300) : (r.highlights?.[0] || '');
                return `📄 *${r.title}*\n🔗 ${r.url}${snippet ? '\n' + snippet : ''}`;
            })
            .join('\n\n');

        return resultados.length > 10 ? resultados : null;
    } catch(e) {
        try { fs.unlinkSync(tmpFile); } catch(_) {}
        console.log(`[EXA] Error: ${e.message.slice(0, 60)}`);
        return null;
    }
}

export function resetContador(sesionId) {
    _contadorSesion.delete(sesionId);
}

import Database from 'better-sqlite3';
import { ROOT_DIR } from '../config/bmo.config.js';

const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`
let _db = null;
function getDB() {
    if (!_db) _db = new Database(DB_PATH);
    return _db;
}

export function detectarTemasFrecuentes(limite = 10) {
    try {
        const db = getDB();
        // Temas de knowledge base
        const knowledge = db.prepare(`
            SELECT texto FROM knowledge
            WHERE timestamp > ? ORDER BY timestamp DESC LIMIT 50
        `).all(Date.now() - 24 * 60 * 60 * 1000);

        // Temas de long_term memory
        const longTerm = db.prepare(`
            SELECT contenido FROM long_term
            WHERE timestamp > ? ORDER BY timestamp DESC LIMIT 30
        `).all(Date.now() - 48 * 60 * 60 * 1000);

        // Hechos del world model
        let hechos = [];
        try {
            hechos = db.prepare('SELECT hecho FROM wm_facts ORDER BY timestamp DESC LIMIT 20').all();
        } catch(e) {}

        // Extraer palabras clave
        const textos = [
            ...knowledge.map(r => r.texto),
            ...longTerm.map(r => r.contenido),
            ...hechos.map(r => r.hecho)
        ].join(' ');

        return extraerPalabrasClave(textos, limite);
    } catch(e) {
        console.log('[CURIOSITY] Error leyendo DB:', e.message);
        return [];
    }
}

function extraerPalabrasClave(texto, limite) {
    const stopWords = new Set(['para','como','que','con','una','uno','los','las','del','por','este','esta','son','han','sido','tiene','puede','cuando','donde','segun','entre','cada','sobre','desde','hacia','hasta','generar','contenido','agente','precio','bitcoin','buscar','herramienta','resultado','informacion','datos','sistema','ejecutar','resumen','modelo','respuesta','usuario','mensaje','clima','monterrey','temperatura','humedad','viento','documento','reporte','editar','agregar','docx']);
    const palabras = texto.toLowerCase()
        .replace(/[^a-záéíóúüñ\s]/g, ' ')
        .split(/\s+/)
        .filter(p => p.length > 4 && !stopWords.has(p));

    const freq = {};
    for (const p of palabras) {
        freq[p] = (freq[p] || 0) + 1;
    }

    return Object.entries(freq)
        .filter(([_, n]) => n >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limite)
        .map(([word]) => word);
}

export function detectarHuecosConocimiento() {
    // Temas que el agente intentó buscar pero no encontró
    try {
        const db = getDB();
        const errores = db.prepare(`
            SELECT mensaje FROM error_log
            WHERE tipo='tool_error' AND mensaje LIKE '%No encontré%'
            AND timestamp > ?
            ORDER BY timestamp DESC LIMIT 10
        `).all(Date.now() - 24 * 60 * 60 * 1000);
        return errores.map(e => e.mensaje.replace('No encontré información sobre:', '').trim()).filter(Boolean);
    } catch(e) { return []; }
}

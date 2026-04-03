import Database from 'better-sqlite3';
import { generarEmbedding, similitudCoseno } from '../knowledge/embeddings.js';

const DB_PATH = '/home/ruben/wa-ollama/memory/bmo_memory.db';
let db;

function getDB() {
    if (!db) {
        try {
            db = new Database(DB_PATH);
            db.exec(`
                CREATE TABLE IF NOT EXISTS reasoning_cache (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    objetivo TEXT,
                    embedding TEXT,
                    estrategia TEXT,
                    resultado TEXT,
                    exito INTEGER DEFAULT 1,
                    usos INTEGER DEFAULT 0,
                    timestamp INTEGER
                );
            `);
        } catch(e) {
            console.error('[CACHE] Error abriendo DB:', e.message);
            throw e;
        }
    }
    return db;
}

const TTL = {
    simple:   30 * 60 * 1000,
    research:  2 * 60 * 60 * 1000,
    complex:   7 * 24 * 60 * 60 * 1000,
    creative:  7 * 24 * 60 * 60 * 1000,
    default:   60 * 60 * 1000
};
function estaVigente(item) {
    let tipo = 'default';
    try { tipo = JSON.parse(item.estrategia || '{}').tipo || 'default'; } catch(e) {}
    const esVolatil = /precio|dolar|crypto|bitcoin|clima|tiempo|bolsa|divisa|actual|hoy|cotizacion|cotización|tipo de cambio|temperatura|usd|mxn|euro|gasolina|combustible/i.test(item.objetivo);
    const esCreacion = /\b(crea|crear|genera|generar|hace|hacer|escribe|escribir)\b.*(docx|word|excel|xlsx|pdf|presentacion|documento|reporte)/i.test(item.objetivo);
    const ttl = (esVolatil || esCreacion)
        ? TTL.simple : (TTL[tipo] || TTL.default);
    return (Date.now() - item.timestamp) < ttl;
}

export async function buscarEnCache(objetivo, umbral = 0.85) {
    const db = getDB();
    const todos = db.prepare('SELECT * FROM reasoning_cache WHERE exito=1 ORDER BY usos DESC LIMIT 50').all()
        .filter(estaVigente);
    if (!todos.length) return null;

    const emb = await generarEmbedding(objetivo);
    let mejor = null, mejorSim = 0;

    for (const item of todos) {
        try {
            const itemEmb = JSON.parse(item.embedding || '[]');
            const sim = similitudCoseno(emb, itemEmb);
            if (sim > mejorSim) { mejorSim = sim; mejor = item; }
        } catch(e) {
            console.warn('[CACHE] Error calculando similitud:', e.message);
        }
    }

    if (mejorSim >= umbral && mejor) {
        db.prepare('UPDATE reasoning_cache SET usos=usos+1 WHERE id=?').run(mejor.id);
        console.log(`[CACHE] Hit con similitud ${Math.round(mejorSim*100)}%: ${mejor.objetivo.slice(0,50)}`);
        try { return JSON.parse(mejor.estrategia); } catch(e) { return null; }
    }
    return null;
}

export async function guardarEnCache(objetivo, estrategia, resultado = null, exito = true) {
    const db = getDB();
    const existe = db.prepare('SELECT id FROM reasoning_cache WHERE objetivo=?').get(objetivo);
    if (existe) {
        db.prepare('UPDATE reasoning_cache SET usos=usos+1, estrategia=?, timestamp=? WHERE id=?').run(JSON.stringify(estrategia), Date.now(), existe.id);
        return;
    }
    const emb = await generarEmbedding(objetivo);
    db.prepare('INSERT INTO reasoning_cache (objetivo,embedding,estrategia,resultado,exito,usos,timestamp) VALUES (?,?,?,?,?,0,?)').run(
        objetivo, JSON.stringify(emb), JSON.stringify(estrategia),
        resultado ? JSON.stringify(resultado).slice(0,500) : null,
        exito ? 1 : 0, Date.now()
    );
    console.log(`[CACHE] Guardado: ${objetivo.slice(0,60)}`);
}

export function invalidarCache(objetivo) {
    getDB().prepare('UPDATE reasoning_cache SET exito=0 WHERE objetivo=?').run(objetivo);
}

export function limpiarCacheVieja() {
    const db = getDB();
    // Eliminar entradas viejas sin usos
    const r1 = db.prepare("DELETE FROM reasoning_cache WHERE timestamp < ? AND usos = 0").run(Date.now() - 24*3600000);
    // Mantener máximo 500 entradas — eliminar las menos usadas
    const total = db.prepare("SELECT COUNT(*) as n FROM reasoning_cache").get()?.n || 0;
    if (total > 500) {
        db.prepare("DELETE FROM reasoning_cache WHERE id IN (SELECT id FROM reasoning_cache ORDER BY usos ASC, timestamp ASC LIMIT ?)").run(total - 500);
    }
    return { eliminadas: r1.changes, total: db.prepare("SELECT COUNT(*) as n FROM reasoning_cache").get()?.n };
}

export function estadoCache() {
    const db = getDB();
    const total = db.prepare('SELECT COUNT(*) as n FROM reasoning_cache').get()?.n || 0;
    const hits = db.prepare('SELECT SUM(usos) as n FROM reasoning_cache').get()?.n || 0;
    return { total, hits };
}

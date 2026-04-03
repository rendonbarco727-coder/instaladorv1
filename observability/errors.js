import Database from 'better-sqlite3';

const DB_PATH = '/home/ruben/wa-ollama/memory/bmo_memory.db';
let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS error_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT,
                mensaje TEXT,
                stack TEXT,
                userId TEXT DEFAULT '',
                contexto TEXT DEFAULT '{}',
                timestamp INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_error_tipo ON error_log(tipo);
        `);
    }
    return db;
}

export function logError(tipo, mensaje, opciones = {}) {
    const { stack = '', userId = '', contexto = {} } = opciones;
    getDB().prepare('INSERT INTO error_log (tipo,mensaje,stack,userId,contexto,timestamp) VALUES (?,?,?,?,?,?)').run(tipo, String(mensaje).slice(0, 500), stack.slice(0, 1000), userId, JSON.stringify(contexto), Date.now());
    console.error(`[ERROR_LOG] [${tipo}] ${String(mensaje).slice(0, 100)}`);
}

export function getErroresRecientes(limit = 5) {
    return getDB().prepare('SELECT tipo,mensaje,userId,timestamp FROM error_log ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function getErroresPorTipo(horasAtras = 24) {
    const desde = Date.now() - horasAtras * 3600000;
    return getDB().prepare('SELECT tipo, COUNT(*) as n FROM error_log WHERE timestamp > ? GROUP BY tipo ORDER BY n DESC').all(desde);
}

export function limpiarErroresViejos() {
    const borrados = getDB().prepare('DELETE FROM error_log WHERE timestamp < ?').run(Date.now() - 7 * 86400000);
    if (borrados.changes > 0) console.log(`[ERROR_LOG] ${borrados.changes} errores antiguos eliminados`);
}

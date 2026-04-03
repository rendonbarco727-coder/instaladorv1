import Database from 'better-sqlite3';

const DB_PATH = '/home/ruben/wa-ollama/memory/bmo_memory.db';
let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT,
                valor REAL,
                metadata TEXT DEFAULT '{}',
                timestamp INTEGER
            );
            CREATE TABLE IF NOT EXISTS tool_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool TEXT,
                userId TEXT,
                exitoso INTEGER,
                duracion INTEGER,
                timestamp INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_metrics_tipo ON metrics(tipo);
            CREATE INDEX IF NOT EXISTS idx_tool_usage_tool ON tool_usage(tool);
        `);
    }
    return db;
}

export function registrarMetrica(tipo, valor, metadata = {}) {
    getDB().prepare('INSERT INTO metrics (tipo,valor,metadata,timestamp) VALUES (?,?,?,?)').run(tipo, valor, JSON.stringify(metadata), Date.now());
}

export function registrarToolUsage(tool, userId, exitoso, duracion = 0) {
    getDB().prepare('INSERT INTO tool_usage (tool,userId,exitoso,duracion,timestamp) VALUES (?,?,?,?,?)').run(tool, userId, exitoso ? 1 : 0, duracion, Date.now());
    // Mantener máximo 1000 registros
    const total = getDB().prepare('SELECT COUNT(*) as n FROM tool_usage').get()?.n || 0;
    if (total > 1000) getDB().prepare('DELETE FROM tool_usage WHERE id NOT IN (SELECT id FROM tool_usage ORDER BY timestamp DESC LIMIT 1000)').run();
}

export function getMetricasResumen(horasAtras = 24) {
    const db = getDB();
    const desde = Date.now() - horasAtras * 3600000;

    const tareasTotal = db.prepare('SELECT COUNT(*) as n FROM task_log WHERE timestamp > ?').get(desde)?.n || 0;
    const tareasExito = db.prepare('SELECT COUNT(*) as n FROM task_log WHERE timestamp > ? AND exito=1').get(desde)?.n || 0;
    const usuariosActivos = db.prepare('SELECT COUNT(DISTINCT userId) as n FROM task_log WHERE timestamp > ?').get(desde)?.n || 0;
    const toolMasUsada = db.prepare('SELECT tool, COUNT(*) as n FROM tool_usage WHERE timestamp > ? GROUP BY tool ORDER BY n DESC LIMIT 1').get(desde);
    const errores = db.prepare('SELECT COUNT(*) as n FROM tool_usage WHERE timestamp > ? AND exitoso=0').get(desde)?.n || 0;

    return { tareasTotal, tareasExito, usuariosActivos, toolMasUsada: toolMasUsada?.tool || 'ninguna', errores, horasAtras };
}

export function getToolStats(horasAtras = 24) {
    const desde = Date.now() - horasAtras * 3600000;
    return getDB().prepare('SELECT tool, COUNT(*) as usos, SUM(exitoso) as exitosos FROM tool_usage WHERE timestamp > ? GROUP BY tool ORDER BY usos DESC').all(desde);
}

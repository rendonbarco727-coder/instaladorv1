import Database from 'better-sqlite3';
import { ROOT_DIR } from '../config/bmo.config.js';

const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`
let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                objetivo TEXT NOT NULL,
                estado TEXT DEFAULT 'pending',
                progreso INTEGER DEFAULT 0,
                resultado TEXT,
                intentos INTEGER DEFAULT 0,
                creado_en INTEGER,
                actualizado_en INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(user_id);
            CREATE INDEX IF NOT EXISTS idx_goals_estado ON goals(estado);
        `);
    }
    return db;
}

export function crearGoal(userId, objetivo) {
    if (!userId) {
        console.error('[GOAL] crearGoal rechazado: userId vacío');
        return null;
    }
    if (!objetivo || !objetivo.trim()) {
        console.log('[GOAL] crearGoal rechazado: objetivo vacío');
        return null;
    }
    const db = getDB();
    const ahora = Date.now();
    const { lastInsertRowid } = db.prepare(
        'INSERT INTO goals (user_id, objetivo, estado, progreso, creado_en, actualizado_en) VALUES (?,?,?,?,?,?)'
    ).run(userId, objetivo, 'pending', 0, ahora, ahora);
    console.log(`[GOAL] Creado #${lastInsertRowid}: ${objetivo.slice(0, 60)}`);
    return lastInsertRowid;
}

export function listarGoalsTodos(userId) {
    const db = getDB();
    return db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY creado_en DESC LIMIT 100').all(userId);
}

export function listarGoals(userId, solo = null) {
    const db = getDB();
    if (solo) {
        return db.prepare('SELECT * FROM goals WHERE user_id=? AND estado=? ORDER BY creado_en DESC').all(userId, solo);
    }
    return db.prepare('SELECT * FROM goals WHERE user_id=? AND estado != ? ORDER BY creado_en DESC LIMIT 20').all(userId, 'completed');
}

export function getGoal(goalId) {
    return getDB().prepare('SELECT * FROM goals WHERE id=?').get(goalId);
}

export function actualizarEstado(goalId, estado) {
    getDB().prepare('UPDATE goals SET estado=?, actualizado_en=? WHERE id=?').run(estado, Date.now(), goalId);
    console.log(`[GOAL] #${goalId} → ${estado}`);
}

export function actualizarProgreso(goalId, progreso, resultado = null) {
    const db = getDB();
    if (resultado) {
        db.prepare('UPDATE goals SET progreso=?, resultado=?, actualizado_en=? WHERE id=?').run(progreso, resultado.slice(0,500), Date.now(), goalId);
    } else {
        db.prepare('UPDATE goals SET progreso=?, actualizado_en=? WHERE id=?').run(progreso, Date.now(), goalId);
    }
    console.log(`[GOAL] #${goalId} progreso=${progreso}%`);
}

export function marcarCompleto(goalId, resultado = null) {
    const db = getDB();
    db.prepare('UPDATE goals SET estado=?, progreso=100, resultado=?, actualizado_en=? WHERE id=?').run('completed', resultado?.slice(0,500) || null, Date.now(), goalId);
    console.log(`[GOAL] #${goalId} completado`);
}

export function marcarFallido(goalId, razon = null) {
    getDB().prepare('UPDATE goals SET estado=?, resultado=?, actualizado_en=? WHERE id=?').run('failed', razon?.slice(0,200) || null, Date.now(), goalId);
    console.log(`[GOAL] #${goalId} fallido: ${razon?.slice(0,50)}`);
}

export function incrementarIntentos(goalId) {
    getDB().prepare('UPDATE goals SET intentos=intentos+1, actualizado_en=? WHERE id=?').run(Date.now(), goalId);
}

export function getPendientes() {
    return getDB().prepare("SELECT * FROM goals WHERE estado IN ('pending','running') ORDER BY creado_en ASC LIMIT 5").all();
}

export function formatearGoals(goals) {
    if (!goals.length) return 'No tienes objetivos activos.';
    const iconos = { pending:'⏳', running:'🔄', paused:'⏸️', completed:'✅', failed:'❌' };
    return '*Tus objetivos:*\n\n' + goals.map((g,i) =>
        `${i+1}. ${iconos[g.estado] || '•'} ${g.objetivo.slice(0,60)}\n   Progreso: ${g.progreso}% | Estado: ${g.estado}`
    ).join('\n\n');
}

export function eliminarGoal(goalId) {
    const result = getDB().prepare('DELETE FROM goals WHERE id=?').run(goalId);
    if (result.changes > 0) {
        console.log(`[GOAL] #${goalId} eliminado`);
        return true;
    }
    return false;
}

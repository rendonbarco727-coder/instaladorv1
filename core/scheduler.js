import { ejecutarAgente } from './orchestrator.js';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ROOT_DIR } from '../config/bmo.config.js';

const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`
const INTERVAL_MS = 5 * 60 * 1000; // cada 5 min
let clienteWA = null;
let adminId = null;
let _intervalo = null;

let _db = null;
function getDB() {
    if (_db) return _db;
    const db = new Database(DB_PATH);
    _db = db;
    db.exec(`
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id TEXT PRIMARY KEY,
            nombre TEXT,
            objetivo TEXT,
            una_vez INTEGER DEFAULT 0,
            delay_ms INTEGER DEFAULT 0,
            proxima_ejecucion INTEGER,
            ultima_ejecucion INTEGER,
            ejecutada INTEGER DEFAULT 0,
            activa INTEGER DEFAULT 1,
            creado INTEGER
        );
    `);
    return db;
}

export function iniciarScheduler(client, userId) {
    clienteWA = client;
    adminId = userId;
    if (_intervalo) return;
    _intervalo = setInterval(ejecutarPendientes, INTERVAL_MS);
    console.log('[SCHEDULER] Iniciado con persistencia SQLite, intervalo 5min');
    // Reportar tareas activas al arrancar
    const tareas = listarTareas();
    if (tareas.length > 0) {
        console.log(`[SCHEDULER] ${tareas.length} tareas recuperadas del disco`);
    }
}

export function programarTarea(nombre, objetivo, opciones = {}) {
    const { unaVez = false, delayMs = 0 } = opciones;
    const id = 'sched_' + randomUUID().slice(0, 8);
    const ahora = Date.now();
    const db = getDB();
    db.prepare(`
        INSERT INTO scheduled_tasks (id, nombre, objetivo, una_vez, delay_ms, proxima_ejecucion, ejecutada, activa, creado)
        VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)
    `).run(id, nombre, objetivo, unaVez ? 1 : 0, delayMs, ahora + (delayMs || INTERVAL_MS), ahora);
    console.log(`[SCHEDULER] Tarea persistida: ${nombre} (${id})`);
    return id;
}

export function cancelarTarea(id) {
    getDB().prepare('UPDATE scheduled_tasks SET activa=0 WHERE id=?').run(id);
    console.log(`[SCHEDULER] Tarea cancelada: ${id}`);
}

export function listarTareas() {
    return getDB().prepare('SELECT * FROM scheduled_tasks WHERE activa=1 ORDER BY creado DESC').all();
}

async function ejecutarPendientes() {
    if (!clienteWA || !adminId) return;
    const ahora = Date.now();
    const db = getDB();
    const pendientes = db.prepare(`
        SELECT * FROM scheduled_tasks 
        WHERE activa=1 AND proxima_ejecucion <= ? AND (una_vez=0 OR ejecutada=0)
    `).all(ahora);

    for (const tarea of pendientes) {
        console.log(`[SCHEDULER] Ejecutando: ${tarea.nombre}`);
        try {
            await ejecutarAgente(tarea.objetivo, adminId, clienteWA);
            if (tarea.una_vez) {
                db.prepare('UPDATE scheduled_tasks SET ejecutada=1, ultima_ejecucion=?, activa=0 WHERE id=?').run(ahora, tarea.id);
            } else {
                db.prepare('UPDATE scheduled_tasks SET ejecutada=1, ultima_ejecucion=?, proxima_ejecucion=? WHERE id=?').run(ahora, ahora + INTERVAL_MS, tarea.id);
            }
        } catch(e) {
            console.error(`[SCHEDULER] Error en ${tarea.nombre}:`, e.message);
        }
    }
}

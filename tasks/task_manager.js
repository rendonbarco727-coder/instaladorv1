import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ROOT_DIR } from '../config/bmo.config.js';

const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`;
let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                objetivo TEXT,
                descripcion TEXT,
                herramienta TEXT,
                input TEXT,
                estado TEXT DEFAULT 'pending',
                intentos INTEGER DEFAULT 0,
                resultado TEXT,
                userId TEXT,
                sesion_id TEXT,
                dependencias TEXT DEFAULT '[]',
                prioridad INTEGER DEFAULT 1,
                creado INTEGER,
                actualizado INTEGER
            );
        `);
    }
    return db;
}

// Crear nueva tarea
export function crearTarea(data) {
    const db = getDB();
    const id = 'task_' + randomUUID().slice(0, 8);
    const ahora = Date.now();
    db.prepare(`
        INSERT INTO tasks (id,objetivo,descripcion,herramienta,input,estado,intentos,resultado,userId,sesion_id,dependencias,prioridad,creado,actualizado)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
        id,
        data.objetivo || '',
        data.descripcion || '',
        data.herramienta || data.accion || '',
        String(data.input || '').replace(/\?/g, ''), // sanitizar ? para SQLite
        'pending',
        0,
        '',
        data.userId || '',
        data.sesion_id || '',
        JSON.stringify(data.dependencias || []),
        data.prioridad || 1,
        ahora, ahora
    );
    return id;
}

// Crear múltiples tareas desde un plan
export function crearTareasDesdePlan(plan, userId, sesion_id) {
    const ids = [];
    for (const paso of plan) {
        const id = crearTarea({
            objetivo: paso.descripcion || paso.accion,
            descripcion: paso.descripcion || '',
            herramienta: paso.accion,
            input: String(paso.input || '').replace(/\?/g, ''), // sanitizar ? para SQLite
            userId,
            sesion_id,
            prioridad: paso.paso || 1
        });
        ids.push(id);
    }
    console.log(`[TASK_MANAGER] ${ids.length} tareas creadas para sesion ${sesion_id}`);
    return ids;
}

// Obtener próxima tarea pending de una sesión
export function obtenerSiguienteTarea(sesion_id) {
    return getDB().prepare(`
        SELECT * FROM tasks 
        WHERE sesion_id=? AND estado='pending' 
        ORDER BY prioridad ASC, creado ASC 
        LIMIT 1
    `).get(sesion_id) || null;
}

// Verificar si ya existe tarea duplicada activa
export function existeTareaDuplicada(herramienta, input, userId, sesion_id) {
    const tarea = getDB().prepare(`
        SELECT id FROM tasks 
        WHERE herramienta=? AND input=? AND userId=? 
        AND sesion_id != ?
        AND estado IN ('pending','running')
        AND creado > ?
    `).get(herramienta, input, userId, sesion_id, Date.now() - 60000);
    return !!tarea;
}

// Marcar tarea como running
export function iniciarTarea(id) {
    getDB().prepare(`
        UPDATE tasks SET estado='running', intentos=intentos+1, actualizado=? WHERE id=?
    `).run(Date.now(), id);
}

// Marcar tarea como completada
export function completarTarea(id, resultado) {
    getDB().prepare(`
        UPDATE tasks SET estado='completed', resultado=?, actualizado=? WHERE id=?
    `).run(String(resultado || '').slice(0, 1000), Date.now(), id);
}

// Marcar tarea como fallida
export function fallarTarea(id, error) {
    const tarea = getDB().prepare('SELECT intentos FROM tasks WHERE id=?').get(id);
    const maxIntentos = 2;
    if (tarea && tarea.intentos >= maxIntentos) {
        getDB().prepare(`
            UPDATE tasks SET estado='failed', resultado=?, actualizado=? WHERE id=?
        `).run(String(error || '').slice(0, 500), Date.now(), id);
    } else {
        // Volver a pending para reintento
        getDB().prepare(`
            UPDATE tasks SET estado='pending', actualizado=? WHERE id=?
        `).run(Date.now(), id);
    }
}

// Verificar si dependencias están completas
export function dependenciasCompletas(id) {
    const tarea = getDB().prepare('SELECT dependencias FROM tasks WHERE id=?').get(id);
    if (!tarea) return true;
    const deps = JSON.parse(tarea.dependencias || '[]');
    if (!deps.length) return true;
    
    for (const depId of deps) {
        const dep = getDB().prepare('SELECT estado FROM tasks WHERE id=?').get(depId);
        if (!dep || dep.estado !== 'completed') return false;
    }
    return true;
}

// Obtener estado completo de una sesión
export function estadoSesion(sesion_id) {
    const tareas = getDB().prepare('SELECT * FROM tasks WHERE sesion_id=? ORDER BY prioridad ASC').all(sesion_id);
    const total = tareas.length;
    const completadas = tareas.filter(t => t.estado === 'completed').length;
    const fallidas = tareas.filter(t => t.estado === 'failed').length;
    const pendientes = tareas.filter(t => t.estado === 'pending').length;
    const corriendo = tareas.filter(t => t.estado === 'running').length;
    
    return { total, completadas, fallidas, pendientes, corriendo, tareas };
}

// Obtener resultado de tarea completada
export function obtenerResultado(id) {
    const tarea = getDB().prepare('SELECT resultado, estado FROM tasks WHERE id=?').get(id);
    return tarea?.estado === 'completed' ? tarea.resultado : null;
}

// Limpiar tareas viejas (más de 24h)
export function limpiarTareasViejas() {
    const borradas = getDB().prepare(`
        DELETE FROM tasks WHERE creado < ? AND estado IN ('completed','failed')
    `).run(Date.now() - 86400000);
    // También limpiar pending muy viejas (más de 6h)
    getDB().prepare("DELETE FROM tasks WHERE creado < ? AND estado='pending'").run(Date.now() - 6*3600000);
    // Resolver huérfanas en running (más de 1h)
    getDB().prepare("UPDATE tasks SET estado='failed', resultado='Timeout' WHERE estado='running' AND actualizado < ?").run(Date.now() - 3600000);
    if (borradas.changes > 0) console.log(`[TASK_MANAGER] ${borradas.changes} tareas antiguas eliminadas`);
}

// Obtener todas las tareas activas de un usuario
export function tareasActivasUsuario(userId) {
    return getDB().prepare(`
        SELECT id, objetivo, herramienta, estado, intentos, creado 
        FROM tasks WHERE userId=? AND estado IN ('pending','running')
        ORDER BY creado DESC
    `).all(userId);
}

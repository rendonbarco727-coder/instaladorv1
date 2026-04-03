import Database from 'better-sqlite3';
import { ROOT_DIR } from '../config/bmo.config.js';

const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`;
let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS wm_entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT UNIQUE,
                tipo TEXT,
                atributos TEXT DEFAULT '{}',
                timestamp INTEGER
            );
            CREATE TABLE IF NOT EXISTS wm_relations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entidad_a TEXT, relacion TEXT, entidad_b TEXT,
                peso REAL DEFAULT 1.0, timestamp INTEGER,
                UNIQUE(entidad_a, relacion, entidad_b)
            );
            CREATE TABLE IF NOT EXISTS wm_facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hecho TEXT UNIQUE, confianza REAL DEFAULT 1.0,
                fuente TEXT, timestamp INTEGER
            );
        `);
    }
    return db;
}

export function upsertEntidad(nombre, tipo, atributos = {}) {
    const db = getDB();
    const existe = db.prepare('SELECT id FROM wm_entities WHERE nombre=?').get(nombre);
    if (existe) {
        db.prepare('UPDATE wm_entities SET tipo=?, atributos=?, timestamp=? WHERE nombre=?').run(tipo, JSON.stringify(atributos), Date.now(), nombre);
    } else {
        db.prepare('INSERT INTO wm_entities (nombre,tipo,atributos,timestamp) VALUES (?,?,?,?)').run(nombre, tipo, JSON.stringify(atributos), Date.now());
    }
}

export function agregarRelacion(entidadA, relacion, entidadB, peso = 1.0) {
    try {
        getDB().prepare('INSERT OR REPLACE INTO wm_relations (entidad_a,relacion,entidad_b,peso,timestamp) VALUES (?,?,?,?,?)').run(entidadA, relacion, entidadB, peso, Date.now());
    } catch(e) {}
}

export function agregarHecho(hecho, confianza = 1.0, fuente = 'agente') {
    try {
        getDB().prepare('INSERT OR REPLACE INTO wm_facts (hecho,confianza,fuente,timestamp) VALUES (?,?,?,?)').run(hecho, confianza, fuente, Date.now());
    } catch(e) {}
}

export function getEntidad(nombre) {
    const e = getDB().prepare('SELECT * FROM wm_entities WHERE nombre=?').get(nombre);
    if (!e) return null;
    return { ...e, atributos: JSON.parse(e.atributos || '{}') };
}

export function getRelaciones(entidad) {
    return getDB().prepare('SELECT * FROM wm_relations WHERE entidad_a=? OR entidad_b=? ORDER BY peso DESC').all(entidad, entidad);
}

export function limpiarWorldModel() {
    const db = getDB();
    const semana = Date.now() - 7*24*3600000;
    // Mantener max 200 entidades, 500 facts, 500 relations
    db.prepare("DELETE FROM wm_entities WHERE timestamp < ? AND id NOT IN (SELECT id FROM wm_entities ORDER BY timestamp DESC LIMIT 200)").run(semana);
    db.prepare("DELETE FROM wm_facts WHERE timestamp < ? AND id NOT IN (SELECT id FROM wm_facts ORDER BY confianza DESC, timestamp DESC LIMIT 500)").run(semana);
    db.prepare("DELETE FROM wm_relations WHERE timestamp < ?").run(semana);
    console.log('[WORLD_MODEL] Limpieza completada');
}

export function getHechos(limit = 10) {
    return getDB().prepare('SELECT hecho,confianza FROM wm_facts ORDER BY confianza DESC, timestamp DESC LIMIT ?').all(limit);
}

// Actualizar world model desde resultado de tarea
export function actualizarDesdeResultado(userId, objetivo, resultados) {
    // Registrar usuario
    upsertEntidad(userId, 'usuario', { ultima_actividad: Date.now() });
    // Registrar tarea como hecho
    const exitosos = resultados.filter(r => r.evaluacion?.success || r.evaluacion?.exitoso).length;
    agregarHecho(`usuario ${userId} completó: ${objetivo.slice(0,80)}`, exitosos / Math.max(resultados.length, 1), 'reflexion');
    // Registrar herramientas usadas
    for (const r of resultados) {
        if (r.accion) {
            upsertEntidad(r.accion, 'herramienta', {});
            agregarRelacion(userId, 'uso', r.accion, 1.0);
        }
    }
}

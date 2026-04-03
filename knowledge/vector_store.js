import Database from 'better-sqlite3';
import fs from 'fs';
import { generarEmbedding, similitudCoseno } from './embeddings.js';
import { ROOT_DIR } from '../config/bmo.config.js';

const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`;
let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS knowledge (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tipo TEXT,
                texto TEXT,
                embedding TEXT,
                metadata TEXT DEFAULT '{}',
                userId TEXT DEFAULT 'global',
                importancia INTEGER DEFAULT 1,
                usos INTEGER DEFAULT 0,
                timestamp INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_knowledge_tipo ON knowledge(tipo);
            CREATE INDEX IF NOT EXISTS idx_knowledge_userId ON knowledge(userId);
        `);
    }
    return db;
}

// Guardar conocimiento nuevo
export async function guardarConocimiento(tipo, texto, metadata = {}, userId = 'global', importancia = 1) {
    const db = getDB();
    
    // Evitar duplicados exactos
    const existe = db.prepare('SELECT id FROM knowledge WHERE texto=? AND tipo=?').get(texto, tipo);
    if (existe) {
        db.prepare('UPDATE knowledge SET usos=usos+1, importancia=importancia+1 WHERE id=?').run(existe.id);
        return existe.id;
    }

    const embedding = await generarEmbedding(texto);
    const id = db.prepare(`
        INSERT INTO knowledge (tipo, texto, embedding, metadata, userId, importancia, usos, timestamp)
        VALUES (?,?,?,?,?,?,0,?)
    `).run(tipo, texto.slice(0, 1000), JSON.stringify(embedding), JSON.stringify(metadata), userId, importancia, Date.now()).lastInsertRowid;
    
    console.log(`[KNOWLEDGE] Guardado [${tipo}]: ${texto.slice(0,60)}`);
    return id;
}

// Buscar conocimiento relevante por similitud semántica
export async function buscarConocimiento(query, opciones = {}) {
    const { limit = 5, tipo = null, userId = 'global', umbral = 0.3 } = opciones;
    const db = getDB();

    let sql = 'SELECT * FROM knowledge WHERE 1=1';
    const params = [];
    if (tipo) { sql += ' AND tipo=?'; params.push(tipo); }
    sql += ' ORDER BY importancia DESC, usos DESC LIMIT 100';

    const todos = db.prepare(sql).all(...params);
    if (!todos.length) return [];

    const queryEmbedding = await generarEmbedding(query);

    // Calcular similitud con cada entrada
    const conSimilitud = todos.map(item => {
        try {
            const emb = JSON.parse(item.embedding || '[]');
            const sim = similitudCoseno(queryEmbedding, emb);
            return { ...item, similitud: sim };
        } catch(e) {
            return { ...item, similitud: 0 };
        }
    });

    // Filtrar por umbral y ordenar
    return conSimilitud
        .filter(i => i.similitud >= umbral)
        .sort((a, b) => b.similitud - a.similitud)
        .slice(0, limit)
        .map(i => ({
            tipo: i.tipo,
            texto: i.texto,
            metadata: JSON.parse(i.metadata || '{}'),
            similitud: Math.round(i.similitud * 100),
            usos: i.usos
        }));
}

// Obtener contexto relevante formateado para el planner
export async function obtenerContextoRelevante(objetivo, userId = 'global') {
    const resultados = await buscarConocimiento(objetivo, { limit: 4, umbral: 0.25 });
    if (!resultados.length) return '';
    
    return resultados.map(r => `[${r.tipo}] ${r.texto}`).join('\n');
}

// Guardar aprendizaje post-tarea
export async function aprenderDeTarea(objetivo, resultados, userId) {
    // Guardar el objetivo completado
    await guardarConocimiento('tarea_exitosa', objetivo, { timestamp: Date.now() }, userId, 2);

    // Guardar herramientas que funcionaron
    for (const paso of resultados) {
        if ((paso.evaluacion?.success ?? paso.evaluacion?.exitoso) && paso.accion !== 'enviar_mensaje') {
            const conocimiento = `Para "${paso.descripcion || paso.accion}" usar herramienta ${paso.accion} con input: ${String(paso.input || '').slice(0, 100)}`;
            await guardarConocimiento('herramienta_exitosa', conocimiento, { accion: paso.accion }, userId, 1);
        }
    }

    // Guardar errores para evitarlos
    for (const paso of resultados) {
        if (!(paso.evaluacion?.success ?? paso.evaluacion?.exitoso) && paso.evaluacion?.problema) {
            await guardarConocimiento('error_conocido', paso.evaluacion.problema, { accion: paso.accion }, userId, 1);
        }
    }
}

// Listar conocimiento por tipo
export function limpiarKnowledge() {
    const db = getDB();
    const semana = Date.now() - 7*24*3600000;
    // Eliminar conocimiento viejo sin usos
    const r1 = db.prepare("DELETE FROM knowledge WHERE usos = 0 AND timestamp < ?").run(semana);
    // Mantener max 500 registros — eliminar los menos importantes
    const total = db.prepare("SELECT COUNT(*) as n FROM knowledge").get()?.n || 0;
    let r2 = { changes: 0 };
    if (total > 500) {
        r2 = db.prepare("DELETE FROM knowledge WHERE id NOT IN (SELECT id FROM knowledge ORDER BY importancia DESC, usos DESC, timestamp DESC LIMIT 500)").run();
    }
    console.log('[KNOWLEDGE] Limpieza: eliminados', r1.changes + r2.changes, 'registros');
    return r1.changes + r2.changes;
}

export function listarConocimiento(tipo = null, limit = 20) {
    const db = getDB();
    if (tipo) {
        return db.prepare('SELECT tipo,texto,usos,importancia FROM knowledge WHERE tipo=? ORDER BY importancia DESC LIMIT ?').all(tipo, limit);
    }
    return db.prepare('SELECT tipo,texto,usos,importancia FROM knowledge ORDER BY importancia DESC, usos DESC LIMIT ?').all(limit);
}

// Incrementar usos cuando se usa conocimiento
export function marcarUso(texto) {
    getDB().prepare('UPDATE knowledge SET usos=usos+1 WHERE texto=?').run(texto);
}

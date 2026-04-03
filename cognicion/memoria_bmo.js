/**
 * Memoria vectorial de BMO usando SQLite
 * Recuerda preferencias, contexto y hechos importantes
 */
import Database from 'better-sqlite3';
import { getEmbedding, cosineSimilarity } from '../core/embeddings.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'memoria_bmo.db');

let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.exec(`
            CREATE TABLE IF NOT EXISTS memorias (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario TEXT NOT NULL,
                tipo TEXT NOT NULL,
                contenido TEXT NOT NULL,
                keywords TEXT NOT NULL,
                importancia INTEGER DEFAULT 1,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                accesos INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_usuario ON memorias(usuario);
            CREATE INDEX IF NOT EXISTS idx_tipo ON memorias(tipo);
        `);
        try { db.exec('ALTER TABLE memorias ADD COLUMN embedding TEXT'); } catch(e) {}
    }
    return db;
}

// Extraer keywords de un texto
function extraerKeywords(texto) {
    const stopwords = new Set(['el','la','los','las','un','una','de','del','en','con','que','se','es','por','para','a','y','o','no','si','me','te','le','lo','su','mi','tu']);
    return texto.toLowerCase()
        .replace(/[^a-záéíóúüñ\s]/gi, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stopwords.has(w))
        .slice(0, 15)
        .join(',');
}

// Calcular relevancia entre dos sets de keywords
function calcularRelevancia(keywords1, keywords2) {
    const set1 = new Set(keywords1.split(','));
    const set2 = new Set(keywords2.split(','));
    const interseccion = [...set1].filter(k => set2.has(k)).length;
    const union = new Set([...set1, ...set2]).size;
    return union > 0 ? interseccion / union : 0;
}

// Guardar memoria
export function guardarMemoria(userId, tipo, contenido, importancia = 1) {
    try {
        const db = getDB();
        const keywords = extraerKeywords(contenido);
        
        // Evitar duplicados similares
        const existente = db.prepare(`
            SELECT id FROM memorias 
            WHERE usuario = ? AND tipo = ? AND contenido = ?
        `).get(userId, tipo, contenido);
        
        if (existente) {
            db.prepare('UPDATE memorias SET accesos = accesos + 1, timestamp = CURRENT_TIMESTAMP WHERE id = ?')
              .run(existente.id);
            return;
        }
        
        db.prepare(`
            INSERT INTO memorias (usuario, tipo, contenido, keywords, importancia)
            VALUES (?, ?, ?, ?, ?)
        `).run(userId, tipo, contenido, keywords, importancia);
        
        // Mantener máximo 200 memorias por usuario
        db.prepare(`
            DELETE FROM memorias WHERE usuario = ? AND id NOT IN (
                SELECT id FROM memorias WHERE usuario = ? 
                ORDER BY importancia DESC, timestamp DESC LIMIT 200
            )
        `).run(userId, userId);
        
    } catch(e) {
        console.error('[MEMORIA] Error guardando:', e.message);
    }
}

// Buscar memorias relevantes
export async function buscarMemoriasRelevantes(userId, consulta, limite = 5) {
    try {
        const { getEmbedding, buscarSimilar } = await import('../core/embeddings.js');
        const db = getDB();

        // Agregar columna embedding si no existe
        try { db.exec('ALTER TABLE memorias ADD COLUMN embedding TEXT'); } catch(e) {}

        // FTS5 rápido para candidatos
        const ftsQuery = consulta.trim().split(/\s+/).map(w => w + '*').join(' ');
        let candidatos = [];
        try {
            candidatos = db.prepare(`
                SELECT m.* FROM memorias m
                JOIN fts_memorias f ON m.id = f.rowid
                WHERE m.usuario = ? AND fts_memorias MATCH ?
                ORDER BY m.importancia DESC, m.timestamp DESC
                LIMIT 20
            `).all(userId, ftsQuery, );
        } catch(e) {}

        // Fallback si FTS vacío
        if (!candidatos.length) {
            candidatos = db.prepare(
                'SELECT * FROM memorias WHERE usuario=? ORDER BY importancia DESC, timestamp DESC LIMIT 30'
            ).all(userId);
        }

        if (!candidatos.length) return [];

        // Re-ranking semántico si hay embeddings
        const conEmb = candidatos.filter(m => m.embedding);
        if (conEmb.length >= 3) {
            const resultados = await buscarSimilar(consulta, conEmb, limite);
            // Fire-and-forget: generar embeddings para los que no tienen
            const sinEmb = candidatos.filter(m => !m.embedding).slice(0, 5);
            for (const m of sinEmb) {
                getEmbedding(m.contenido).then(vec => {
                    try {
                        const db2 = getDB();
                        db2.prepare('UPDATE memorias SET embedding=? WHERE id=?').run(JSON.stringify(vec), m.id);
                    } catch(e) {}
                }).catch(() => {});
            }
            return resultados;
        }

        // Sin suficientes embeddings: FTS + generar embeddings en background
        const sinEmb = candidatos.filter(m => !m.embedding);
        for (const m of sinEmb.slice(0, 5)) {
            getEmbedding(m.contenido).then(vec => {
                try {
                    const db2 = getDB();
                    db2.prepare('UPDATE memorias SET embedding=? WHERE id=?').run(JSON.stringify(vec), m.id);
                } catch(e) {}
            }).catch(() => {});
        }
        return candidatos.slice(0, limite);

    } catch(e) {
        console.error('[MEMORIA] Error buscando:', e.message);
        return [];
    }
}

// Obtener resumen de memorias del usuario
export function obtenerResumenMemoria(userId) {
    try {
        const db = getDB();
        const memorias = db.prepare(`
            SELECT tipo, contenido FROM memorias 
            WHERE usuario = ? 
            ORDER BY importancia DESC, timestamp DESC 
            LIMIT 10
        `).all(userId);
        
        if (!memorias.length) return '';
        return memorias.map(m => `[${m.tipo}] ${m.contenido}`).join('\n');
    } catch(e) {
        return '';
    }
}

// Detectar y guardar hechos importantes de un mensaje
export function procesarMensajeParaMemoria(userId, mensaje, respuesta) {
    const msg = mensaje.toLowerCase();
    
    // Preferencias explícitas
    if (/prefiero|me gusta|me gustan|favorito|favorita/i.test(mensaje)) {
        guardarMemoria(userId, 'preferencia', mensaje, 3);
    }
    
    // Datos personales
    if (/me llamo|mi nombre es|soy [a-z]+/i.test(mensaje)) {
        guardarMemoria(userId, 'personal', mensaje, 5);
    }
    
    // Trabajo/profesión
    if (/trabajo en|trabajo como|soy (desarrollador|ingeniero|doctor|maestro|estudiante)/i.test(mensaje)) {
        guardarMemoria(userId, 'trabajo', mensaje, 4);
    }
    
    // Tareas completadas importantes
    if (respuesta && /reporte|documento|análisis/i.test(respuesta)) {
        guardarMemoria(userId, 'tarea_completada', `${mensaje.slice(0,100)}`, 2);
    }
    
    // Contexto general (importancia baja)
    if (mensaje.length > 20) {
        guardarMemoria(userId, 'conversacion', mensaje.slice(0, 150), 1);
    }
}

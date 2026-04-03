import Database from 'better-sqlite3';
import { execAsync } from '../core/context.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = '/home/ruben/wa-ollama/memory/bmo_memory.db';
const SKILLS_PATH = '/home/ruben/wa-ollama/skills';
let db;

function getDB() {
    if (!db) {
        try {
            db = new Database(DB_PATH);
            db.exec(`
                CREATE TABLE IF NOT EXISTS skills (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    nombre TEXT UNIQUE,
                    descripcion TEXT,
                    ruta TEXT,
                    exports TEXT DEFAULT '[]',
                    usos INTEGER DEFAULT 0,
                    aprobado INTEGER DEFAULT 1,
                    timestamp INTEGER
                );
            `);
        } catch(e) {
            console.error('[SKILLS] Error abriendo DB:', e.message);
            throw e;
        }
    }
    return db;
}

export function registrarSkill(nombre, descripcion, ruta, exports = []) {
    const db = getDB();
    const existe = db.prepare('SELECT id FROM skills WHERE nombre=?').get(nombre);
    if (existe) {
        db.prepare('UPDATE skills SET descripcion=?,ruta=?,exports=?,timestamp=? WHERE nombre=?').run(descripcion, ruta, JSON.stringify(exports), Date.now(), nombre);
    } else {
        db.prepare('INSERT INTO skills (nombre,descripcion,ruta,exports,usos,aprobado,timestamp) VALUES (?,?,?,?,0,1,?)').run(nombre, descripcion, ruta, JSON.stringify(exports), Date.now());
        console.log(`[SKILLS] Registrada: ${nombre}`);
    }
}

export function listarSkills() {
    return getDB().prepare('SELECT nombre,descripcion,usos FROM skills WHERE aprobado=1 ORDER BY usos DESC').all();
}

export function getSkill(nombre) {
    return getDB().prepare('SELECT * FROM skills WHERE nombre=? AND aprobado=1').get(nombre);
}

export function usarSkill(nombre) {
    getDB().prepare('UPDATE skills SET usos=usos+1 WHERE nombre=?').run(nombre);
}

// Auto-descubrir skills — soporta formato JS y formato OpenClaw (carpeta/SKILL.md)
export function autoDescubrirSkills() {
    let total = 0;
    if (!fs.existsSync(SKILLS_PATH)) {
        console.warn('[SKILLS] Directorio skills no encontrado:', SKILLS_PATH);
        return;
    }

    // Formato original: archivos .js
    const archivos = fs.readdirSync(SKILLS_PATH).filter(f => f.endsWith('.js') && f !== 'skill_registry.js');
    for (const archivo of archivos) {
        const nombre = path.basename(archivo, '.js');
        const ruta = path.join(SKILLS_PATH, archivo);
        const existe = getDB().prepare('SELECT id FROM skills WHERE nombre=?').get(nombre);
        if (!existe) {
            registrarSkill(nombre, `Skill: ${nombre}`, ruta);
            total++;
        }
    }

    // Formato OpenClaw: carpetas con SKILL.md
    const carpetas = fs.readdirSync(SKILLS_PATH).filter(f => {
        const full = path.join(SKILLS_PATH, f);
        return fs.statSync(full).isDirectory();
    });
    for (const carpeta of carpetas) {
        const skillMd = path.join(SKILLS_PATH, carpeta, 'SKILL.md');
        if (!fs.existsSync(skillMd)) continue;
        try {
            const contenido = fs.readFileSync(skillMd, 'utf8');
            // Extraer frontmatter YAML
            const nameMatch = contenido.match(/^name:\s*(.+)$/m);
            const descMatch = contenido.match(/^description:\s*(.+)$/m);
            const nombre = nameMatch?.[1]?.trim() || carpeta;
            const descripcion = descMatch?.[1]?.trim() || `OpenClaw skill: ${carpeta}`;
            const ruta = path.join(SKILLS_PATH, carpeta);
            const existe = getDB().prepare('SELECT id FROM skills WHERE nombre=?').get(nombre);
            if (!existe) {
                registrarSkill(nombre, descripcion, ruta);
                console.log(`[SKILLS] OpenClaw skill descubierta: ${nombre}`);
                total++;
            }
        } catch(e) {
            console.warn(`[SKILLS] Error leyendo skill ${carpeta}:`, e.message);
        }
    }

    if (total) console.log(`[SKILLS] ${total} nuevas skills descubiertas`);
}

// Leer contenido de un SKILL.md para inyectarlo en el contexto del agente
export function leerSkillMd(nombre) {
    if (!nombre || typeof nombre !== 'string' || nombre.includes('..')) return null;
    const skill = getDB().prepare('SELECT ruta FROM skills WHERE nombre=?').get(nombre);
    if (!skill) return null;
    const skillMd = path.join(skill.ruta, 'SKILL.md');
    if (!skillMd.startsWith(SKILLS_PATH)) return null;
    if (fs.existsSync(skillMd)) return fs.readFileSync(skillMd, 'utf8');
    return null;
}

// ── AUTO-DISCOVERY desde OpenClaw Hub ─────────────────────────────────
const HUB_API = 'https://api.github.com/repos/openclaw/openclaw/contents/skills';
const HUB_RAW = 'https://raw.githubusercontent.com/openclaw/openclaw/main/skills';

export async function buscarSkillEnHub(objetivo) {
    try {
        const listaCmd = `curl -sf --max-time 10 -H 'User-Agent: BMO-bot' '${HUB_API}'`;
        const listaRaw = await execAsync(listaCmd).catch(() => null);
        if (!listaRaw) return null;
        let lista;
        try { lista = JSON.parse(listaRaw); } catch(e) { return null; }
        if (!Array.isArray(lista)) return null;

        const palabrasObj = objetivo.toLowerCase()
            .replace(/[^a-z0-9\s]/gi, ' ')
            .split(/\s+/)
            .filter(p => p.length > 2);

        // Candidatos: match por slug O por palabras clave comunes
        const candidatos = lista.filter(item => {
            if (item.type !== 'dir') return false;
            const slug = item.name.toLowerCase();
            const slugWords = slug.replace(/-/g, ' ').split(' ');
            return palabrasObj.some(p => slugWords.some(s => s.includes(p) || p.includes(s)));
        });

        // Si no hay candidatos por slug, intentar con los primeros 8 del Hub leyendo su descripción
        const aRevisar = candidatos.length > 0 ? candidatos.slice(0, 3) : lista.slice(0, 8);

        for (const item of aRevisar) {
            const slug = item.name;
            try {
                const mdUrl = `${HUB_RAW}/${slug}/SKILL.md`;
                const mdRaw = await execAsync(`curl -sf --max-time 8 '${mdUrl}'`).catch(() => null);
                if (!mdRaw || mdRaw.length < 20) continue;

                const nameMatch = mdRaw.match(/^name:\s*(.+)$/m);
                const descMatch = mdRaw.match(/^description:\s*(.+)$/m);
                const nombre = nameMatch?.[1]?.trim() || slug;
                const descripcion = descMatch?.[1]?.trim() || '';

                // Match por descripción también
                const descWords = descripcion.toLowerCase().split(/\s+/);
                const matchDesc = palabrasObj.some(p => descWords.some(s => s.includes(p) || p.includes(s)));
                if (!matchDesc && candidatos.length === 0) continue;

                // Validar con LLM si la skill realmente sirve para el objetivo
                try {
                    const { callModel } = await import('../core/model_router.js');
                    const veredicto = await callModel('rapido',
                        `Responde SOLO con "si" o "no", sin explicación.\nPregunta: ¿La skill "${nombre}" (${descripcion}) puede realizar esta acción específica: "${objetivo}"?\nCondición: solo di "si" si la skill menciona explícitamente el servicio o acción pedida.`
                    );
                    const aprobada = veredicto && veredicto.toLowerCase().trim().startsWith('si');
                    if (!aprobada) {
                        console.log(`[SKILLS] LLM rechazó skill ${slug} para: ${objetivo.slice(0,40)}`);
                        continue;
                    }
                    console.log(`[SKILLS] LLM aprobó skill ${slug}`);
                } catch(e) {
                    console.log(`[SKILLS] Validación LLM falló, saltando: ${slug}`);
                    continue;
                }

                const rutaSkill = path.join(SKILLS_PATH, slug);
                fs.mkdirSync(rutaSkill, { recursive: true });
                fs.writeFileSync(path.join(rutaSkill, 'SKILL.md'), mdRaw);
                registrarSkill(nombre, descripcion || `Hub skill: ${slug}`, rutaSkill);
                console.log(`[SKILLS] Auto-instalada desde Hub: ${slug}`);
                return { slug, nombre, descripcion };
            } catch(e) { continue; }
        }
        return null;
    } catch(e) {
        console.log('[SKILLS] Hub no disponible:', e.message.slice(0, 60));
        return null;
    }
}


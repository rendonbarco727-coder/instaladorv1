/**
 * BMO — Configuración central
 * Para distribuir: copiar este archivo y editar los valores
 * Variables de entorno tienen prioridad sobre defaults
 */
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.BMO_ROOT || path.resolve(__dirname, '..');

export const CONFIG = {
  // ── Identidad ──────────────────────────────────────────────
  admin_ids: (process.env.BMO_ADMIN_IDS || (() => { console.warn('[CONFIG] BMO_ADMIN_IDS no definido en env, usando default'); return '100365164921028'; })()).split(','),
  admin_wa:  process.env.BMO_ADMIN_WA  || '100365164921028@lid',
  bot_name:  process.env.BMO_NAME      || 'BMO',

  // ── Rutas ──────────────────────────────────────────────────
  root:      ROOT,
  soul_path: process.env.BMO_SOUL      || path.join(ROOT, 'SOUL.md'),
  db_memory: process.env.BMO_DB_MEMORY || path.join(ROOT, 'memory/bmo_memory.db'),
  db_cognicion: process.env.BMO_DB_COG || path.join(ROOT, 'cognicion/memoria_bmo.db'),
  skills_dir:   process.env.BMO_SKILLS || path.join(ROOT, 'skills'),
  evoluciones_dir: process.env.BMO_EVOLUCIONES || path.join(ROOT, 'evoluciones'),
  archivos_dir:    process.env.BMO_ARCHIVOS    || path.join(ROOT, 'archivos'),
  backups_dir:     process.env.BMO_BACKUPS     || path.join(ROOT, 'backups'),
  sandbox_dir:     process.env.BMO_SANDBOX     || path.join(ROOT, 'sandbox'),

  // ── Archivos de estado ─────────────────────────────────────
  files: {
    voluntad:     path.join(ROOT, 'voluntad.json'),
    autonomia:    path.join(ROOT, 'autonomia.json'),
    evoluciones:  path.join(ROOT, 'evoluciones.json'),
    experimentos: path.join(ROOT, 'experimentos.json'),
    contexto:     path.join(ROOT, 'contexto_sesion.json'),
    memoria_cmds: path.join(ROOT, 'memoria_comandos.json'),
    errores:      path.join(ROOT, 'errores_autocodigo.json'),
    heartbeat:    path.join(ROOT, 'HEARTBEAT.md'),
    heartbeat_cooldown: path.join(ROOT, 'memory/heartbeat_cooldown.json'),
    corrector_log: path.join(ROOT, 'corrector.log'),
  },

  // ── Ciclo autónomo ─────────────────────────────────────────
  autonomy: {
    intervalo_ms:    (v => isNaN(v) ? 30 * 60 * 1000 : v)(parseInt(process.env.BMO_AUTONOMY_INTERVAL)),
    max_goals_dia:   (v => isNaN(v) ? 3 : v)(parseInt(process.env.BMO_MAX_GOALS)),
    goal_interval_ms: (v => isNaN(v) ? 10 * 60 * 1000 : v)(parseInt(process.env.BMO_GOAL_INTERVAL)),
  },

  // ── LLM ────────────────────────────────────────────────────
  llm: {
    gemini_model:  process.env.BMO_GEMINI_MODEL  || 'gemini-2.5-flash',
    groq_default:  process.env.BMO_GROQ_MODEL    || 'llama-3.3-70b-versatile',
    groq_fast:     process.env.BMO_GROQ_FAST     || 'llama-3.1-8b-instant',
  },

  // ── Ciclo reflexivo ────────────────────────────────────────
  reflection: {
    enabled:        process.env.BMO_REFLECTION !== 'false',
    feed_world_model: true,
    feed_curiosity:   true,
  },
};

export const ADMIN_IDS = CONFIG.admin_ids;
export const ROOT_DIR  = ROOT;

// Helper para acceder a config con fallback seguro
export function getConfig(keyPath, fallback = null) {
    const keys = keyPath.split('.');
    let val = CONFIG;
    for (const k of keys) {
        if (val == null || typeof val !== 'object') return fallback;
        val = val[k];
    }
    return val ?? fallback;
}

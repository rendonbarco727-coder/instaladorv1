// core/session_history.js
import fs from 'fs';
import { flushContextoAntesDePoda, generarResumenCompacto } from './context_compaction.js';

const HISTORIAL_FILE = process.env.HISTORIAL_FILE || './historial.json';
const USUARIOS_FILE = process.env.USUARIOS_FILE || './usuarios.json';
const MAX_HISTORIAL = 10;

let historialData = {};
let usuariosConocidos = {};
const resumenes = {};

export function cargarHistorial() {
  if (fs.existsSync(HISTORIAL_FILE)) {
    try { historialData = JSON.parse(fs.readFileSync(HISTORIAL_FILE)); }
    catch { historialData = {}; }
  }
  if (fs.existsSync(USUARIOS_FILE)) {
    try { usuariosConocidos = JSON.parse(fs.readFileSync(USUARIOS_FILE)); }
    catch { usuariosConocidos = {}; }
  }
}

export function guardarUsuarios() {
  fs.writeFileSync(USUARIOS_FILE, JSON.stringify(usuariosConocidos, null, 2));
}

export function esUsuarioNuevo(id) {
  return !usuariosConocidos[id];
}

export function registrarUsuario(id, nombre) {
  usuariosConocidos[id] = { nombre, fechaRegistro: new Date().toISOString() };
  guardarUsuarios();
}

export function getNombreUsuario(id) {
  return usuariosConocidos[id]?.nombre || null;
}

export function guardarHistorial() {
  fs.writeFileSync(HISTORIAL_FILE, JSON.stringify(historialData, null, 2));
}

export function getHistorial(id) {
  if (!historialData[id]) historialData[id] = [];
  return historialData[id];
}

async function compactarHistorial(id, historial) {
  // 1. Flush silencioso — migrar hechos durables a MEMORY.md y diario
  flushContextoAntesDePoda(id, historial).catch(() => {});
  // 2. Generar resumen compacto para contexto inmediato
  const resumen = await generarResumenCompacto(id, historial);
  return resumen || historial.slice(-2).map(e => e.content).join(' | ').slice(0, 200);
}

export function agregarAlHistorial(id, role, content) {
  const h = getHistorial(id);
  h.push({ role, content });
  if (h.length > MAX_HISTORIAL) {
    const aResumir = h.splice(0, MAX_HISTORIAL);
    compactarHistorial(id, aResumir).then(resumen => {
      resumenes[id] = resumen;
      console.log('[COMPACTION] Historial compactado para ' + id + ': ' + resumen.slice(0, 80));
    }).catch(() => {});
  }
  guardarHistorial();
}

export function getHistorialGemini(id) {
  const historial = getHistorial(id).map(e => ({
    role: e.role === "user" ? "user" : "model",
    parts: [{ text: e.content }]
  }));
  if (resumenes[id]) {
    return [
      { role: "user", parts: [{ text: "[RESUMEN DE CONVERSACIÓN ANTERIOR]: " + resumenes[id] }] },
      { role: "model", parts: [{ text: "Entendido, recuerdo el contexto previo." }] },
      ...historial
    ];
  }
  return historial;
}

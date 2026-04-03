import fs from 'fs';
import { ROOT_DIR } from '../config/bmo.config.js';

const CONTEXTO_FILE = `${ROOT_DIR}/contexto_sesion.json`

function cargar() {
  if (!fs.existsSync(CONTEXTO_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONTEXTO_FILE, 'utf8')); }
  catch(e) { return {}; }
}

function guardar(data) {
  fs.writeFileSync(CONTEXTO_FILE, JSON.stringify(data, null, 2));
}

// Guardar contexto tras cada acción importante
export function guardarContexto(id, tipo, datos) {
  const ctx = cargar();
  if (!ctx[id]) ctx[id] = {};
  ctx[id][tipo] = { datos, timestamp: Date.now() };
  ctx[id].ultimaAccion = tipo;
  guardar(ctx);
}

// Obtener contexto de sesión por usuario
export function obtenerContexto(id) {
  const ctx = cargar();
  return ctx[id] || {};
}

// Detectar si el mensaje es ambiguo y necesita resolución
function esAmbiguo(mensaje) {
  return /^(qu[íi]talo|elim[íi]nalo|b[oó]rralo|c[áa]ncelalo|s[íi]|no|ese|esa|el primero|el [úu]ltimo|todos|ninguno|hazlo|ejecutalo|aplica|confirma|el \d+|número \d+|el que dije)[\s!?.]*$/i.test(mensaje.trim());
}

// Resolver referencia anafórica
export function resolverReferencia(id, mensaje) {
  if (!esAmbiguo(mensaje)) return null;

  const ctx = obtenerContexto(id);
  const ultima = ctx.ultimaAccion;

  // Si el último listado fue recordatorios
  if (ultima === 'lista_recordatorios' && ctx.lista_recordatorios) {
    const recordatorios = ctx.lista_recordatorios.datos;
    if (!recordatorios || recordatorios.length === 0) return null;

    if (/qu[íi]talo|elim[íi]nalo|b[oó]rralo|c[áa]ncelalo/i.test(mensaje)) {
      if (recordatorios.length === 1) {
        return `eliminar recordatorio con ID ${recordatorios[0].recordId}`;
      }
      return `eliminar recordatorio`; // ambiguo, hay varios
    }
  }

  // Si el último listado fue archivos
  if (ultima === 'lista_archivos' && ctx.lista_archivos) {
    const archivos = ctx.lista_archivos.datos;
    if (!archivos || archivos.length === 0) return null;

    const numMatch = mensaje.match(/el (\d+)|número (\d+)/i);
    if (numMatch) {
      const idx = parseInt(numMatch[1] || numMatch[2]) - 1;
      if (archivos[idx]) return `abrir archivo ${archivos[idx]}`;
    }
    if (/b[oó]rralo|elim[íi]nalo/i.test(mensaje) && archivos.length === 1) {
      return `eliminar archivo ${archivos[0]}`;
    }
  }

  // Si el último contexto fue un comando ejecutado
  if (ultima === 'comando_ejecutado' && ctx.comando_ejecutado) {
    if (/hazlo|ejecutalo|aplica|confirma|s[íi]/i.test(mensaje)) {
      return `ejecutar de nuevo: ${ctx.comando_ejecutado.datos}`;
    }
  }

  // Si el último contexto fue módulos listados
  if (ultima === 'lista_modulos' && ctx.lista_modulos) {
    const modulos = ctx.lista_modulos.datos;
    const numMatch = mensaje.match(/el (\d+)|número (\d+)/i);
    if (numMatch && modulos) {
      const idx = parseInt(numMatch[1] || numMatch[2]) - 1;
      if (modulos[idx]) return `ejecutar módulo ${modulos[idx]}`;
    }
  }

  return null;
}

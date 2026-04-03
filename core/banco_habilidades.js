import fs from "fs";
import path from "path";
import { ROOT_DIR } from '../config/bmo.config.js';
const BASE_DIR = `${ROOT_DIR}`;
const BANCO_FILE = path.join(BASE_DIR, "banco_habilidades.json");
const RETOS_FILE = path.join(BASE_DIR, "retos_diarios.json");

function cargarBanco() {
  try { if (fs.existsSync(BANCO_FILE)) return JSON.parse(fs.readFileSync(BANCO_FILE, "utf8")); } catch(e) {}
  return { lecciones: [], habilidades: [] };
}
function guardarBanco(b) { try { fs.writeFileSync(BANCO_FILE, JSON.stringify(b, null, 2)); } catch(e) {} }

export function registrarLeccion(modulo, errorMsg, codigoRoto) {
  const banco = cargarBanco();
  let tipo = "desconocido";
  if (/already been declared/i.test(errorMsg)) tipo = "declaracion_duplicada";
  else if (codigoRoto && codigoRoto.includes("require(")) tipo = "commonjs_en_esm";
  else if (codigoRoto && codigoRoto.includes("throw new Error")) tipo = "throw_no_permitido";
  else if (/Invalid or unexpected token/i.test(errorMsg)) tipo = "codigo_truncado";
  else if (/Illegal return/i.test(errorMsg)) tipo = "return_fuera_de_funcion";
  const textos = {
    declaracion_duplicada: "NUNCA redeclares variables que ya existen en el scope.",
    commonjs_en_esm: "NUNCA uses require(). Usa import/export (ESM).",
    throw_no_permitido: "NUNCA uses throw new Error(). Usa try/catch silencioso.",
    codigo_truncado: "No dejes codigo truncado. Cierra todos los strings y objetos.",
    return_fuera_de_funcion: "NUNCA uses return fuera de una funcion."
  };
  const ex = banco.lecciones.find(l => l.tipoError === tipo);
  if (ex) { ex.veces++; } else banco.lecciones.push({ id: Date.now(), modulo, tipoError: tipo, leccion: textos[tipo] || "Verifica sintaxis.", veces: 1 });
  guardarBanco(banco);
  console.log("[BANCO] Leccion: " + tipo);
}

export function obtenerContextoBanco() {
  const banco = cargarBanco();
  if (!banco.lecciones.length) return "";
  return "\nERRORES A EVITAR:\n" + banco.lecciones.sort((a,b)=>b.veces-a.veces).slice(0,5).map(l=>"- "+l.leccion).join("\n") + "\n";
}

export function registrarHabilidad(modulo, desc) {
  const banco = cargarBanco();
  if (!banco.habilidades.find(h=>h.modulo===modulo)) {
    banco.habilidades.push({ modulo, descripcion: desc||modulo, fecha: new Date().toISOString(), usos: 0 });
    guardarBanco(banco);
  }
}

export function incrementarUsoHabilidad(modulo) {
  const banco = cargarBanco();
  const h = banco.habilidades.find(h=>h.modulo===modulo);
  if (h) { h.usos++; guardarBanco(banco); }
}

function cargarRetos() {
  try { if (fs.existsSync(RETOS_FILE)) return JSON.parse(fs.readFileSync(RETOS_FILE, "utf8")); } catch(e) {}
  return { completados: [], pendiente: null, ultimoReto: null };
}
function guardarRetos(r) { try { fs.writeFileSync(RETOS_FILE, JSON.stringify(r, null, 2)); } catch(e) {} }

const RETOS = [
  "aprende a mostrar el espacio en disco de forma visual",
  "aprende a listar los procesos que mas CPU usan",
  "aprende a verificar si hay actualizaciones del sistema",
  "aprende a mostrar las conexiones de red activas",
  "aprende a mostrar los logs de errores de hoy",
  "aprende a listar los servicios activos del sistema",
  "aprende a mostrar informacion del hardware de la Raspberry Pi",
  "aprende a hacer ping a un host y mostrar latencia",
  "aprende a listar los puertos abiertos en el sistema",
  "aprende a mostrar el historial de reinicios del sistema"
];

export async function generarRetoDelDia(clientGlobal, adminId) {
  const retos = cargarRetos();
  const banco = cargarBanco();
  const hoy = new Date().toDateString();
  if (retos.ultimoReto === hoy) return null;
  const habs = banco.habilidades.map(h=>h.modulo.toLowerCase());
  const disp = RETOS.filter(r => !habs.some(h=>h.includes(r.split(" ").slice(3,5).join("_").toLowerCase())));
  const lista = disp.length > 0 ? disp : RETOS;
  const reto = lista[Math.floor(Math.random() * lista.length)];
  retos.pendiente = reto;
  retos.ultimoReto = hoy;
  guardarRetos(retos);
  console.log("[RETO] Reto del dia: " + reto);
  if (clientGlobal && adminId) {
    try {
        await clientGlobal.sendMessage(adminId, "*Reto del dia para BMO:*\n\n" + reto + "\n\nResponde *ejecutar reto* para que BMO lo aprenda ahora.");
    } catch(e) { console.log('[RETO] Error enviando reto:', e.message.slice(0,60)); }
  }
  return reto;
}

export async function ejecutarRetoPendiente(clientGlobal, adminId) {
  const retos = cargarRetos();
  if (!retos.pendiente) {
    if (clientGlobal && adminId) await clientGlobal.sendMessage(adminId, "No hay reto pendiente.");
    return null;
  }
  const reto = retos.pendiente;
  retos.completados.push({ reto, fecha: new Date().toISOString() });
  retos.pendiente = null;
  guardarRetos(retos);
  if (clientGlobal && adminId) await clientGlobal.sendMessage(adminId, "BMO esta aprendiendo: " + reto + "...");
  return reto;
}

export function obtenerEstadoBanco() {
  const banco = cargarBanco();
  const retos = cargarRetos();
  return { habilidades: banco.habilidades.length, lecciones: banco.lecciones.length, retosCompletados: retos.completados.length, retoPendiente: retos.pendiente };
}

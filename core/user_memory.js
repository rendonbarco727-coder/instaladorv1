import fs from 'fs';
import { ROOT_DIR } from '../config/bmo.config.js';

const MEMORIA_FILE = `${ROOT_DIR}/memoria_usuarios.json`

function cargar() {
  if (!fs.existsSync(MEMORIA_FILE)) fs.writeFileSync(MEMORIA_FILE, '{}');
  try { return JSON.parse(fs.readFileSync(MEMORIA_FILE, 'utf8')); } 
  catch(e) { return {}; }
}

function guardar(data) {
  fs.writeFileSync(MEMORIA_FILE, JSON.stringify(data, null, 2));
}

export function obtenerMemoria(id) {
  return cargar()[id] || {
    temas: [],
    sentimiento: 'neutro',
    nombre: null,
    preferencias: {},
    ultimaInteraccion: null,
    resumenConversacion: ''
  };
}

export function actualizarMemoria(id, datos) {
  const memoria = cargar();
  memoria[id] = { ...obtenerMemoria(id), ...datos, ultimaInteraccion: new Date().toISOString() };
  guardar(memoria);
}

export function agregarTema(id, tema) {
  const mem = obtenerMemoria(id);
  if (!mem.temas.includes(tema)) {
    mem.temas = [tema, ...mem.temas].slice(0, 10); // max 10 temas
    actualizarMemoria(id, { temas: mem.temas });
  }
}

export function actualizarNarrativa(id, nuevoEvento) {
  const mem = obtenerMemoria(id);
  const historia = mem.historia || [];
  historia.push({
    fecha: new Date().toISOString(),
    evento: nuevoEvento
  });
  // Mantener solo los últimos 20 eventos
  actualizarMemoria(id, { historia: historia.slice(-20) });
}

export function generarNarrativa(id) {
  const mem = obtenerMemoria(id);
  if (!mem.historia || mem.historia.length === 0) return '';
  const eventos = mem.historia.slice(-5).map(e => e.evento).join('. ');
  return '\n[HISTORIA]: ' + eventos;
}

export function generarContextoMemoria(id) {
  const mem = obtenerMemoria(id);
  if (!mem.ultimaInteraccion) return '';
  
  const partes = [];
  if (mem.nombre) partes.push("El usuario se llama " + mem.nombre);
  if (mem.temas.length > 0) partes.push("Temas recientes: " + mem.temas.slice(0, 5).join(', '));
  if (mem.sentimiento !== 'neutro') partes.push("Estado actual: " + mem.sentimiento);
  if (mem.resumenConversacion) partes.push("Contexto previo: " + mem.resumenConversacion);
  
  const narrativa = generarNarrativa(id);
  return (partes.length > 0 ? '\n[MEMORIA]: ' + partes.join('. ') + '.' : '') + narrativa;
}

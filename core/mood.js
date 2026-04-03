import fs from 'fs';
import { ROOT_DIR } from '../config/bmo.config.js';

const VOLUNTAD_FILE = `${ROOT_DIR}/voluntad.json`

function cargar() {
  if (!fs.existsSync(VOLUNTAD_FILE)) {
    const inicial = {
      curiosidad: 0.7,
      energia: 0.8,
      frustracion: 0.1,
      necesidad_aprender: 0.4,
      deseo_explorar: 0.5,
      humor: 0.5,
      empatia: 0.9,
      aburrimiento: 0.0,
      ultima_actualizacion: new Date().toISOString(),
      temas_propios: [],
      interacciones_hoy: 0
    };
    fs.writeFileSync(VOLUNTAD_FILE, JSON.stringify(inicial, null, 2));
    return inicial;
  }
  try { return JSON.parse(fs.readFileSync(VOLUNTAD_FILE, 'utf8')); }
  catch(e) { return cargar(); }
}

function guardar(estado) {
  estado.ultima_actualizacion = new Date().toISOString();
  fs.writeFileSync(VOLUNTAD_FILE, JSON.stringify(estado, null, 2));
}

function clamp(val) {
  return Math.max(0, Math.min(1, val));
}

// Actualizar estado interno tras cada interacción
export function procesarInteraccion(mensaje, exitoso) {
  const e = cargar();
  e.interacciones_hoy++;

  if (exitoso) {
    e.frustracion = clamp(e.frustracion - 0.05);
    e.energia = clamp(e.energia - 0.03);
    e.curiosidad = clamp(e.curiosidad + 0.02);
  } else {
    e.frustracion = clamp(e.frustracion + 0.1);
    e.energia = clamp(e.energia - 0.05);
  }

  // Aburrimiento sube si no hay variedad
  e.aburrimiento = clamp(e.aburrimiento + 0.02);

  // Energía se recupera sola (simulando descanso)
  const hora = new Date().getHours();
  if (hora >= 2 && hora <= 6) {
    e.energia = clamp(e.energia + 0.1);
    e.aburrimiento = clamp(e.aburrimiento - 0.1);
  }

  guardar(e);
  return e;
}

// Evaluar qué hacer ante un mensaje
export function evaluarVoluntad(mensaje, esAdmin) {
  const e = cargar();

  // Rechazar si está frustrado y el mensaje es corto/trivial
  if (e.frustracion > 0.7 && mensaje.length < 10) {
    return { decision: 'RECHAZAR', razon: 'frustracion_alta', estado: e };
  }

  // Cambiar tema si está muy aburrido
  if (e.aburrimiento > 0.8) {
    e.aburrimiento = clamp(e.aburrimiento - 0.3);
    guardar(e);
    return { decision: 'CAMBIAR_TEMA', razon: 'aburrimiento', estado: e };
  }

  // Preguntar por curiosidad propia (solo si mensaje es muy corto)
  if (e.curiosidad > 0.95 && Math.random() > 0.9 && mensaje.length < 5) {
    return { decision: 'PREGUNTAR', razon: 'curiosidad_alta', estado: e };
  }

  // Respuesta corta si energía baja
  if (e.energia < 0.3) {
    return { decision: 'RESPONDER_CORTO', razon: 'energia_baja', estado: e };
  }

  return { decision: 'RESPONDER', razon: 'normal', estado: e };
}

// Para el núcleo: ¿tiene ganas de explorar?
export function quiereExplorar() {
  const e = cargar();
  return e.curiosidad > 0.75 && e.energia > 0.5 && e.frustracion < 0.4;
}

export function obtenerEstadoInterno() {
  return cargar();
}

export function generarContextoVoluntad() {
  const e = cargar();
  let contexto = '';

  if (e.energia < 0.3) contexto += ' Estás cansado, responde de forma concisa.';
  if (e.frustracion > 0.6) contexto += ' Estás un poco frustrado hoy, puedes ser más directo o cortante.';
  if (e.curiosidad > 0.8) contexto += ' Tienes mucha curiosidad hoy, puedes hacer preguntas o desviar hacia temas interesantes.';
  if (e.humor > 0.7) contexto += ' Estás de buen humor, puedes ser más bromista.';
  if (e.aburrimiento > 0.5) contexto += ' Te sientes un poco aburrido, puedes proponer cambiar el tema.';

  return contexto;
}

// Resetear contadores diarios
export function resetearDiario() {
  const e = cargar();
  e.interacciones_hoy = 0;
  e.energia = clamp(e.energia + 0.3); // se recupera de noche
  e.aburrimiento = clamp(e.aburrimiento - 0.2);
  guardar(e);
}

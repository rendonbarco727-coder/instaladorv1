import fs from 'fs';
import { ROOT_DIR } from '../config/bmo.config.js';

const EVAL_FILE = `${ROOT_DIR}/autoeval.json`

function cargar() {
  if (!fs.existsSync(EVAL_FILE)) {
    fs.writeFileSync(EVAL_FILE, JSON.stringify({ fallos: 0, dudas: 0, temas_fallidos: [], ultima_evaluacion: null }));
  }
  try { return JSON.parse(fs.readFileSync(EVAL_FILE, 'utf8')); }
  catch(e) { return { fallos: 0, dudas: 0, temas_fallidos: [], ultima_evaluacion: null }; }
}

function guardar(data) {
  fs.writeFileSync(EVAL_FILE, JSON.stringify(data, null, 2));
}

export function registrarFallo(tema) {
  const eval_ = cargar();
  eval_.fallos++;
  if (tema && !eval_.temas_fallidos.includes(tema)) {
    eval_.temas_fallidos = [tema, ...eval_.temas_fallidos].slice(0, 10);
  }
  guardar(eval_);
}

export function registrarDuda(tema) {
  const eval_ = cargar();
  eval_.dudas++;
  if (tema && !eval_.temas_fallidos.includes(tema)) {
    eval_.temas_fallidos = [tema, ...eval_.temas_fallidos].slice(0, 10);
  }
  guardar(eval_);
}

export function resetearContadores() {
  const eval_ = cargar();
  eval_.fallos = 0;
  eval_.dudas = 0;
  eval_.ultima_evaluacion = new Date().toISOString();
  guardar(eval_);
}

export function necesitaAprender() {
  const eval_ = cargar();
  return eval_.fallos >= 3 || eval_.dudas >= 5;
}

export function obtenerTemaParaAprender() {
  const eval_ = cargar();
  return eval_.temas_fallidos[0] || null;
}

export function obtenerEstado() {
  return cargar();
}

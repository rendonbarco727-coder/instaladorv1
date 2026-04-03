// core/features/memoria_comandos.js
import fs from 'fs';
import { CONFIG } from '../../config/bmo.config.js';
const MEMORIA_CMDS_FILE = CONFIG.files.memoria_cmds;
const ERRORES_FILE = CONFIG.files.errores;

export function cargarMemoriaComandos() {
  if (!fs.existsSync(MEMORIA_CMDS_FILE)) {
    fs.writeFileSync(MEMORIA_CMDS_FILE, JSON.stringify({}));
  }
  return JSON.parse(fs.readFileSync(MEMORIA_CMDS_FILE, "utf8"));
}

export function guardarComandoExitoso(tarea, comando) {
  const mem = cargarMemoriaComandos();
  mem[tarea.toLowerCase().trim()] = { comando, fecha: new Date().toISOString(), usos: (mem[tarea]?.usos || 0) + 1 };
  fs.writeFileSync(MEMORIA_CMDS_FILE, JSON.stringify(mem, null, 2));
  console.log("Comando guardado en memoria: " + tarea);
}

export function buscarComandoSimilar(tarea) {
  const mem = cargarMemoriaComandos();
  const tareaLower = tarea.toLowerCase();
  for (const [key, val] of Object.entries(mem)) {
    if (tareaLower.includes(key) || key.includes(tareaLower) ||
        tareaLower.split(" ").some(w => w.length > 4 && key.includes(w))) {
      return val.comando;
    }
  }
  return null;
}

export function cargarErrores() {
  if (!fs.existsSync(ERRORES_FILE)) {
    fs.writeFileSync(ERRORES_FILE, JSON.stringify([]));
  }
  return JSON.parse(fs.readFileSync(ERRORES_FILE, "utf8"));
}

export function guardarError(tarea, error, codigoIntentado) {
  const errores = cargarErrores();
  errores.push({
    fecha: new Date().toISOString(),
    tarea,
    error: error.slice(0, 200),
    codigoIntentado: codigoIntentado?.slice(0, 300)
  });
  if (errores.length > 50) errores.shift();
  fs.writeFileSync(ERRORES_FILE, JSON.stringify(errores, null, 2));
  console.log("Error guardado en historial: " + error.slice(0, 80));
}

export function obtenerContextoErrores(tarea) {
  const errores = cargarErrores();
  const relacionados = errores.filter(e =>
    e.tarea.toLowerCase().includes(tarea.toLowerCase().slice(0, 20)) ||
    tarea.toLowerCase().includes(e.tarea.toLowerCase().slice(0, 20))
  ).slice(-3);
  if (relacionados.length === 0) return "";
  return "\nErrores previos en tareas similares (NO repetir):\n" +
    relacionados.map(e => `- ${e.error}`).join("\n");
}

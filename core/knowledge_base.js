import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config/bmo.config.js';
import Database from 'better-sqlite3';

const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`;

// Fire-and-forget: inserta en knowledge + genera embedding en background
function persistirKnowledge(tipo, texto) {
    try {
        const db = new Database(DB_PATH);
        const r = db.prepare(
            'INSERT INTO knowledge (tipo, texto, metadata, userId, importancia, timestamp) VALUES (?,?,?,?,?,?)'
        ).run(tipo, texto, '{}', 'system', 1, Date.now());
        db.close();
        // Embedding en background — no bloquea
        import('./embeddings.js').then(({ getEmbedding }) => {
            getEmbedding(texto).then(vec => {
                try {
                    const db2 = new Database(DB_PATH);
                    db2.prepare('UPDATE knowledge SET embedding=? WHERE id=?').run(JSON.stringify(vec), r.lastInsertRowid);
                    db2.close();
                } catch(_) {}
            }).catch(() => {});
        }).catch(() => {});
    } catch(_) {}
}

const BASE = ROOT_DIR;
const CONOCIMIENTO_FILE = BASE + '/conocimiento_bmo.json';

// Cargar conocimiento acumulado
function cargarConocimiento() {
  if (!fs.existsSync(CONOCIMIENTO_FILE)) {
    fs.writeFileSync(CONOCIMIENTO_FILE, JSON.stringify({
      comandos_exitosos: {},   // { tarea: [cmd1, cmd2] }
      comandos_fallidos: {},   // { tarea: [cmd1, cmd2] }
      archivos: {},            // { archivo: descripcion }
      errores_frecuentes: [],  // [{error, solucion}]
      ultima_actualizacion: null
    }, null, 2));
  }
  try { return JSON.parse(fs.readFileSync(CONOCIMIENTO_FILE, 'utf8')); }
  catch(e) { return { comandos_exitosos: {}, comandos_fallidos: {}, archivos: {}, errores_frecuentes: [] }; }
}

function guardarConocimiento(data) {
  data.ultima_actualizacion = new Date().toISOString();
  fs.writeFileSync(CONOCIMIENTO_FILE, JSON.stringify(data, null, 2));
}

// Registrar comando que funcionó
export function registrarExito(tarea, comando) {
  const c = cargarConocimiento();
  if (!c.comandos_exitosos[tarea]) c.comandos_exitosos[tarea] = [];
  if (!c.comandos_exitosos[tarea].includes(comando)) {
    c.comandos_exitosos[tarea].push(comando);
    c.comandos_exitosos[tarea] = c.comandos_exitosos[tarea].slice(-5); // max 5
    persistirKnowledge('exito', `${tarea}: ${comando}`);
  }
  guardarConocimiento(c);
}

// Registrar comando que falló
export function registrarFalloComando(tarea, comando, error) {
  const c = cargarConocimiento();
  if (!c.comandos_fallidos[tarea]) c.comandos_fallidos[tarea] = [];
  const entrada = comando + ' → ' + error.slice(0, 80);
  if (!c.comandos_fallidos[tarea].includes(entrada)) {
    c.comandos_fallidos[tarea].push(entrada);
    c.comandos_fallidos[tarea] = c.comandos_fallidos[tarea].slice(-5);
    persistirKnowledge('fallo', `${tarea}: ${entrada}`);
  }
  guardarConocimiento(c);
}

// Registrar nuevo archivo creado
export function registrarArchivo(nombre, descripcion) {
  const c = cargarConocimiento();
  c.archivos[nombre] = descripcion;
  guardarConocimiento(c);
}

// Generar contexto completo para Ollama
export function generarContextoCompleto(tarea) {
  const c = cargarConocimiento();

  // Leer módulos existentes
  let modulosInfo = '';
  const evolDir = BASE + '/evoluciones';
  if (fs.existsSync(evolDir)) {
    const modulos = fs.readdirSync(evolDir).filter(f => f.endsWith('.js'));
    modulosInfo = modulos.map(m => {
      try {
        const contenido = fs.readFileSync(path.join(evolDir, m), 'utf8');
        const primeraLinea = contenido.split('\n').find(l => l.startsWith('// Modulo')) || m;
        return '- ' + m + ': ' + primeraLinea.replace('//', '').trim();
      } catch(e) { return '- ' + m; }
    }).join('\n');
  }

  // Leer errores recientes de autocódigo
  let erroresRecientes = '';
  const errFile = BASE + '/errores_autocodigo.json';
  if (fs.existsSync(errFile)) {
    try {
      const errs = JSON.parse(fs.readFileSync(errFile, 'utf8'));
      const recientes = (errs.errores || []).slice(-3);
      erroresRecientes = recientes.map(e => '- ' + e.modulo + ': ' + e.error).join('\n');
    } catch(e) {}
  }

  // Comandos exitosos para esta tarea
  const exitosos = (c.comandos_exitosos[tarea] || []).join('\n- ');
  const fallidos = (c.comandos_fallidos[tarea] || []).join('\n- ');

  // Archivos conocidos
  const archivosConocidos = Object.entries(c.archivos)
    .map(([k,v]) => '- ' + k + ': ' + v).join('\n');

  return `SISTEMA BMO - CONOCIMIENTO ACUMULADO:

ARQUITECTURA:
- Bot WhatsApp (whatsapp-web.js) en Raspberry Pi 4 ARM64 Debian
- Node.js 22 ES modules, Gemini API para decisiones, Ollama local para código
- Archivos principales: index.js (bot), motor_evoluciones.js (módulos), nucleo_ejecutivo.js (autónomo)
- Módulos aprendidos en: /home/ruben/wa-ollama/evoluciones/
- Cada módulo exporta: export async function ejecutar({ client, id, execAsync, esAdmin }) {}
- execAsync(cmd, {timeout}) ejecuta comandos bash y devuelve {stdout, stderr}
- esAdmin es true si el usuario es administrador
- Para sesiones conversacionales también: export async function manejarRespuesta({ client, id, mensaje, sesion, sesionesActivas }) {}

MÓDULOS YA EXISTENTES (NO recrear):
${modulosInfo || 'ninguno aun'}

ARCHIVOS DEL SISTEMA:
${archivosConocidos || `ver ${ROOT_DIR}/`}

COMANDOS QUE FUNCIONARON PARA TAREAS SIMILARES:
${exitosos ? '- ' + exitosos : 'ninguno registrado aun'}

COMANDOS QUE FALLARON (EVITAR):
${fallidos ? '- ' + fallidos : 'ninguno registrado'}

ERRORES RECIENTES DE AUTOCÓDIGO:
${erroresRecientes || 'ninguno'}

APIS DISPONIBLES (ya configuradas en process.env):
- TOMTOM_API_KEY: para tráfico en tiempo real, geocodificación y rutas
  Endpoint rutas: https://api.tomtom.com/routing/1/calculateRoute/{origen}:{destino}/json?key=KEY&traffic=true
  Endpoint geocodificación: https://api.tomtom.com/search/2/geocode/{query}.json?key=KEY
- GROQ_API_KEY: para consultas a Groq LLM
- MISTRAL_API_KEY: para consultas a Mistral LLM
- GEMINI_API_KEY: ya disponible globalmente en el bot

REGLAS CRÍTICAS:
- NUNCA crees un nuevo cliente WhatsApp, usa el "client" que se pasa como parámetro
- NUNCA uses: apt, pip, npm install, while true, shutdown, halt, poweroff
- USA comandos Linux nativos: ip, iwconfig, nmcli, free, df, vcgencmd, journalctl
- Para HTTP usa axios (ya disponible globalmente)
- Para archivos usa fs (importar desde 'fs')
- Para comandos: import { execSync } from 'child_process' o usar execAsync
- Raspberry Pi NO tiene: ipconfig, ifconfig moderno — usa "ip addr" o "nmcli"
- speedtest-cli YA está instalado
- El admin ID es "100365164921028@lid"

TAREA A IMPLEMENTAR: ${tarea}`;
}

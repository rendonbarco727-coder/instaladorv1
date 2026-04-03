// core/features/evoluciones_manager.js
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { preguntarGemini } from '../llm_gemini.js';
import { ROOT_DIR, CONFIG } from '../../config/bmo.config.js';

const execAsync = promisify(exec);
const EVOLUCIONES_FILE = CONFIG.files.evoluciones;
const EXPERIMENTOS_FILE = CONFIG.files.experimentos;
const AUTONOMIA_FILE = CONFIG.files.autonomia;

export function cargarEvoluciones() {
  if (!fs.existsSync(EVOLUCIONES_FILE)) {
    fs.writeFileSync(EVOLUCIONES_FILE, JSON.stringify({
      historial: [],
      limites: {
        estructurales_semana: 0,
        tecnicos_hoy: 0,
        ultima_semana: new Date().toISOString(),
        ultimo_dia: new Date().toDateString()
      }
    }, null, 2));
  }
  return JSON.parse(fs.readFileSync(EVOLUCIONES_FILE, "utf8"));
}

export function guardarEvoluciones(data) {
  fs.writeFileSync(EVOLUCIONES_FILE, JSON.stringify(data, null, 2));
}

export function cargarExperimentos() {
  if (!fs.existsSync(EXPERIMENTOS_FILE)) {
    fs.writeFileSync(EXPERIMENTOS_FILE, JSON.stringify({ activo: null, historial: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(EXPERIMENTOS_FILE, "utf8"));
}

export function guardarExperimentos(data) {
  fs.writeFileSync(EXPERIMENTOS_FILE, JSON.stringify(data, null, 2));
}

export function verificarLimites(tipo) {
  const ev = cargarEvoluciones();
  const hoy = new Date().toDateString();
  if (ev.limites.ultimo_dia !== hoy) {
    ev.limites.tecnicos_hoy = 0;
    ev.limites.ultimo_dia = hoy;
  }
  if (new Date() - new Date(ev.limites.ultima_semana) > 7 * 24 * 60 * 60 * 1000) {
    ev.limites.estructurales_semana = 0;
    ev.limites.ultima_semana = new Date().toISOString();
  }
  if (tipo === "estructural" && ev.limites.estructurales_semana >= 1) return false;
  if (tipo === "tecnico" && ev.limites.tecnicos_hoy >= 2) return false;
  guardarEvoluciones(ev);
  return true;
}

export function registrarEvolucion(tipo, descripcion, resultado) {
  const ev = cargarEvoluciones();
  const hoy = new Date().toDateString();
  if (ev.limites.ultimo_dia !== hoy) ev.limites.tecnicos_hoy = 0;
  if (tipo === "estructural") ev.limites.estructurales_semana++;
  if (tipo === "tecnico") ev.limites.tecnicos_hoy++;
  ev.historial.push({ fecha: new Date().toISOString(), tipo, descripcion, resultado });
  ev.limites.ultimo_dia = hoy;
  guardarEvoluciones(ev);
}

export async function evaluacionEvolutiva(client) {
  const id = CONFIG.admin_wa;
  console.log("Iniciando evaluacion evolutiva...");
  try {
    const { stdout: ram } = await execAsync("free -m | awk 'NR==2{print $3*100/$2}'");
    const { stdout: cpu } = await execAsync("top -bn1 | grep Cpu | awk '{print $2}'");
    const { stdout: disco } = await execAsync("df -h /home/ruben/wa-ollama | awk 'NR==2{print $5}'");
    const { stdout: logs } = await execAsync("pm2 logs bmo --lines 500 --nostream 2>/dev/null | grep -c Error || echo 0");
    const errores = parseInt(logs.trim()) || 0;
    const analisis = await preguntarGemini(
      id,
      `Analiza el estado del sistema BMO y propone UNA mejora concreta:\nRAM: ${ram.trim()}\nCPU: ${cpu.trim()}%\nDisco: ${disco.trim()}\nErrores ultimas 24h: ${errores}\n\nResponde EXACTAMENTE en este JSON:\n{"tipo": "verde|amarillo|azul|rojo", "titulo": "titulo corto", "descripcion": "que problema detectaste", "solucion": "como solucionarlo", "costo": "GRATIS o precio", "riesgo": 1-10, "comando": "comando bash opcional o null"}`,
      "Responde SOLO con el JSON, sin texto adicional."
    );
    let propuesta;
    try {
      propuesta = JSON.parse(analisis.replace(/```json|```/g, "").trim());
    } catch(e) {
      console.log("No se pudo parsear propuesta evolutiva");
      return;
    }
    const emojis = { verde: "🟢", amarillo: "🟡", azul: "🔵", rojo: "🔴" };
    const emoji = emojis[propuesta.tipo] || "🟢";
    const tipoTexto = { verde: "Nueva función gratis", amarillo: "Mejora técnica", azul: "Nueva capacidad IA", rojo: "Cambio estructural" };
    const mensaje = `🧠 *Evaluación Evolutiva BMO*\n\n${emoji} ${tipoTexto[propuesta.tipo] || propuesta.tipo}\n\n📊 *Detecté:* ${propuesta.descripcion}\n💡 *Solución:* ${propuesta.solucion}\n💰 *Costo:* ${propuesta.costo}\n⚠️ *Riesgo:* ${propuesta.riesgo}/10\n\n¿Deseas que lo implemente? Responde *sí* o *no*`;
    fs.writeFileSync(`${ROOT_DIR}/propuesta_pendiente.json`, JSON.stringify(propuesta));
    await client.sendMessage(id, mensaje);
    console.log("Propuesta evolutiva enviada");
  } catch(err) {
    console.error("Error evaluacion evolutiva:", err.message);
  }
}

export async function manejarRespuestaPropuesta(client, id, respuesta, { agenteSelfCode, crearRespaldo } = {}) {
  const propuestaFile = `${ROOT_DIR}/propuesta_pendiente.json`
  if (!fs.existsSync(propuestaFile)) return false;
  const propuesta = JSON.parse(fs.readFileSync(propuestaFile, "utf8"));
  const acepto = /^(si|sí|yes|ok|dale|adelante|hazlo)/i.test(respuesta.trim());
  if (!acepto) {
    fs.unlinkSync(propuestaFile);
    registrarAccion("rechazada");
    await client.sendMessage(id, "Entendido, descarte la propuesta. Seguire monitoreando.");
    return true;
  }
  const tipoLimite = propuesta.tipo === "rojo" ? "estructural" : "tecnico";
  if (!verificarLimites(tipoLimite)) {
    fs.unlinkSync(propuestaFile);
    await client.sendMessage(id, "No puedo aplicar este cambio ahora, llegue al limite diario/semanal de modificaciones. Lo intentare manana.");
    return true;
  }
  fs.unlinkSync(propuestaFile);
  await client.sendMessage(id, "Aplicando mejora...");
  try {
    if (crearRespaldo) await crearRespaldo();
    if (propuesta.comando) {
        if (/rm\s+-rf|mkfs|dd\s+if|shutdown|reboot|format/i.test(propuesta.comando)) {
            await client.sendMessage(id, "❌ Comando rechazado por seguridad.");
            return true;
        }
      const { stdout } = await execAsync(propuesta.comando, { timeout: 60000 });
      await client.sendMessage(id, "✅ Mejora aplicada: " + propuesta.titulo + "\n\nResultado: " + (stdout.trim().slice(0, 200) || "completado"));
    } else if (agenteSelfCode) {
      await agenteSelfCode(client, id, propuesta.solucion);
      return true;
    }
    registrarEvolucion(tipoLimite, propuesta.titulo, "exitoso");
    registrarAccion("mejora_efectiva");
  } catch(err) {
    await client.sendMessage(id, "❌ Error aplicando mejora: " + err.message.slice(0, 200));
    registrarEvolucion(tipoLimite, propuesta.titulo, "fallido: " + err.message.slice(0, 100));
  }
  return true;
}

export function cargarAutonomia() {
  if (!fs.existsSync(AUTONOMIA_FILE)) {
    fs.writeFileSync(AUTONOMIA_FILE, JSON.stringify({
      acciones_autonomas_exitosas: 0,
      acciones_rechazadas: 0,
      mejoras_efectivas: 0,
      errores_post_cambio: 0,
      nivel_autonomia: 5.0,
      semanas_sin_fallos: 0,
      umbral_autonomia: 7,
      historial_semanal: [],
      uso_funciones: {}
    }, null, 2));
  }
  const a = JSON.parse(fs.readFileSync(AUTONOMIA_FILE, "utf8"));
  a.historial_semanal = a.historial_semanal || [];
  a.semanas_sin_fallos = a.semanas_sin_fallos ?? 0;
  a.umbral_autonomia = a.umbral_autonomia ?? 7;
  a.errores_post_cambio = a.errores_post_cambio ?? 0;
  a.uso_funciones = a.uso_funciones || {};
  return a;
}

export function guardarAutonomia(data) {
  fs.writeFileSync(AUTONOMIA_FILE, JSON.stringify(data, null, 2));
}

export function registrarAccion(tipo) {
  const a = cargarAutonomia();
  if (tipo === "exitosa") a.acciones_autonomas_exitosas++;
  if (tipo === "rechazada") a.acciones_rechazadas++;
  if (tipo === "mejora_efectiva") a.mejoras_efectivas++;
  if (tipo === "error_post_cambio") a.errores_post_cambio++;
  const total = a.acciones_autonomas_exitosas + a.acciones_rechazadas + 1;
  const tasa_exito = a.acciones_autonomas_exitosas / total;
  const penalizacion = a.errores_post_cambio * 0.5;
  a.nivel_autonomia = Math.min(10, Math.max(1, (tasa_exito * 10) - penalizacion)).toFixed(1);
  guardarAutonomia(a);
}

export function registrarUsoFuncion(funcion) {
  try {
    const a = cargarAutonomia();
    if (!a.uso_funciones) a.uso_funciones = {};
    a.uso_funciones[funcion] = (a.uso_funciones[funcion] || 0) + 1;
    guardarAutonomia(a);
  } catch(e) {
    console.error("Error registrarUsoFuncion:", e.message);
  }
}

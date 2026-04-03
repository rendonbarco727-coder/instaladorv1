import { execAsync } from '../context.js';
import { preguntarGemini } from '../llm_gemini.js';
import fs from 'fs';
import { ROOT_DIR, CONFIG } from '../../config/bmo.config.js';

export async function auditoriaNocturna(client, { cargarAutonomia, guardarAutonomia, cargarEvoluciones, cargarExperimentos }) {
  const id = CONFIG.admin_wa;
  console.log("Iniciando auditoria nocturna...");

  try {
    const a = cargarAutonomia();
    const ev = cargarEvoluciones();
    const exp = cargarExperimentos();

    const { stdout: ram } = await execAsync("free -m | awk 'NR==2{printf \"%.0f%%\", $3*100/$2}'");
    const { stdout: cpu } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'");
    const { stdout: temp } = await execAsync("vcgencmd measure_temp 2>/dev/null | cut -d= -f2 || echo N/A");
    const { stdout: errores } = await execAsync("journalctl -u wa-bot --since '8h ago' | grep -c 'Error' || echo 0");
    const { stdout: uptime } = await execAsync("uptime -p");

    const topFunciones = Object.entries(a.uso_funciones)
      .sort((a,b) => b[1]-a[1])
      .slice(0, 3)
      .map(([f,n]) => f + ": " + n + " veces")
      .join(", ") || "sin datos";

    const hoy = new Date().toDateString();
    const cambiosHoy = ev.historial.filter(e => new Date(e.fecha).toDateString() === hoy);

    const analisis = await preguntarGemini(
      id,
      `Genera el reporte diario de BMO:
Nivel autonomia: ${a.nivel_autonomia}/10
RAM: ${ram.trim()} | CPU: ${cpu.trim()}% | Temp: ${temp.trim()}
Errores hoy: ${errores.trim()} | Uptime: ${uptime.trim()}
Cambios aplicados hoy: ${cambiosHoy.length}
Funciones mas usadas: ${topFunciones}
Experimento activo: ${exp.activo ? exp.activo.experimento : "ninguno"}
Semanas sin fallos: ${a.semanas_sin_fallos}
Umbral autonomia actual: ${a.umbral_autonomia}/10

Resume el dia, detecta patrones de uso y propone UNA prioridad para manana. Maximo 15 lineas. En espanol.`,
      "Responde en texto natural, usa emojis, sé conciso."
    );

    let mensajeConfianza = "";
    if (a.errores_post_cambio === 0 && cambiosHoy.length > 0) {
      a.semanas_sin_fallos++;
      if (a.semanas_sin_fallos >= 2 && a.umbral_autonomia < 9) {
        a.umbral_autonomia++;
        mensajeConfianza = "\n\n🎯 *Confianza aumentada:* Umbral de autonomía subió a " + a.umbral_autonomia + "/10";
      }
    }

    const semana = new Date().toISOString().slice(0, 10);
    a.historial_semanal.push({
      fecha: semana,
      nivel_autonomia: a.nivel_autonomia,
      errores: parseInt(errores.trim()) || 0,
      cambios: cambiosHoy.length
    });
    if (a.historial_semanal.length > 30) a.historial_semanal.shift();
    guardarAutonomia(a);

    const mensaje = `🌙 *Reporte Diario BMO*
${new Date().toLocaleDateString("es-MX", {weekday:"long", day:"numeric", month:"long"})}

${analisis}

📊 *Índice de Autonomía:* ${a.nivel_autonomia}/10${mensajeConfianza}`;

    await client.sendMessage(id, mensaje);
    console.log("Auditoria nocturna enviada");

    const ultimoReinicio = fs.existsSync("/tmp/ollama_reinicio")
      ? fs.readFileSync("/tmp/ollama_reinicio", "utf8")
      : "0";
    if (Date.now() - parseInt(ultimoReinicio) > 48 * 60 * 60 * 1000) {
      await execAsync("systemctl restart ollama 2>/dev/null || true");
      fs.writeFileSync("/tmp/ollama_reinicio", Date.now().toString());
      console.log("Ollama reiniciado para liberar memoria");
    }

  } catch(err) {
    console.error("Error auditoria nocturna:", err.message);
  }
}

export function programarAuditoriaNocturna(client, deps) {
  const ahora = new Date();
  const objetivo = new Date();
  objetivo.setHours(20, 0, 0, 0);
  if (ahora >= objetivo) objetivo.setDate(objetivo.getDate() + 1);
  const diff = objetivo.getTime() - ahora.getTime();
  console.log("Auditoria nocturna programada en " + Math.round(diff/60000) + " minutos");
  setTimeout(() => {
    auditoriaNocturna(client, deps);
    programarAuditoriaNocturna._interval = setInterval(() => auditoriaNocturna(client, deps), 24 * 60 * 60 * 1000);
  }, diff);
}

export const tareasVerificacion = new Map();

export async function verificarEfecto(client, id, accion, contexto, { monitoresActivos, crearRespaldo, restaurarRespaldo, verificarSintaxis, reiniciarBot, esUsuarioLimitado, comandoBloqueadoParaUsuario }) {
  await new Promise(r => setTimeout(r, 3000));

  let verificacion = null;

  if (accion === "detener_monitor") {
    if (monitoresActivos.has(id)) {
      verificacion = { exito: false, problema: "El monitor sigue activo despues de intentar detenerlo" };
    } else {
      verificacion = { exito: true };
    }
  }

  if (accion === "monitor") {
    if (!monitoresActivos.has(id)) {
      verificacion = { exito: false, problema: "El monitor no se inicio correctamente" };
    } else {
      verificacion = { exito: true };
    }
  }

  if (accion === "comando") {
    if (contexto && contexto.error) {
      verificacion = { exito: false, problema: contexto.error };
    } else {
      verificacion = { exito: true };
    }
  }

  if (!verificacion || verificacion.exito) return;

  const tarea = tareasVerificacion.get(id);
  if (!tarea || tarea.intentos >= 2) {
    tareasVerificacion.delete(id);
    return;
  }

  tarea.intentos++;
  tareasVerificacion.set(id, tarea);

  console.log("Autocorreccion activada para " + accion + ": " + verificacion.problema);

  try {
    const accionSafe = accion.replace(/[^a-zA-Z0-9_]/g, "");
    const { stdout: codigoRelevante } = await execAsync(
      "grep -n '" + accionSafe + "' /home/ruben/wa-ollama/index.js | head -20",
      { timeout: 10000 }
    );

    const analisis = await preguntarGemini(
      id,
      `Encontre un bug: la accion "${accion}" no funciono. Problema: ${verificacion.problema}
Codigo relevante:
${codigoRelevante}
Tarea original del usuario: ${tarea.mensaje}

Genera el comando bash para corregir el codigo. Responde EXACTAMENTE en JSON:
{"accion": "background", "cmd": "python3 comando_correccion", "descripcion": "corrigiendo bug en ${accion}"}`,
      "Responde SOLO con JSON."
    );

    let fix;
    try { fix = JSON.parse(analisis.replace(/```json|```/g, "").trim()); } catch(e) { console.error('Error parseando fix JSON:', e.message); return; }

    if (fix.cmd) {
      console.log("Aplicando correccion: " + fix.cmd.slice(0, 100));
      const backup = await crearRespaldo();
      await execAsync(fix.cmd, { timeout: 60000 });

      const sintaxisOk = await verificarSintaxis();
      if (sintaxisOk) {
        await client.sendMessage(id, "🔧 Detecte y corregi un bug automaticamente. Reiniciando...");
        fs.writeFileSync(`${ROOT_DIR}/tarea_pendiente.json`, JSON.stringify({
          id,
          mensaje: "✅ Bug corregido! Reintentando tu tarea...",
          tarea: tarea.mensaje,
          ejecutar: true
        }));
        setTimeout(() => reiniciarBot(), 2000);
      } else {
        await restaurarRespaldo(backup);
        console.log("Correccion invalida, restaurando backup");
      }
    }
  } catch(err) {
    console.error("Error en autocorreccion:", err.message.slice(0, 100));
  }

  tareasVerificacion.delete(id);
}

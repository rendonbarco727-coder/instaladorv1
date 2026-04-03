import { exec } from 'child_process';
import { promisify } from 'util';
import { agenteSelfCode } from './autocorreccion.js';
import { handleReminderCommands, eliminarRecordatorio } from './reminder_commands.js';
import { handleGoalCommands } from './goal_commands.js';
import { handleSkillsCommands } from './skills_commands.js';
import { handleSchedulerCommands } from './scheduler_commands.js';
import { handleWizardCommands } from './wizard_commands.js';
import { manejarEstadoSistema, manejarSelfImprovement } from './estado_sistema.js';
import { getPendientes } from '../../goals/goal_manager.js';
import { setSesionConfig } from '../../config/api_manager.js';
import { ejecutarAgente as ejecutarAgenteNuevo } from '../orchestrator.js';
import { CONFIG } from '../../config/bmo.config.js';
import fs from 'fs';

const execAsync = promisify(exec);

// Stubs para módulos opcionales no migrados aún
const esAutorizado = (id) => CONFIG.admin_ids.includes(id.replace('@lid','').replace('@c.us','')) || id === CONFIG.admin_wa;
const obtenerModulo = (_) => null;
const evaluarVoluntad = (_msg, _admin) => ({ decision: 'CONTINUAR' });
const procesarInteraccion = () => {};
const resetearContadores = () => {};
const resolverReferencia = () => null;
const obtenerEstado = () => ({ fallos: 0, dudas: 0, temas_fallidos: [] });
const state = { pendientesAutorizacion: new Map() };

/**
 * Maneja todos los comandos y dispatching previos al loop Gemini.
 * Retorna { handled: true } si el mensaje fue procesado, o { handled: false } si debe continuar al loop.
 */
export async function dispatchPreLoop(id, userMessage, client) {

  // Verificar si el admin está autorizando un comando pendiente
  if (esAutorizado(id) && state.pendientesAutorizacion.has(id)) {
    const pendiente = state.pendientesAutorizacion.get(id);
    const expirado = Date.now() - pendiente.timestamp > 5 * 60 * 1000;
    if (expirado) {
      state.pendientesAutorizacion.delete(id);
    } else if (userMessage.trim() === "123456") {
      state.pendientesAutorizacion.delete(id);
      await client.sendMessage(id, "✅ Autorizado. Ejecutando...");
      try {
        const { stdout, stderr } = await execAsync(pendiente.cmd, { timeout: 600000 });
        const salida = (stdout || stderr || "Sin salida").trim();
        await client.sendMessage(id, salida.slice(0, 1500));
      } catch(e) {
        await client.sendMessage(id, "❌ Error: " + e.message.slice(0, 200));
      }
      return { handled: true };
    } else {
      state.pendientesAutorizacion.delete(id);
      await client.sendMessage(id, "❌ Cancelado.");
      return { handled: true };
    }
  }

  // Si el usuario dice "aprende a..." forzar agente de aprendizaje
  if (/aprende (a|como|cómo) /i.test(userMessage)) {
    const tarea = userMessage.replace(/.*aprende (a|como|cómo) /i, "").trim();
    const { validarSeguridad } = await import("../motor_evoluciones.js");
    const segCheck = validarSeguridad(tarea);
    if (!segCheck.seguro) {
      await client.sendMessage(id, "No puedo aprender eso: " + segCheck.razon);
      return { handled: true };
    }
    await client.sendMessage(id, "🧠 Iniciando aprendizaje: " + tarea);
    await agenteSelfCode(client, id, tarea);
    return { handled: true };
  }

  // Comando especial: estado bmo
  if (esAutorizado(id) && /estado bmo/i.test(userMessage)) {
    const eval_ = obtenerEstado();
    const _goals = getPendientes();
    const plan = { pendientes: _goals.length, proximo: _goals[0]?.objetivo || "ninguno" };
    const proximo = _goals[0] || null;
    try {
      const { stdout: ramOut } = await execAsync("free -m");
      const ramInfo = ramOut.split("\n")[1].split(/\s+/);
      const ram = ramInfo[2] + "/" + ramInfo[1] + " MB";
      const { stdout: tempOut } = await execAsync("vcgencmd measure_temp 2>/dev/null | cut -d= -f2 || echo N/A");
      const temp = tempOut.trim();
      const { stdout: errOut } = await execAsync("pm2 logs bmo --lines 500 --nostream 2>/dev/null | grep -c Error || echo 0");
      const errores = errOut.trim();
      const msg = "🤖 *Estado BMO*\n\n" +
        "📊 *Autoevaluador*\nFallos: " + eval_.fallos + " | Dudas: " + eval_.dudas + "\nTemas: " + (eval_.temas_fallidos.slice(0,3).join(", ") || "ninguno") + "\n\n" +
        "🎯 *Planificador*\nPendientes: " + (plan.pendientes?.length || 0) + " | Completados: " + (plan.completados?.length || 0) + "\nProximo: " + (proximo?.descripcion || "ninguno") + "\n\n" +
        "💻 *Sistema*\nRAM: " + ram + "\nTemp: " + temp + "\nErrores 24h: " + errores;
      await client.sendMessage(id, msg);
    } catch(e) {
      await client.sendMessage(id, "Error obteniendo estado: " + e.message);
    }
    return { handled: true };
  }

  // Comando especial: ultimo backup
  if (esAutorizado(id) && /ultimo backup|último backup|ultimo respaldo/i.test(userMessage)) {
    try {
      const { stdout } = await execAsync("ls -t /home/ruben/wa-ollama/backups/index.js.* 2>/dev/null | head -3");
      const archivos = stdout.trim().split("\n").filter(Boolean);
      if (archivos.length === 0) {
        await client.sendMessage(id, "No hay backups todavía.");
      } else {
        const { stdout: fechas } = await execAsync("ls -lt /home/ruben/wa-ollama/backups/index.js.* 2>/dev/null | head -3 | awk '{print $6, $7, $8, $9}'");
        await client.sendMessage(id, "📦 *Últimos backups:*\n" + fechas.trim());
      }
    } catch(e) {
      await client.sendMessage(id, "Error: " + e.message);
    }
    return { handled: true };
  }

  // Comando especial: backup bmo
  if (esAutorizado(id) && /backup bmo|haz.*backup|has.*backup|hacer.*backup|crea.*backup/i.test(userMessage)) {
    try {
      const fecha = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await execAsync(`cp /home/ruben/wa-ollama/index.js /home/ruben/wa-ollama/backups/index.js.manual_${fecha}`);
      await client.sendMessage(id, "✅ Backup creado:\nindex.js.manual_" + fecha);
    } catch(e) {
      await client.sendMessage(id, "❌ Error en backup: " + e.message);
    }
    return { handled: true };
  }

  // Detectar consulta de trafico
  if (/tr[aá]fico|como.*vialidad|como.*carretera/i.test(userMessage) && /de\s+.+\s+(a|al|hacia)\s+/i.test(userMessage)) {
    if (!/a las|todos los|cada dia|siempre|diario/i.test(userMessage)) {
      const mod = obtenerModulo("trafico_monterrey");
      if (mod) {
        await mod.ejecutar({ client, id, execAsync, esAdmin: esAutorizado(id), sesion: { mensajeOriginal: userMessage, ultimoMensaje: userMessage } });
        return { handled: true };
      }
    }
  }

  // Notificaciones de voz a Alexa
  if (/dile a alexa|anuncia|notifica.*alexa|alexa.*diga|alexa.*di/i.test(userMessage)) {
    const modHA = obtenerModulo("home_assistant");
    if (modHA && modHA.notificarAlexa) {
      const msg = userMessage.replace(/dile a alexa|anuncia|notifica.*alexa|alexa.*diga|alexa.*di/i, '').trim();
      const ok = await modHA.notificarAlexa(msg);
      await client.sendMessage(id, ok ? '🔊 Mensaje enviado a Alexa' : '❌ Error enviando a Alexa');
      return { handled: true };
    }
  }

  // Módulo música
  if (/https?:\/\/[^\s]+/i.test(userMessage) && /youtu|soundcloud|spotify|music|cancion|descarga|baja/i.test(userMessage)) {
    const modMusica = obtenerModulo("musica");
    if (modMusica) {
      const manejado = await modMusica.ejecutar({ client, id, sesion: { mensajeOriginal: userMessage, ultimoMensaje: userMessage } });
      if (manejado) return { handled: true };
    }
  }

  // Módulo crear documentos
  if (/carta|contrato|factura|redacta|crea.*carta|genera.*carta/i.test(userMessage)) {
    const modDoc = obtenerModulo("crear_documento");
    if (modDoc) {
      const manejado = await modDoc.ejecutar({ client, id, sesion: { mensajeOriginal: userMessage, ultimoMensaje: userMessage } });
      if (manejado) return { handled: true };
    }
  }

  // Módulo Reporte BES
  if (/genera.*reporte|reporte.*final|cuántos.*activacion|limpiar.*reporte|mis activaciones/i.test(userMessage)) {
    try {
      const { ejecutar: ejecutarBES } = await import('../../evoluciones/reporte_bes.js');
      const manejadoBES = await ejecutarBES({ client, id, msg: null, sesion: { mensajeOriginal: userMessage, ultimoMensaje: userMessage } });
      if (manejadoBES) return { handled: true };
    } catch(e) { console.warn('[BES] Módulo no disponible:', e.message); }
  }

  // Módulo Home Assistant
  if (/luz|luces|enchufe|enciende|apaga|prende|dispositivos|resumen.*casa|home.assistant|salón|cocina|dormitorio/i.test(userMessage) || (/temperatura/i.test(userMessage) && !/\b(script|python|código|programa|bash|procesador|cpu|raspberry|\.py|\.sh)\b/i.test(userMessage))) {
    const modHA = obtenerModulo("home_assistant");
    if (modHA) {
      await modHA.ejecutar({ client, id, sesion: { mensajeOriginal: userMessage, ultimoMensaje: userMessage } });
      return { handled: true };
    }
  }

  // Resolver referencia anafórica
  const referenciaResuelta = resolverReferencia(id, userMessage);
  if (referenciaResuelta) {
    console.log("[Referencia] Resolviendo: " + userMessage + " → " + referenciaResuelta);
    if (/eliminar recordatorio con ID (\d+)/i.test(referenciaResuelta)) {
      const idMatch = referenciaResuelta.match(/ID (\d+)/i);
      if (idMatch) {
        await client.sendMessage(id, eliminarRecordatorio(id, idMatch[1]));
        return { handled: true };
      }
    }
  }

  // Gestión de recordatorios
  if (await handleReminderCommands(userMessage, id, client)) return { handled: true };

  // Evaluar voluntad interna
  const voluntad = evaluarVoluntad(userMessage, esAutorizado(id));
  if (voluntad.decision === 'RECHAZAR') {
    procesarInteraccion(userMessage, false);
    await client.sendMessage(id, "Ahora mismo no tengo ganas. Pregúntame luego.");
    resetearContadores();
    return { handled: true };
  }
  if (voluntad.decision === 'CAMBIAR_TEMA') {
    procesarInteraccion(userMessage, true);
    await client.sendMessage(id, "Oye, cambiemos de tema. ¿Sabías que puedo analizar tu red WiFi, monitorear temperatura o aprender habilidades nuevas? ¿Qué te interesa?");
    resetearContadores();
    return { handled: true };
  }
  if (voluntad.decision === 'PREGUNTAR') {
    const _estadoVolPath = `/tmp/bmo-proyecto-${id}.json`;
    const _hayEstado = fs.existsSync(_estadoVolPath);
    if (!_hayEstado) {
      const temas = ["¿En qué proyecto estás trabajando últimamente?", "¿Quieres que aprenda algo nuevo hoy?", "¿Hay algo del sistema que quieras optimizar?"];
      const pregunta = temas[Math.floor(Math.random() * temas.length)];
      procesarInteraccion(userMessage, true);
      await client.sendMessage(id, pregunta);
      resetearContadores();
      return { handled: true };
    }
  }

  // Comando estado del sistema
  if (esAutorizado(id) && await manejarEstadoSistema(userMessage, id, client).catch(() => false)) return { handled: true };

  // Goal commands
  if (await handleGoalCommands(userMessage, id, client)) return { handled: true };

  // Skills commands
  if (await handleSkillsCommands(userMessage, id, client)) return { handled: true };

  // Scheduler commands
  if (await handleSchedulerCommands(userMessage, id, client)) return { handled: true };

  // Self-improvement manual
  if (esAutorizado(id)) {
    try {
      const siHandled = await manejarSelfImprovement({ body: userMessage, reply: async (t) => client.sendMessage(id, t) }, id);
      if (siHandled) return { handled: true };
    } catch(e) { console.log('[SI] Error:', e.message); }
  }

  // RL Stats
  if (esAutorizado(id) && /rl stats|estadisticas.*aprendizaje|que.*aprendi.*bmo/i.test(userMessage)) {
    try {
      const { ReinforcementLearning } = await import('../../memory/reinforcement_learning.js');
      const rl = new ReinforcementLearning();
      const stats = rl.getStats(10);
      if (!stats.length) {
        await client.sendMessage(id, '📊 RL: Sin datos aún.');
      } else {
        const lineas = stats.map((s, i) => {
          const total = s.wins + s.losses;
          const pct = total > 0 ? Math.round((s.wins / total) * 100) : 0;
          const bar = '█'.repeat(Math.round(pct/10)) + '░'.repeat(10 - Math.round(pct/10));
          return `${i+1}. ${s.action}
   ${bar} ${pct}% (✅${s.wins} ❌${s.losses} 🏆${s.reward})`;
        });
        await client.sendMessage(id, '📊 *RL Stats — Lo que BMO ha aprendido:*\n\n' + lineas.join('\n\n'));
      }
    } catch(e) {
      await client.sendMessage(id, '❌ Error RL: ' + e.message);
    }
    return { handled: true };
  }

  // Knowledge Stats
  if (esAutorizado(id) && /knowledge stats|stats.*knowledge|que.*sabe.*bmo|memoria.*bmo stats/i.test(userMessage)) {
    try {
      const { ejecutarTool } = await import('../../tools/tool_registry.js');
      const result = await ejecutarTool('knowledge_manager', 'stats', { userId: id });
      await client.sendMessage(id, result);
    } catch(e) {
      await client.sendMessage(id, '❌ Error knowledge: ' + e.message);
    }
    return { handled: true };
  }

  // ── MEMORY.md — ver, añadir, limpiar ──────────────────────────────
  if (esAutorizado(id) && /(BMO,?\s*)?(ver|muestra|show)\b.{0,30}memory/i.test(userMessage)) {
    const { leerMemoryMd } = await import('../context_compaction.js');
    const mem = leerMemoryMd();
    await client.sendMessage(id, mem?.trim()
      ? `📖 *MEMORY.md:*\n\n${mem.slice(-3000)}`
      : '📖 MEMORY.md está vacío aún.');
    return { handled: true };
  }

  if (esAutorizado(id) && /BMO,?\s*recuerda\s+(.+)/i.test(userMessage)) {
    const match = userMessage.match(/BMO,?\s*recuerda\s+(.+)/i);
    const hecho = match[1].trim();
    try {
      const { ROOT_DIR } = await import('../../config/bmo.config.js');
      const fs = await import('fs');
      const path = await import('path');
      const MEMORY_MD = path.default.join(ROOT_DIR, 'MEMORY.md');
      const hoy = new Date().toISOString().slice(0, 10);
      const entrada = `\n- [${hoy}] ${hecho}\n`;
      fs.default.appendFileSync(MEMORY_MD, entrada);
      await client.sendMessage(id, `✅ Anotado en MEMORY.md:\n_${hecho}_`);
    } catch(e) {
      await client.sendMessage(id, '❌ Error escribiendo MEMORY.md: ' + e.message);
    }
    return { handled: true };
  }

  if (esAutorizado(id) && /BMO,?\s*olvida\s+memory|BMO,?\s*limpia\s+memory/i.test(userMessage)) {
    try {
      const { ROOT_DIR } = await import('../../config/bmo.config.js');
      const fs = await import('fs');
      const path = await import('path');
      const MEMORY_MD = path.default.join(ROOT_DIR, 'MEMORY.md');
      fs.default.writeFileSync(MEMORY_MD, `# MEMORY.md — BMO\nActualizado: ${new Date().toISOString()}\n`);
      await client.sendMessage(id, '🗑️ MEMORY.md limpiado.');
    } catch(e) {
      await client.sendMessage(id, '❌ Error: ' + e.message);
    }
    return { handled: true };
  }

  // ── AGENTS.md — ver y editar reglas de comportamiento ───────────────
  if (esAutorizado(id) && /BMO,?\s*(ver|muestra|show)\s*agents/i.test(userMessage)) {
    try {
      const { ROOT_DIR } = await import('../../config/bmo.config.js');
      const fs = await import('fs');
      const path = await import('path');
      const AGENTS_MD = path.default.join(ROOT_DIR, 'AGENTS.md');
      const contenido = fs.default.existsSync(AGENTS_MD)
        ? fs.default.readFileSync(AGENTS_MD, 'utf8')
        : '_(AGENTS.md no existe aún)_';
      await client.sendMessage(id, `⚙️ *AGENTS.md:*\n\n${contenido.slice(-3000)}`);
    } catch(e) {
      await client.sendMessage(id, '❌ Error: ' + e.message);
    }
    return { handled: true };
  }

  if (esAutorizado(id) && /BMO,?\s*regla:\s*(.+)/i.test(userMessage)) {
    const match = userMessage.match(/BMO,?\s*regla:\s*(.+)/i);
    const regla = match[1].trim();
    try {
      const { ROOT_DIR } = await import('../../config/bmo.config.js');
      const fs = await import('fs');
      const path = await import('path');
      const AGENTS_MD = path.default.join(ROOT_DIR, 'AGENTS.md');
      if (!fs.default.existsSync(AGENTS_MD)) {
        fs.default.writeFileSync(AGENTS_MD, '# AGENTS.md — Reglas de comportamiento BMO\n\n');
      }
      const hoy = new Date().toISOString().slice(0, 10);
      fs.default.appendFileSync(AGENTS_MD, `\n- [${hoy}] ${regla}\n`);
      await client.sendMessage(id, `✅ Regla añadida a AGENTS.md:\n_${regla}_`);
    } catch(e) {
      await client.sendMessage(id, '❌ Error: ' + e.message);
    }
    return { handled: true };
  }

  // ── Diario — ver entradas del día ───────────────────────────────────
  if (esAutorizado(id) && /BMO,?\s*(ver|muestra)\s*diario/i.test(userMessage)) {
    const { leerDiarioHoy } = await import('../context_compaction.js');
    const diario = leerDiarioHoy();
    await client.sendMessage(id, diario?.trim()
      ? `📅 *Diario de hoy:*\n\n${diario.slice(-3000)}`
      : '📅 El diario de hoy está vacío aún.');
    return { handled: true };
  }

  return { handled: false };
}

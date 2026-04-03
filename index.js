import "dotenv/config";
import { procesarConIA } from "./core/message_router.js";
import { state, TEMP_DIR, URL_REGEX, GEMINI_MODEL, OLLAMA_MODEL, GEMINI_RETRY_MS, SESSION_TTL, BACKUP_DIR, EVOLUCIONES_FILE, EXPERIMENTOS_FILE, AUTONOMIA_FILE, META_FILE, MEMORIA_CMDS_FILE, ERRORES_FILE, HISTORIAL_FILE, USUARIOS_FILE } from "./core/state.js";
import { manejarEstadoSistema, manejarSelfImprovement } from "./core/features/estado_sistema.js";
import { createRequire } from "module";
// ── Global error handlers — evitan que BMO muera silenciosamente ──
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err.message);
    console.error(err.stack?.split('\n').slice(0,4).join(' | '));
    // No salir — PM2 maneja reinicios, pero logueamos para debug
});

process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection:', reason?.message || reason);
});


const _require = createRequire(import.meta.url);
const BetterSQLite = _require("better-sqlite3");
import fs_startup from "fs";
import { procesarImagenBES } from "./evoluciones/reporte_bes.js";
import { ejecutarAgente as ejecutarAgenteNuevo, registrarClienteScheduler } from "./core/orchestrator.js";
import { iniciarGateway } from "./core/gateway.js";
import { programarTarea, cancelarTarea, listarTareas } from "./core/scheduler.js";
import { crearGoal, listarGoals, getGoal, actualizarEstado, marcarCompleto, formatearGoals, getPendientes, incrementarIntentos } from "./goals/goal_manager.js";
import { ejecutarGoal } from "./goals/goal_executor.js";
import { iniciarGoalScheduler } from "./goals/goal_scheduler.js";
import { cargarHistorial, guardarHistorial, getHistorial, agregarAlHistorial, getHistorialGemini, esUsuarioNuevo, registrarUsuario, getNombreUsuario } from "./core/session_history.js";
import { preguntarGemini, generarComandoOllama } from "./core/llm_gemini.js";
import { buscarWeb, buscarConSearXNG } from "./core/web_search.js";

// Router: usar nuevo orquestador (se puede cambiar a false para volver al viejo)

// Comando admin: estado del sistema
import { crearNuevoModulo, intentarConModulosDinamicos, listarEvoluciones } from "./cognicion/auto_evolucion.js";
import { guardarMemoria, buscarMemoriasRelevantes, obtenerResumenMemoria, procesarMensajeParaMemoria } from "./cognicion/memoria_bmo.js";
import { enqueue } from './core/message_queue.js';
import { handleMessage } from './core/features/message_handler.js';

// Limpiar locks de Chromium al arrancar
try {
  const locks = [
    "/home/ruben/wa-ollama/auth_session/session/SingletonLock",
    "/home/ruben/wa-ollama/auth_session/session/SingletonCookie",
    "/home/ruben/wa-ollama/auth_session/session/SingletonSocket"
  ];
  for (const f of locks) {
    if (fs_startup.existsSync(f)) { fs_startup.unlinkSync(f); console.log("Lock eliminado: " + f); }
  }
} catch(e) { console.error("Error silencioso:", e.message); }
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { aprenderHabilidad, obtenerModulo, listarModulos, cargarModulosExistentes } from "./core/motor_evoluciones.js";
import { generarRetoDelDia, ejecutarRetoPendiente, registrarLeccion, registrarHabilidad, incrementarUsoHabilidad, obtenerContextoBanco, obtenerEstadoBanco } from "./core/banco_habilidades.js";
import "./bmo_endpoint.js";
import { obtenerMemoria, actualizarMemoria, agregarTema, generarContextoMemoria, actualizarNarrativa, generarNarrativa } from "./core/user_memory.js";
import { esConsultaDeIdentidad, esConsultaSiSoyIA, obtenerRespuestaIdentidad, obtenerRespuestaSiSoyIA, generarContextoPersonalidad } from "./core/personality.js";
import { registrarFallo, registrarDuda, resetearContadores, necesitaAprender, obtenerTemaParaAprender, obtenerEstado } from "./core/self_eval.js";
import { generarContextoCompleto, registrarExito, registrarFalloComando, registrarArchivo } from "./core/knowledge_base.js";
import { probarModulo, listarExperimentos, aprobarModulo } from "./sandbox/laboratorio.js";
import { parsearIntent } from "./core/intent_parser.js";
import { corregirError, vigilarLogs } from "./core/code_corrector.js";
import { resolverReferencia, guardarContexto, obtenerContexto } from "./core/reference_resolver.js";
import { preguntarConFallback } from "./core/fallback_ia.js";
import { evaluarVoluntad, procesarInteraccion, generarContextoVoluntad, obtenerEstadoInterno } from "./core/mood.js";
import { debatirRespuesta, necesitaDebate, registrarDebate } from "./core/debate.js";
import { execAsync, esAutorizado, ADMIN_IDS } from "./core/context.js";
import { detectarEnlace, esUsuarioLimitado, accionPermitidaParaTodos, comandoBloqueadoParaUsuario, splitText, resetearTokensSiNuevoDia, estimarTokens, generateWithOllama15b, getSession, setSession, clearSession } from "./core/utils_bot.js";
import { cargarEvoluciones, guardarEvoluciones, cargarExperimentos, guardarExperimentos, verificarLimites, registrarEvolucion, evaluacionEvolutiva, manejarRespuestaPropuesta, cargarAutonomia, guardarAutonomia, registrarAccion, registrarUsoFuncion } from "./core/features/evoluciones_manager.js";
import { cargarMemoriaComandos, guardarComandoExitoso, buscarComandoSimilar, cargarErrores, guardarError, obtenerContextoErrores } from "./core/features/memoria_comandos.js";
import { handleSkillsCommands } from "./core/features/skills_commands.js";
import { handleGoalCommands } from "./core/features/goal_commands.js";
import { handleSchedulerCommands } from "./core/features/scheduler_commands.js";
import { descargarMedia, procesarColaDescargas, ultimoArchivo as ultimoArchivoDescarga } from "./core/features/download_commands.js";
import { handleWizardCommands } from "./core/features/wizard_commands.js";
import { handleReminderCommands, iniciarRecordatorios, setClientGlobal, recordatorios, manejarRecordatorio, listarRecordatorios, eliminarRecordatorio, modificarRecordatorio, parsearFecha, parsearDiasSemana, programarRecordatorio, guardarRecordatorios } from "./core/features/reminder_commands.js";
import { revisarMensajesPerdidos } from "./core/features/mensajes_perdidos.js";
import { auditoriaNocturna, programarAuditoriaNocturna, verificarEfecto, tareasVerificacion } from "./core/features/auditoria.js";
import { agenteSelfCode, autocorreccionBackground, crearRespaldo, restaurarRespaldo, reiniciarBot, verificarSintaxis } from "./core/features/autocorreccion.js";
import { enviarResumenNocturno, programarResumenNocturno, transcribirAudio, obtenerClima, generarImagen } from "./core/features/utilidades.js";
import { onReady, onDisconnected } from "./core/features/startup.js";

// --- Deteccion de enlaces ---

// --- Descarga de enlaces ---
// --- Resumen nocturno automatico ---
// --- Agente de autocódigo autonomo ---
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);


// --- Cliente WhatsApp ---
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: "./auth_session" }),
  puppeteer: {
    executablePath: "/usr/bin/chromium",
    headless: true,
    timeout: 600000,
    protocolTimeout: 600000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-default-apps",
      "--mute-audio",
    ],
  },
});

client.on("qr", (qr) => { console.log("\nESCANEA ESTE QR:\n"); qrcode.generate(qr, { small: true }); });
client.on("ready", () => onReady(client));
client.on("authenticated", () => console.log("Autenticado"));
client.on("auth_failure", (msg) => console.error("Auth fallida:", msg));
client.on("disconnected", (reason) => onDisconnected(client, reason));

client.on("message", async (msg) => {
  if (msg.from === "status@broadcast" || msg.fromMe || msg.from.endsWith("@g.us")) return;
  const id = msg.from;
  enqueue(id, () => handleMessage(msg, id, client, procesarConIA));
});




client.initialize();

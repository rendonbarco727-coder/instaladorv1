import { state, GEMINI_RETRY_MS, SESSION_TTL, ARCHIVOS_DIR } from './state.js';
import { preguntarGemini } from './llm_gemini.js';
import { getTokensHoy } from './llm_gemini.js';
import { buscarWeb } from './web_search.js';
import { agregarAlHistorial, getHistorialGemini, getNombreUsuario } from './session_history.js';
import { procesarMensajeParaMemoria } from '../cognicion/memoria_bmo.js';
import { execAsync } from './context.js';
import { enqueue } from './message_queue.js';
import { obtenerModulo } from './motor_evoluciones.js';
import { evaluarVoluntad, procesarInteraccion, generarContextoVoluntad } from './mood.js';
import { debatirRespuesta, necesitaDebate, registrarDebate } from './debate.js';
import { parsearIntent } from './intent_parser.js';
import { resolverReferencia, obtenerContexto } from './reference_resolver.js';
import { registrarFallo, registrarDuda, resetearContadores, necesitaAprender, obtenerTemaParaAprender, obtenerEstado } from './self_eval.js';
import { registrarExito, registrarFalloComando } from './knowledge_base.js';
import { dispatchPreLoop } from './features/command_dispatcher.js';
import { runGeminiLoop } from './gemini_loop.js';
import { crearGoal, getPendientes } from '../goals/goal_manager.js';
import { crearNuevoModulo, intentarConModulosDinamicos, listarEvoluciones } from '../cognicion/auto_evolucion.js';
import { ejecutarRetoPendiente, obtenerEstadoBanco } from './banco_habilidades.js';
import { handleReminderCommands, recordatorios, manejarRecordatorio, eliminarRecordatorio, modificarRecordatorio, guardarRecordatorios } from './features/reminder_commands.js';
import { ultimoArchivo as ultimoArchivoDescarga } from './features/download_commands.js';
import { manejarComandoAgente } from '../evoluciones/agente_autonomo.js';
import { setSesionConfig } from '../config/api_manager.js';
import { ejecutar as ejecutarBES } from '../evoluciones/reporte_bes.js';
import { esAutorizado } from './context.js';
import { detectarEnlace, esUsuarioLimitado, accionPermitidaParaTodos, splitText, resetearTokensSiNuevoDia, generateWithOllama15b, getSession, setSession, clearSession } from './utils_bot.js';
import { registrarAccion, registrarUsoFuncion } from './features/evoluciones_manager.js';
import { vigilarLogs } from './code_corrector.js';
import { obtenerClima, generarImagen } from './features/utilidades.js';
import { buscarComandoSimilar } from './features/memoria_comandos.js';
import fs from 'fs';
import path from 'path';


export async function procesarConIA(id, userMessage, client) {
  // Guard — rate limiting y validación
  try {
    const { checkGuard } = await import('./guard.js');
    const guard = checkGuard(id, userMessage);
    if (!guard.ok) {
      if (guard.reason === 'rate_limit') {
        await client.sendMessage(id, `⏳ Vas muy rápido. Espera ${guard.remaining}s.`);
      }
      // Cooldown y empty: ignorar silenciosamente
      if (guard.reason === 'blocked') {
        await client.sendMessage(id, '🚫 Tu cuenta está temporalmente bloqueada.');
      }
      return;
    }
  } catch(e) { console.error('[ROUTER] guard.js error:', e.message); }
  resetearTokensSiNuevoDia();


  // Si Gemini no esta disponible, usar Ollama 1.5b directamente
  if (!state.geminiDisponible) {
    console.log("Modo fallback: usando Ollama 1.5b");
    const tiempoRestante = state.geminiCaidoDesde ? Math.max(0, Math.ceil((GEMINI_RETRY_MS - (Date.now() - state.geminiCaidoDesde)) / 1000)) : 0;
    await client.sendMessage(id, "Estoy en modo local ahora (Gemini en pausa). Puedo conversar aunque sin tareas avanzadas del sistema. Reintentare Gemini en " + tiempoRestante + "s.");
    const respuesta = await generateWithOllama15b(id, userMessage);
    agregarAlHistorial(id, "user", userMessage);
    agregarAlHistorial(id, "assistant", respuesta);
    procesarMensajeParaMemoria(id, userMessage, respuesta);
    for (const part of splitText(respuesta)) { await client.sendMessage(id, part); }
    return;
  }

  // Bloquear instalaciones para usuarios normales
  if (esUsuarioLimitado(id) && /instalar |apt |pip |npm install|sudo /.test(userMessage)) {
    await client.sendMessage(id, "Lo siento, no puedo hacer eso. Puedo ayudarte con busquedas, imagenes, descargas o recordatorios.");
    return;
  }

  // Bloquear acciones no permitidas para usuarios limitados
  if (esUsuarioLimitado(id)) {
    const permitido = accionPermitidaParaTodos(null, userMessage);
    if (!permitido) {
      await client.sendMessage(id,
        "Solo puedo ayudarte con:\n\n" +
        "🎵 Descargar videos y música (YouTube, TikTok, etc.)\n" +
        "🔍 Buscar en internet\n" +
        "🌤️ Consultar el clima\n" +
        "📄 Convertir archivos (Word ↔ PDF, imagen a PDF)\n" +
        "🖼️ Crear imágenes\n" +
        "⏰ Crear recordatorios\n\n" +
        "Si necesitas algo más, pídele a Ruben."
      );
      return;
    }
  }

  if ((await dispatchPreLoop(id, userMessage, client)).handled) return;

  await runGeminiLoop(id, userMessage, client, esAutorizado(id), recordatorios);
}

import { state, ARCHIVOS_DIR } from '../state.js';
import { preguntarGemini, getTokensHoy } from '../llm_gemini.js';
import { debatirRespuesta, necesitaDebate, registrarDebate } from '../debate.js';
import { agregarAlHistorial, getHistorialGemini, getNombreUsuario } from '../session_history.js';
import { procesarMensajeParaMemoria } from '../../cognicion/memoria_bmo.js';
import { execAsync, esAutorizado } from '../context.js';
import { registrarFallo, registrarDuda, necesitaAprender, obtenerTemaParaAprender } from '../self_eval.js';
import { registrarExito, registrarFalloComando } from '../knowledge_base.js';
import { splitText, generateWithOllama15b } from '../utils_bot.js';
import { registrarUsoFuncion } from './evoluciones_manager.js';
import { agenteSelfCode } from './autocorreccion.js';
import { vigilarLogs } from '../code_corrector.js';
import { obtenerClima, generarImagen } from './utilidades.js';
import { buscarWeb } from '../web_search.js';
import { manejarRecordatorio, eliminarRecordatorio, modificarRecordatorio, guardarRecordatorios } from './reminder_commands.js';
// import listarModulos movido a motor_evoluciones import unificado
import { intentarConModulosDinamicos, crearNuevoModulo } from '../../cognicion/auto_evolucion.js';
import { actualizarNarrativa } from '../user_memory.js';
import { procesarInteraccion } from '../mood.js';
import { validarSeguridad, probarModulo, listarExperimentos, aprobarModulo, cargarModulosExistentes } from '../motor_evoluciones.js';
import { presionarTecla, clickEnPantalla as clickEn, escribirEnPantalla as escribirTexto, ejecutarTerminal } from '../../evoluciones/agente_autonomo.js';
// Stubs temporales para funciones pendientes en agente_autonomo.js
const abrirPrograma = async (p) => ejecutarTerminal(`xdg-open "${p}" &`);
const tomarCaptura  = async (ruta) => ejecutarTerminal(`scrot "${ruta}"`);
const listarVentanas = async () => ejecutarTerminal('wmctrl -l');
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import fs from 'fs';
import path from 'path';

/**
 * Llama a Gemini (o debate multi-agente) y maneja la respuesta completa.
 * Retorna true si el mensaje fue manejado, false para reintentar.
 */
export async function handleResponse(id, userMessage, client, esAdmin, contextoCompleto, contextoErrores, intentos, MAX_INTENTOS, recordatorios, activeDocuments) {

  // ── Llamada a Gemini (debate o directo) ─────────────────────
  let respuestaGemini;
  if (necesitaDebate(userMessage)) {
    const historialGemini = getHistorialGemini(id);
    const nombreUsuario = getNombreUsuario(id) || "Usuario";
    const ahora = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const sysPromptDebate = `Eres BMO, un asistente de WhatsApp inteligente corriendo en Raspberry Pi. Fecha: ${ahora}. Usuario: ${nombreUsuario}. Responde en español conciso y útil. Si requieres ejecutar comandos o acciones responde con JSON {"accion":"..."}.\n${contextoCompleto}`;
    const resultado = await debatirRespuesta(userMessage, sysPromptDebate, historialGemini);
    if (resultado) {
      respuestaGemini = resultado.respuesta;
      registrarDebate(userMessage, resultado);
    } else {
      respuestaGemini = await preguntarGemini(id, userMessage, contextoCompleto, esAdmin);
    }
  } else {
    respuestaGemini = await preguntarGemini(id, userMessage, contextoCompleto, esAdmin);
  }

  // ── Fallback Ollama si Gemini no responde ────────────────────
  if (!respuestaGemini) {
    if (!state.geminiDisponible) {
      console.log("Gemini cayo a mitad de tarea - Ollama retoma");
      await client.sendMessage(id, "Gemini no esta disponible ahora, retomando con modo local...");
      const respuesta = await generateWithOllama15b(id, userMessage);
      agregarAlHistorial(id, "user", userMessage);
      agregarAlHistorial(id, "assistant", respuesta);
      procesarMensajeParaMemoria(id, userMessage, respuesta);
      for (const part of splitText(respuesta)) { await client.sendMessage(id, part); }
    } else {
      await client.sendMessage(id, "No pude conectarme con el servicio de IA.");
    }
    return { manejado: true, contextoErrores };
  }

  // ── Parsear si es un comando JSON ───────────────────────────
  let esComando = false;
  let cmdData = null;

  try {
    console.log("Respuesta Gemini raw:", respuestaGemini.slice(0, 200));
    respuestaGemini = respuestaGemini.replace(/nmap[^"]*192\.168\.[^"]*\/24[^"]*/g, "arp -a");
    respuestaGemini = respuestaGemini.replace(/bluetoothctl scan on/g, "bluetoothctl devices");
    const jsonMatch = respuestaGemini.match(/\{[\s\S]*?"accion"[\s\S]*?\}/s);
    console.log("JSON match:", jsonMatch ? jsonMatch[0] : "ninguno");
    if (jsonMatch) {
      try {
        cmdData = JSON.parse(jsonMatch[0]);
      } catch(parseErr) {
        const cmdMatch = jsonMatch[0].match(/"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        const accionMatch = jsonMatch[0].match(/"accion"\s*:\s*"([^"]+)"/);
        if (cmdMatch && accionMatch) {
          cmdData = { accion: accionMatch[1], cmd: cmdMatch[1].replace(/\\n/g, " ") };
          console.log("JSON parseado con fallback regex:", cmdData.cmd.slice(0, 80));
        }
      }
      esComando = true;
    } else {
      const esConversacion = /^(hola|hello|hi|hey|buenas|qué tal|que tal|cómo estás|como estas|gracias|ok|bien|sí|si|no|vale|claro|perfecto|genial|entendido|qué haces|que haces|qué estás|que estas|cómo vas|como vas|ahorita|ahora mismo|cuéntame|cuentame)/i.test(userMessage.trim());
      const esPeticionHabilidad = /aprende|habilidad|implementa|crea un módulo|automatiza|configura|instala/i.test(userMessage);
      if (!esConversacion && esPeticionHabilidad) registrarDuda(userMessage.slice(0, 80));
      if (necesitaAprender()) {
        const tema = obtenerTemaParaAprender();
        console.log(`[AutoEval] Disparando aprendizaje: ${tema}`);
        await agenteSelfCode(client, id, tema);
        resetearContadores();
      }
    }
  } catch(e) {
    esComando = false;
    registrarFallo(userMessage.slice(0, 80));
    if (necesitaAprender()) {
      const tema = obtenerTemaParaAprender();
      console.log(`[AutoEval] Fallo detectado, aprendiendo: ${tema}`);
      await agenteSelfCode(client, id, tema);
      resetearContadores();
    }
  }

  // ── Accion: enviar archivo ───────────────────────────────────
  if (cmdData?.accion === "enviar_archivo" ||
      /mándame|mandame|envíame|enviame|comparte|descarga|dame.*archivo|quiero.*archivo/i.test(userMessage)) {
    const userDir = path.join(ARCHIVOS_DIR, id.replace(/[^a-z0-9]/gi, "_"));
    const listaActiva = state.contextoListas.get(id);
    const numPedido = parseInt(userMessage.match(/\b(\d+)\b/)?.[1]) - 1;
    const nombrePedido = cmdData?.archivo || cmdData?.nombre;
    let archivoInfo = null;
    if (listaActiva && !isNaN(numPedido) && numPedido >= 0 && numPedido < listaActiva.length) {
      archivoInfo = listaActiva[numPedido];
    } else if (listaActiva && nombrePedido) {
      archivoInfo = listaActiva.find(a => a.nombre.toLowerCase().includes(nombrePedido.toLowerCase()));
    } else if (nombrePedido) {
      const carpetas = fs.existsSync(userDir)
        ? fs.readdirSync(userDir).filter(f => fs.statSync(path.join(userDir, f)).isDirectory())
        : [];
      for (const c of carpetas) {
        const archivos = fs.readdirSync(path.join(userDir, c));
        const encontrado = archivos.find(a => a.toLowerCase().includes(nombrePedido.toLowerCase()));
        if (encontrado) { archivoInfo = { nombre: encontrado, carpeta: c }; break; }
      }
    }
    if (!archivoInfo) {
      await client.sendMessage(id, "No sé qué archivo quieres. Primero dime qué hay en una carpeta y luego pídeme el número.");
      return { manejado: true, contextoErrores };
    }
    const rutaArchivo = path.join(userDir, archivoInfo.carpeta, archivoInfo.nombre);
    if (!fs.existsSync(rutaArchivo)) {
      await client.sendMessage(id, `No encontré el archivo *${archivoInfo.nombre}*.`);
      return { manejado: true, contextoErrores };
    }
    try {
      await client.sendMessage(id, `Enviando *${archivoInfo.nombre}*...`);
      const media = MessageMedia.fromFilePath(rutaArchivo);
      await client.sendMessage(id, media, { caption: archivoInfo.nombre });
      agregarAlHistorial(id, "user", userMessage);
      agregarAlHistorial(id, "assistant", "Archivo enviado: " + archivoInfo.nombre);
    } catch(e) {
      await client.sendMessage(id, "Error al enviar el archivo: " + e.message.slice(0, 100));
    }
    return { manejado: true, contextoErrores };
  }

  // ── Accion: tokens ───────────────────────────────────────────
  if (cmdData?.accion === "tokens") {
    const tokensHoy = getTokensHoy();
    await client.sendMessage(id, "📊 Tokens usados hoy: " + tokensHoy.toLocaleString() + "\nLímite diario Gemini: 1,500,000");
    return { manejado: true, contextoErrores };
  }

  // ── Accion: clima ────────────────────────────────────────────
  if (cmdData?.accion === "clima" && cmdData?.ciudad) {
    const climaRaw = await obtenerClima(cmdData.ciudad);
    if (climaRaw) {
      let climaFinal = climaRaw;
      if (climaRaw.includes("via búsqueda")) {
        const resumen = await preguntarGemini(id,
          "Basandote en esta informacion de busqueda, responde de forma natural y concisa sobre el clima en " + cmdData.ciudad + ":\n" + climaRaw,
          "Responde en 2-3 lineas en espanol, sin JSON."
        );
        climaFinal = "🌤 " + (resumen || climaRaw);
      }
      await client.sendMessage(id, climaFinal);
      agregarAlHistorial(id, "user", userMessage);
      agregarAlHistorial(id, "assistant", climaFinal);
    } else {
      await client.sendMessage(id, "No pude obtener el clima de " + cmdData.ciudad);
    }
    return { manejado: true, contextoErrores };
  }

  // ── Accion: gui ──────────────────────────────────────────────
  if (cmdData?.accion === "gui") {
    const { subaccion, programa, texto, tecla, x, y } = cmdData;
    try {
      if (subaccion === "abrir") {
        await abrirPrograma(programa);
        await new Promise(r => setTimeout(r, 2000));
        const captura = await tomarCaptura("/tmp/gui_captura.png");
        const imgData = fs.readFileSync(captura);
        const media = new MessageMedia("image/png", imgData.toString("base64"), "captura.png");
        await client.sendMessage(id, media, { caption: "✅ Abrí " + programa });
      } else if (subaccion === "captura") {
        const captura = await tomarCaptura("/tmp/gui_captura.png");
        const imgData = fs.readFileSync(captura);
        const media = new MessageMedia("image/png", imgData.toString("base64"), "captura.png");
        await client.sendMessage(id, media, { caption: "📸 Captura de pantalla" });
      } else if (subaccion === "escribir") {
        await escribirTexto(texto);
        await client.sendMessage(id, "✅ Escribí: " + texto);
      } else if (subaccion === "tecla") {
        await presionarTecla(tecla);
        await client.sendMessage(id, "✅ Presioné: " + tecla);
      } else if (subaccion === "click") {
        await clickEn(x, y);
        await client.sendMessage(id, "✅ Click en " + x + "," + y);
      } else if (subaccion === "ventanas") {
        const ventanas = await listarVentanas();
        await client.sendMessage(id, "🪟 Ventanas abiertas:\n" + (ventanas || "Ninguna"));
      }
    } catch(e) {
      await client.sendMessage(id, "❌ Error GUI: " + e.message);
    }
    return { manejado: true, contextoErrores };
  }

  // ── Accion: detener monitor ──────────────────────────────────
  if (cmdData?.accion === "detener_monitor") {
    if (state.monitoresActivos.has(id)) {
      clearInterval(state.monitoresActivos.get(id));
      state.monitoresActivos.delete(id);
      await client.sendMessage(id, "✅ Monitor detenido.");
    } else {
      const idBase = id.split('@')[0];
      for (const [key, val] of state.monitoresActivos.entries()) {
        if (key.includes(idBase)) {
          clearInterval(val);
          state.monitoresActivos.delete(key);
          await client.sendMessage(id, "✅ Monitor detenido.");
          return { manejado: true, contextoErrores };
        }
      }
      await client.sendMessage(id, "No habia monitor activo.");
    }
    return { manejado: true, contextoErrores };
  }

  // ── Accion: monitor periodico ────────────────────────────────
  if (cmdData?.accion === "monitor" && cmdData?.cmd) {
    const intervalo = (cmdData.intervalo || 30) * 1000;
    const duracion = (cmdData.duracion || 120) * 1000;
    const totalEjecuciones = Math.floor(duracion / intervalo);
    let ejecucion = 0;
    await client.sendMessage(id, "Iniciando monitor cada " + (intervalo/1000) + "s por " + (duracion/1000) + "s...");
    const monitorInterval = setInterval(async () => {
      ejecucion++;
      try {
        const { stdout } = await execAsync("DISPLAY=:99 " + cmdData.cmd, { timeout: 10000 });
        const salida = stdout.trim().slice(0, 300);
        const respuesta = await preguntarGemini(id,
          "MONITOR #" + ejecucion + "/" + totalEjecuciones + ":\n" + salida + "\nResume en 1 linea el estado actual.",
          "Responde en texto natural, muy corto, sin JSON."
        );
        await client.sendMessage(id, "📊 Monitor #" + ejecucion + ": " + (respuesta || salida));
      } catch(e) {
        await client.sendMessage(id, "Error en monitor: " + e.message.slice(0, 100));
      }
      if (ejecucion >= totalEjecuciones) {
        clearInterval(monitorInterval);
        await client.sendMessage(id, "✅ Monitor finalizado.");
      }
    }, intervalo);
    state.monitoresActivos.set(id, monitorInterval);
    return { manejado: true, contextoErrores };
  }

  // ── Accion: aprender habilidad ───────────────────────────────
  if (cmdData?.accion === "aprender" && cmdData?.habilidad) {
    await agenteSelfCode(client, id, cmdData.habilidad);
    return { manejado: true, contextoErrores };
  }

  // ── Accion: listar habilidades ───────────────────────────────
  if (cmdData?.accion === "listar_habilidades") {
    const habilidades = listarModulos();
    const msg = habilidades.length > 0
      ? "🧠 Habilidades aprendidas:\n" + habilidades.map((h,i) => (i+1)+". "+h).join("\n")
      : "No he aprendido habilidades nuevas aun.";
    await client.sendMessage(id, msg);
    return { manejado: true, contextoErrores };
  }

  // ── Accion: recordatorios ────────────────────────────────────
  if (cmdData?.accion === "modificar_recordatorio" && cmdData?.recordId) {
    const cambios = {};
    if (cmdData.diasSemana && cmdData.diasSemana.length > 0) { cambios.diasSemana = cmdData.diasSemana; cambios.recurrente = true; }
    if (cmdData.hora) cambios.hora = cmdData.hora;
    if (cmdData.recurrente !== undefined) cambios.recurrente = cmdData.recurrente;
    await client.sendMessage(id, modificarRecordatorio(id, cmdData.recordId, cambios));
    return { manejado: true, contextoErrores };
  }

  if (cmdData?.accion === "eliminar_recordatorio" && cmdData?.recordId) {
    await client.sendMessage(id, eliminarRecordatorio(id, cmdData.recordId));
    return { manejado: true, contextoErrores };
  }

  if (cmdData?.accion === "eliminar_todos_recordatorios") {
    const antes = recordatorios.filter(r => r.id === id).length;
    recordatorios = recordatorios.filter(r => r.id !== id);
    guardarRecordatorios();
    await client.sendMessage(id, antes + " recordatorio(s) eliminado(s).");
    return { manejado: true, contextoErrores };
  }

  if (cmdData?.accion === "eliminar_recordatorios" && cmdData?.recordIds) {
    let eliminados = 0;
    for (const rid of cmdData.recordIds) {
      const res = eliminarRecordatorio(id, rid);
      if (res.includes("eliminado")) eliminados++;
    }
    await client.sendMessage(id, eliminados + " recordatorio(s) eliminado(s).");
    return { manejado: true, contextoErrores };
  }

  // ── Accion: sandbox ──────────────────────────────────────────
  if (cmdData?.accion === "sandbox" && cmdData?.codigo) {
    const seguridad = validarSeguridad(cmdData.codigo);
    if (!seguridad.seguro) {
      await client.sendMessage(id, "Codigo rechazado por seguridad: " + seguridad.razon);
      return { manejado: true, contextoErrores };
    }
    const resultado = await probarModulo(cmdData.codigo, cmdData.descripcion || "experimento");
    await client.sendMessage(id, resultado.exito
      ? "Experimento exitoso. Si quieres usarlo dime que lo apruebe."
      : "El experimento fallo: " + resultado.error);
    return { manejado: true, contextoErrores };
  }

  if (cmdData?.accion === "ver_sandbox") {
    const exps = listarExperimentos().slice(0, 5);
    if (exps.length === 0) { await client.sendMessage(id, "No hay experimentos aun."); return { manejado: true, contextoErrores }; }
    const lista = exps.map((e,i) => (i+1) + ". " + e.descripcion + " - " + (e.exito ? "exitoso" : "fallido")).join("\n");
    await client.sendMessage(id, "Experimentos recientes:\n" + lista);
    return { manejado: true, contextoErrores };
  }

  if (cmdData?.accion === "aprobar_sandbox") {
    const res = aprobarModulo(cmdData.origen, cmdData.destino);
    await client.sendMessage(id, res.ok ? res.mensaje : res.error);
    if (res.ok) await cargarModulosExistentes();
    return { manejado: true, contextoErrores };
  }

  // ── Accion: imagen ───────────────────────────────────────────
  if (cmdData?.accion === "imagen" && cmdData?.prompt) {
    await client.sendMessage(id, "Generando imagen, espera un momento...");
    const imagePath = await generarImagen(cmdData.prompt);
    if (!imagePath) { await client.sendMessage(id, "No pude generar la imagen."); return { manejado: true, contextoErrores }; }
    const fileData = fs.readFileSync(imagePath);
    const media = new MessageMedia("image/jpeg", fileData.toString("base64"), "imagen.jpg");
    await client.sendMessage(id, media, { caption: "Aqui esta tu imagen!" });
    fs.unlinkSync(imagePath);
    state.ultimaImagen.set(id, cmdData.prompt);
    agregarAlHistorial(id, "user", userMessage);
    agregarAlHistorial(id, "assistant", "Genere la imagen: " + cmdData.prompt);
    return { manejado: true, contextoErrores };
  }

  // ── Accion: buscar web ───────────────────────────────────────
  if (cmdData?.accion === "buscar" && cmdData?.query) {
    registrarUsoFuncion("busqueda");
    await client.sendMessage(id, "Buscando informacion...");
    const resultados = await buscarWeb(cmdData.query);
    if (!resultados) { await client.sendMessage(id, "No encontre resultados."); return { manejado: true, contextoErrores }; }
    const respuestaFinal = await preguntarGemini(
      id,
      "RESULTADOS DE BUSQUEDA para: " + cmdData.query + "\n\n" + resultados + "\n\nResponde al usuario en espanol sobre: " + userMessage,
      "Responde en texto natural en espanol. NO uses JSON."
    );
    agregarAlHistorial(id, "user", userMessage);
    agregarAlHistorial(id, "assistant", respuestaFinal || resultados);
    for (const part of splitText(respuestaFinal || resultados)) {
      await client.sendMessage(id, part);
    }
    return { manejado: true, contextoErrores };
  }

  // ── Ejecucion de comando shell ───────────────────────────────
  if (esComando && cmdData?.cmd) {
    const cmdExpandido = cmdData.cmd.replace(/\\n/g, ' ');
    const comandoPeligroso = /apt-get|apt |pip install|pip3 install|python.*-m pip|npm install|while true|for.*;;|shutdown|halt|poweroff|reboot/i.test(cmdExpandido);
    const comandoDestructivo = /rm -rf|mkfs|dd |useradd|userdel|passwd/i.test(cmdData.cmd);

    if (comandoDestructivo) {
      await client.sendMessage(id, "⛔ Comando destructivo bloqueado: " + cmdData.cmd.slice(0, 80));
      return { manejado: true, contextoErrores };
    }
    if (comandoPeligroso) {
      if (!esAdmin) {
        await client.sendMessage(id, "⛔ Solo el admin puede ejecutar comandos de instalacion.");
        return { manejado: true, contextoErrores };
      }
      state.pendientesAutorizacion.set(id, { cmd: cmdData.cmd, timestamp: Date.now() });
      await client.sendMessage(id, "⛔ Este comando requiere autorización del administrador.");
      return { manejado: true, contextoErrores };
    }
    if (!esAutorizado(id)) {
      await client.sendMessage(id, "No tengo permiso para ejecutar ese tipo de operacion con tu cuenta.");
      return { manejado: true, contextoErrores };
    }

    let comandoFinal = cmdData.cmd.trim();
    if (/nmap.*192\.168\.|nmap.*sn.*\/24/.test(comandoFinal)) comandoFinal = "arp -a";
    comandoFinal = comandoFinal.replace(/`/g, "").trim();
    comandoFinal = comandoFinal.split("\n")[0].trim();
    comandoFinal = comandoFinal.replace(/(rm|ls|cp|mv)\s+(\/[^\s'"]+(?:[\s#\[\]🇺🇸][^\s'"]*)+)/g, (m, cmd, ruta) => cmd + " '" + ruta + "'");
    comandoFinal = "DISPLAY=:99 " + comandoFinal;

    const timeoutMs = /bluetoothctl/.test(comandoFinal) ? 10000 : 300000;
    registrarUsoFuncion("comando");

    const comandoLento = /find \/|apt |pip |npm |wget |ffmpeg|yt-dlp/i.test(comandoFinal);
    if (comandoLento) {
      await client.sendMessage(id, "Este proceso puede tardar unos minutos, te aviso cuando este listo.");
    }

    try {
      const { stdout, stderr } = await execAsync(comandoFinal, { timeout: timeoutMs });
      let salida = (stdout || stderr || "").trim();
      console.log("OK: " + (salida.slice(0, 100) || "(sin salida)"));

      const lineas = salida.split("\n").filter(l => l.trim().startsWith("/"));
      if (lineas.length > 0) {
        state.contextoListas.set(id, lineas);
        console.log("Lista guardada para " + id + ": " + lineas.length + " items");
      }

      if (comandoFinal.trim() === "arp -a" && salida) {
        const ls = salida.split("\n").filter(Boolean);
        let msg = "📡 *Dispositivos en tu red:*\n\n";
        ls.forEach((l, i) => {
          const m = l.match(/^(\S+)\s+\(([^)]+)\)\s+at\s+(\S+)/);
          if (m) {
            const nombre = m[1].replace(".lan", "").replace("?", "Desconocido");
            msg += (i+1) + ". 📱 *" + nombre + "*\n   IP: " + m[2] + "\n   MAC: " + m[3] + "\n\n";
          }
        });
        msg += "Total: " + ls.length + " dispositivos";
        await client.sendMessage(id, msg);
        agregarAlHistorial(id, "user", userMessage);
        agregarAlHistorial(id, "assistant", msg);
        return { manejado: true, contextoErrores };
      }

      let respuestaFinal;
      if (salida.length === 0) {
        respuestaFinal = "✅ Comando ejecutado correctamente (sin salida).";
      } else if (salida.length <= 800) {
        respuestaFinal = salida;
      } else {
        const listaGuardada = state.contextoListas.get(id);
        const contextoArchivos = listaGuardada && listaGuardada.length > 0
          ? "\nLista actual de archivos (USAR ESTOS NOMBRES EXACTOS):\n" + listaGuardada.map((f,i) => (i+1)+". "+f).join("\n")
          : "";
        respuestaFinal = await preguntarGemini(
          id,
          "RESULTADO REAL DEL SISTEMA (NO INVENTES NADA):\n" + salida.slice(0, 800) + "\n\nResume de forma clara en español. Si hay listas, inclúyelas TODAS.",
          "Eres un formateador de resultados. NUNCA inventes datos. Responde SOLO en texto natural en español." + contextoArchivos
        );
      }

      agregarAlHistorial(id, "user", userMessage);
      agregarAlHistorial(id, "assistant", respuestaFinal || salida.slice(0, 500));
      registrarExito(userMessage.slice(0, 60), comandoFinal);
      if (comandoLento) await client.sendMessage(id, "Listo! Aqui tienes el resultado:");
      for (const part of splitText(respuestaFinal || salida)) {
        await client.sendMessage(id, part);
      }
      return { manejado: true, contextoErrores };

    } catch(err) {
      console.error("Error ejecutando: " + err.message);
      const errorCorto = err.message.slice(0, 200);
      registrarFalloComando(userMessage.slice(0, 60), comandoFinal, errorCorto);
      contextoErrores = `Intento ${intentos} FALLIDO. Comando: "${comandoFinal}". Error: "${errorCorto}". Genera un comando COMPLETAMENTE DIFERENTE.`;
      console.log("Gemini corrigiendo intento " + intentos + "/" + MAX_INTENTOS);
      return { manejado: false, contextoErrores };
    }
  }

  // ── Ejecucion de comando shell ───────────────────────────────
  if (esComando && cmdData?.cmd) {
    const cmdExpandido = cmdData.cmd.replace(/\\n/g, ' ');
    const comandoPeligroso = /apt-get|apt |pip install|pip3 install|python.*-m pip|npm install|while true|for.*;;|shutdown|halt|poweroff|reboot/i.test(cmdExpandido);
    const comandoDestructivo = /rm -rf|mkfs|dd |useradd|userdel|passwd/i.test(cmdData.cmd);

    if (comandoDestructivo) {
      await client.sendMessage(id, "⛔ Comando destructivo bloqueado: " + cmdData.cmd.slice(0, 80));
      return { manejado: true, contextoErrores };
    }
    if (comandoPeligroso) {
      if (!esAdmin) {
        await client.sendMessage(id, "⛔ Solo el admin puede ejecutar comandos de instalacion.");
        return { manejado: true, contextoErrores };
      }
      state.pendientesAutorizacion.set(id, { cmd: cmdData.cmd, timestamp: Date.now() });
      await client.sendMessage(id, "⛔ Este comando requiere autorización del administrador.");
      return { manejado: true, contextoErrores };
    }
    if (!esAutorizado(id)) {
      await client.sendMessage(id, "No tengo permiso para ejecutar ese tipo de operacion con tu cuenta.");
      return { manejado: true, contextoErrores };
    }

    let comandoFinal = cmdData.cmd.trim();
    if (/nmap.*192\.168\.|nmap.*sn.*\/24/.test(comandoFinal)) comandoFinal = "arp -a";
    comandoFinal = comandoFinal.replace(/`/g, "").trim();
    comandoFinal = comandoFinal.split("\n")[0].trim();
    comandoFinal = comandoFinal.replace(/(rm|ls|cp|mv)\s+(\/[^\s'"]+(?:[\s#\[\]🇺🇸][^\s'"]*)+)/g, (m, cmd, ruta) => cmd + " '" + ruta + "'");
    comandoFinal = "DISPLAY=:99 " + comandoFinal;

    const timeoutMs = /bluetoothctl/.test(comandoFinal) ? 10000 : 300000;
    registrarUsoFuncion("comando");

    const comandoLento = /find \/|apt |pip |npm |wget |ffmpeg|yt-dlp/i.test(comandoFinal);
    if (comandoLento) {
      await client.sendMessage(id, "Este proceso puede tardar unos minutos, te aviso cuando este listo.");
    }

    try {
      const { stdout, stderr } = await execAsync(comandoFinal, { timeout: timeoutMs });
      let salida = (stdout || stderr || "").trim();
      console.log("OK: " + (salida.slice(0, 100) || "(sin salida)"));

      const lineas = salida.split("\n").filter(l => l.trim().startsWith("/"));
      if (lineas.length > 0) {
        state.contextoListas.set(id, lineas);
        console.log("Lista guardada para " + id + ": " + lineas.length + " items");
      }

      if (comandoFinal.trim() === "arp -a" && salida) {
        const ls = salida.split("\n").filter(Boolean);
        let msg = "📡 *Dispositivos en tu red:*\n\n";
        ls.forEach((l, i) => {
          const m = l.match(/^(\S+)\s+\(([^)]+)\)\s+at\s+(\S+)/);
          if (m) {
            const nombre = m[1].replace(".lan", "").replace("?", "Desconocido");
            msg += (i+1) + ". 📱 *" + nombre + "*\n   IP: " + m[2] + "\n   MAC: " + m[3] + "\n\n";
          }
        });
        msg += "Total: " + ls.length + " dispositivos";
        await client.sendMessage(id, msg);
        agregarAlHistorial(id, "user", userMessage);
        agregarAlHistorial(id, "assistant", msg);
        return { manejado: true, contextoErrores };
      }

      let respuestaFinal;
      if (salida.length === 0) {
        respuestaFinal = "✅ Comando ejecutado correctamente (sin salida).";
      } else if (salida.length <= 800) {
        respuestaFinal = salida;
      } else {
        const listaGuardada = state.contextoListas.get(id);
        const contextoArchivos = listaGuardada && listaGuardada.length > 0
          ? "\nLista actual de archivos (USAR ESTOS NOMBRES EXACTOS):\n" + listaGuardada.map((f,i) => (i+1)+". "+f).join("\n")
          : "";
        respuestaFinal = await preguntarGemini(
          id,
          "RESULTADO REAL DEL SISTEMA (NO INVENTES NADA):\n" + salida.slice(0, 800) + "\n\nResume de forma clara en español. Si hay listas, inclúyelas TODAS.",
          "Eres un formateador de resultados. NUNCA inventes datos. Responde SOLO en texto natural en español." + contextoArchivos
        );
      }

      agregarAlHistorial(id, "user", userMessage);
      agregarAlHistorial(id, "assistant", respuestaFinal || salida.slice(0, 500));
      registrarExito(userMessage.slice(0, 60), comandoFinal);
      if (comandoLento) await client.sendMessage(id, "Listo! Aqui tienes el resultado:");
      for (const part of splitText(respuestaFinal || salida)) {
        await client.sendMessage(id, part);
      }
      return { manejado: true, contextoErrores };

    } catch(err) {
      console.error("Error ejecutando: " + err.message);
      const errorCorto = err.message.slice(0, 200);
      registrarFalloComando(userMessage.slice(0, 60), comandoFinal, errorCorto);
      contextoErrores = `Intento ${intentos} FALLIDO. Comando: "${comandoFinal}". Error: "${errorCorto}". Genera un comando COMPLETAMENTE DIFERENTE.`;
      console.log("Gemini corrigiendo intento " + intentos + "/" + MAX_INTENTOS);
      return { manejado: false, contextoErrores };
    }
  }

  // ── Respuesta conversacional normal ─────────────────────────
  const pidioImagen = /imagen|foto|ilustracion|dibujo|arte|genera|crea|hazla|ponle|cambia|modifica|hazlo|realista|dibuja|pinta/i.test(userMessage) || state.ultimaImagen.has(id);
  const geminiDescribeImagen = !respuestaGemini.includes('"accion"') && (
    /^(genere|genera|generé|aqui|here|imagen|a |an |the |photorealistic|hyperrealistic)/i.test(respuestaGemini.trim()) ||
    respuestaGemini.toLowerCase().includes("imagen") ||
    respuestaGemini.toLowerCase().includes("image")
  );
  if (pidioImagen && geminiDescribeImagen) {
    const promptImagen = respuestaGemini.replace(/^(Genere la imagen:|Genera la imagen:|Generé la imagen:|Image:|Imagen:)\s*/i, "").trim();
    console.log("Gemini dio texto de imagen, convirtiendo a accion: " + promptImagen.slice(0, 80));
    await client.sendMessage(id, "Generando imagen, espera un momento...");
    const imagePath = await generarImagen(promptImagen);
    if (!imagePath) { await client.sendMessage(id, "No pude generar la imagen."); return { manejado: true, contextoErrores }; }
    const fileData = fs.readFileSync(imagePath);
    const media = new MessageMedia("image/jpeg", fileData.toString("base64"), "imagen.jpg");
    await client.sendMessage(id, media, { caption: "Aqui esta tu imagen!" });
    fs.unlinkSync(imagePath);
    state.ultimaImagen.set(id, promptImagen);
    agregarAlHistorial(id, "user", userMessage);
    agregarAlHistorial(id, "assistant", "Genere la imagen: " + promptImagen);
    actualizarNarrativa(id, "Generó imagen: " + promptImagen.slice(0, 60));
    return { manejado: true, contextoErrores };
  }

  const noPuede = /NO_PUEDO:/i.test(respuestaGemini);
  if (noPuede && esAutorizado(id)) {
    console.log("Gemini dice que no puede - intentando auto-evolucion...");
    const moduloDinamico = await intentarConModulosDinamicos(userMessage, client, id);
    if (moduloDinamico) {
      await client.sendMessage(id, moduloDinamico);
    } else {
      await crearNuevoModulo(userMessage, 'Gemini no pudo manejar esta solicitud', client, id);
    }
    return { manejado: true, contextoErrores };
  }

  agregarAlHistorial(id, "user", userMessage);
  agregarAlHistorial(id, "assistant", respuestaGemini);
  actualizarNarrativa(id, "Usuario: " + userMessage.slice(0, 60) + " → BMO: " + respuestaGemini.slice(0, 60));
  procesarInteraccion(userMessage, true);
  for (const part of splitText(respuestaGemini)) {
    await client.sendMessage(id, part);
  }
  return { manejado: true, contextoErrores };
}

/**
 * Corrector Mistral — se llama cuando se agotan todos los intentos del while.
 */
export async function corregirConMistral(id, userMessage, client) {
  try {
    const { vigilarLogs } = await import('../code_corrector.js');
    const analisis = await vigilarLogs([userMessage]);
    if (analisis && analisis.critico) {
      await client.sendMessage(id, "Detecte un problema: " + analisis.descripcion + ". Intentando corregir...");
      await agenteSelfCode(client, id, analisis.solucion);
      return true;
    }
  } catch(e) {
    console.log("Error corrector:", e.message);
  }
  return false;
}

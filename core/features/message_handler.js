import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;





import { descargarMedia } from "./download_commands.js";
import { transcribirAudio } from "./utilidades.js";
import { agenteSelfCode } from "./autocorreccion.js";
import { manejarEstadoSistema, manejarSelfImprovement } from "./estado_sistema.js";
import { ROOT_DIR, CONFIG } from '../../config/bmo.config.js';
import { dispatchPreLoop } from './command_dispatcher.js';



const GEMINI_API_KEY = process.env.GEMINI_API_KEY;



const execAsync = promisify(exec);
const GEMINI_MODEL = process.env.BMO_GEMINI_MODEL || 'gemini-2.5-flash';
const TEMP_DIR = path.join(ROOT_DIR, 'temp_files');
const ARCHIVOS_DIR = path.join(ROOT_DIR, 'archivos');
const URL_REGEX = /https?:\/\/[^\s]+/i;
const esAutorizado = (id) => CONFIG.admin_ids.includes(id.replace('@lid','').replace('@c.us','')) || id === CONFIG.admin_wa;
const obtenerModulo = (_) => null;
const esUsuarioNuevo = (_) => false;
const registrarUsuario = () => {};
const agregarAlHistorial = () => {};
const detectarEnlace = (text) => { const m = text.match(URL_REGEX); return m ? m[0] : null; };
import { getSession, setSession } from '../utils_bot.js';
const state = {
    esperandoRespuesta: new Map(),
    flujoArchivo: new Map(),
    pendienteConfirmacion: new Map(),
    contextoListas: new Map(),
};

export async function handleMessage(msg, id, client, _procesarConIAWrapper) {
  const text = (msg.body || "").trim();
  const autorizado = esAutorizado(id);
  console.log("[" + id + "]: " + text);

  // --- Propuesta evolutiva pendiente: interceptar sí/no antes de cualquier otro flujo ---
  try {
    const { manejarRespuestaPropuesta } = await import('../../core/features/evoluciones_manager.js');
    const { agenteSelfCode } = await import('./autocorreccion.js');
    const manejado = await manejarRespuestaPropuesta(client, id, text, { agenteSelfCode });
    if (manejado) return;
  } catch(e) { console.log('[EVOLUCION] Error interceptor:', e.message); }

  // --- Comandos directos BMO (memory, diario, agents, etc.) ---
  try {
    const dispatched = await dispatchPreLoop(id, text, client);
    if (dispatched?.handled) return;
  } catch(e) { console.log('[DISPATCH] Error:', e.message); }

  // --- Usuario nuevo: presentacion y preguntar nombre ---
  if (esUsuarioNuevo(id) && !state.esperandoRespuesta.has(id)) {
    if (!esperandoNombre) var esperandoNombre = new Map();
    
    if (!global.esperandoNombre) global.esperandoNombre = new Map();

    if (global.esperandoNombre.has(id)) {
      // El usuario respondio con su nombre
      const nombre = text.trim();
      registrarUsuario(id, nombre);
      global.esperandoNombre.delete(id);

      const esAdmin = esAutorizado(id);
      let bienvenida = `Hola ${nombre}! Soy BMO, tu asistente personal en WhatsApp.

`;

      if (esAdmin) {
        bienvenida += `Tienes acceso de *Administrador*. Puedo hacer todo por ti:

`;
        bienvenida += `- Conversar e investigar cualquier tema
`;
        bienvenida += `- Convertir archivos (imagen, PDF, Word)
`;
        bienvenida += `- Descargar videos y audios de YouTube, TikTok, Instagram, Facebook
`;
        bienvenida += `- Recordatorios inteligentes
`;
        bienvenida += `- Controlar la Raspberry Pi (instalar, borrar, comandos)
`;
        bienvenida += `- Ejecutar comandos directos con !

`;
        bienvenida += `En que te puedo ayudar?`;
      } else {
        bienvenida += `Esto es lo que puedo hacer por ti:

`;
        bienvenida += `- Conversar e investigar cualquier tema
`;
        bienvenida += `- Convertir archivos (imagen a PDF, Word a PDF, PDF a Word)
`;
        bienvenida += `- Descargar videos y audios de YouTube, TikTok, Instagram, Facebook
`;
        bienvenida += `- Recordatorios inteligentes

`;
        bienvenida += `En que te puedo ayudar?`;
      }

      await client.sendMessage(id, bienvenida);
      return;
    } else {
      // Primera vez que escribe, pedir nombre
      global.esperandoNombre.set(id, true);
      await client.sendMessage(id, "Hola! Soy BMO, tu asistente personal. Antes de empezar, como te llamas?");
      return;
    }
  }



  // --- Respuesta del buscador de descargas ---
  const modBusqueda = obtenerModulo('buscador_descargas');
  if (modBusqueda?.manejarRespuesta) {
    const manejado = await modBusqueda.manejarRespuesta({ client, id, mensaje: text });
    if (manejado) return;
  }

  // --- Trigger: buscar y descargar por nombre (sin link) ---
  if (modBusqueda?.ejecutar && /descarg[ae]me?|b[aá]jame?|ponme\s+la\s+(canci[oó]n|m[uú]sica)|quiero\s+(la\s+)?(canci[oó]n|el\s+video|la\s+m[uú]sica)/i.test(text) && !URL_REGEX.test(text)) {
    await modBusqueda.ejecutar({ client, id, mensaje: text });
    return;
  }

  // --- Respuesta pendiente audio/video ---
  console.log('[MH] esperandoRespuesta.has=' + state.esperandoRespuesta.has(id) + ' size=' + state.esperandoRespuesta.size);
  if (state.esperandoRespuesta.has(id)) {
    const pendiente = state.esperandoRespuesta.get(id);
    const r = text.toLowerCase().trim();

    // Flujo: lista YouTube → usuario elige número
    if (pendiente.tipo === 'youtube_lista') {
      const numMatch = text.match(/\b([1-5])\b/);
      if (numMatch) {
        const idx = parseInt(numMatch[1]) - 1;
        const item = pendiente.resultados[Math.min(idx, pendiente.resultados.length - 1)];
        state.esperandoRespuesta.delete(id);
        // Si ya dijo audio o video junto con el número
        if (/audio|mp3/i.test(text)) {
          await descargarMedia(client, id, item.url, "audio");
        } else if (/video|mp4/i.test(text)) {
          await descargarMedia(client, id, item.url, "video");
        } else {
          // Pedir formato
          state.esperandoRespuesta.set(id, { tipo: 'youtube_formato', url: item.url, titulo: item.titulo });
          await client.sendMessage(id, `*${item.titulo}*\n\n¿Cómo lo quieres?\n\n1️⃣ *audio* → MP3\n2️⃣ *video* → MP4`);
        }
      } else {
        await client.sendMessage(id, "Responde con el número del resultado (1-5).");
      }
      return;
    }

    // Flujo: formato audio/video
    if (pendiente.tipo === 'youtube_formato') {
      if (/audio|mp3|^1$/i.test(r)) {
        state.esperandoRespuesta.delete(id);
        await descargarMedia(client, id, pendiente.url, "audio");
      } else if (/v[ií]deos?|mp4|^2$/i.test(r)) {
        state.esperandoRespuesta.delete(id);
        await descargarMedia(client, id, pendiente.url, "video");
      } else {
        await client.sendMessage(id, "Responde *audio* o *video*.");
      }
      return;
    }

    // Flujo original: descarga directa de enlace
    const { url } = pendiente;
    state.esperandoRespuesta.delete(id);
    if (r.includes("audio") || r === "1") {
      await descargarMedia(client, id, url, "audio");
    } else if (r.includes("video") || r === "2") {
      await descargarMedia(client, id, url, "video");
    } else {
      await client.sendMessage(id, "Responde audio o video para descargar.");
      state.esperandoRespuesta.set(id, { url });
    }
    return;
  }

  // --- Activación BES escrita (sin foto) --- IMEI 15 dígitos + ICCID 8952...
  const lineas = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const tieneIMEI = lineas.some(l => /^\d{15}$/.test(l));
  const tieneICCID = lineas.some(l => /^8952\d{14,16}$/.test(l));
  if (tieneIMEI && tieneICCID) {
    try {
        const { procesarActivacionBESTexto } = await import('../../evoluciones/reporte_bes.js');
        await procesarActivacionBESTexto({ client, id, texto: text });
    } catch(e) {
        await client.sendMessage(id, '❌ Error procesando activación: ' + e.message.slice(0,100));
    }
    return;
  }

  // --- Archivos adjuntos ---
  if (msg.hasMedia) {
    const tipoMime = msg.type;

    // Imagen con caption = nombre de modelo → flujo BES
    if (tipoMime === "image" && msg.body && msg.body.trim().length > 0) {
      const captionImg = msg.body.trim();
      const esBES = /samsung|iphone|motorola|chip|xiaomi|huawei|lg|nokia|redmi|oppo|tecno|itel/i.test(captionImg);
      if (esBES) {
        try {
          const media = await msg.downloadMedia();
          const { procesarImagenBES } = await import('../../evoluciones/reporte_bes.js').catch(() => ({ procesarImagenBES: null }));
          if (procesarImagenBES) await procesarImagenBES({ client, id, mediaData: media.data, mimetype: media.mimetype, caption: captionImg, geminiKey: GEMINI_API_KEY, geminiModel: GEMINI_MODEL });
        } catch(e) {
          await client.sendMessage(id, "❌ Error procesando activación: " + e.message.slice(0,80));
        }
        return;
      }
    }

    // Audio de voz — transcribir directamente sin preguntar
    if (tipoMime === "ptt" || tipoMime === "audio") {
      await client.sendMessage(id, "Escuchando tu audio...");
      try {
        const media = await msg.downloadMedia();
        const ext = media.mimetype.includes("ogg") ? "ogg" : "mp3";
        const audioPath = path.join(TEMP_DIR, "audio_" + Date.now() + "." + ext);
        fs.writeFileSync(audioPath, Buffer.from(media.data, "base64"));
        const texto = await transcribirAudio(audioPath);
        fs.unlinkSync(audioPath);
        if (!texto) { await client.sendMessage(id, "No pude entender el audio."); return; }
        console.log("Audio transcrito: " + texto);
        await client.sendMessage(id, "Escuche: " + texto);
        await _procesarConIAWrapper(id, texto, client);
      } catch (err) {
        await client.sendMessage(id, "Error al procesar el audio.");
      }
      return;
    }

    // Todos los demás archivos: mostrar opciones interactivas
    try {
      const media = await msg.downloadMedia();
      if (!media) { await client.sendMessage(id, "No pude leer el archivo."); return; }

      const ext = extDesdemime(media.mimetype);
      const { tipo, opciones } = opcionesParaTipo(media.mimetype, ext);

      // Nombre del archivo si está disponible
      const nombreOriginal = msg._data?.filename || msg.body?.trim() || `archivo.${ext}`;

      // Guardar en el flujo para procesar la respuesta
      state.flujoArchivo.set(id, {
        paso: "eligiendo_accion",
        msg,
        mediaCache: { data: media.data, mimetype: media.mimetype },
        nombre: nombreOriginal,
        ext,
        tipo
      });

      const caption = msg.body || msg.caption || "";
      let mensaje = `📎 *${tipo} recibido*`;
      if (nombreOriginal && nombreOriginal !== `archivo.${ext}`) {
        mensaje += `: ${nombreOriginal}`;
      }
      mensaje += `\n\n¿Qué quieres hacer?\n\n`;
      mensaje += opciones.join("\n");
      mensaje += "\n\nResponde con el número de tu opción.";

      // Si el caption ya dice "guarda/sube/copia", ir directo a carpetas
      if (/guarda|sube|copia|upload|save/i.test(caption)) {
        state.flujoArchivo.set(id, { ...flujoArchivo.get(id), paso: "eligiendo_carpeta" });
        const { carpetas } = listarCarpetasUsuario(id);
        let msg2 = `📎 *${tipo} recibido*\n\n📁 *¿En qué carpeta quieres guardarlo?*\n\n`;
        if (carpetas.length === 0) msg2 += "No tienes carpetas todavía.\n\n";
        else carpetas.forEach((c, i) => { msg2 += `${i + 1}️⃣ ${c}\n`; });
        msg2 += `\n${carpetas.length + 1}️⃣ Crear carpeta nueva\n❌ Cancelar`;
        await client.sendMessage(id, msg2);
      } else {
        await client.sendMessage(id, mensaje);
      }
    } catch(err) {
      console.error("Error procesando adjunto:", err.message);
      await client.sendMessage(id, "No pude procesar el archivo.");
    }
    return;
  }

  if (!text) return;

  // --- Flujo interactivo de archivo (responde a opciones de archivo recibido) ---
  if (state.flujoArchivo.has(id)) {
    const manejado = await manejarRespuestaFlujoArchivo(client, id, text);
    if (manejado) return;
  }

  // ── Confirmaciones pendientes (sí/no para acciones destructivas) ──
  if (state.pendienteConfirmacion.has(id)) {
    const accion = state.pendienteConfirmacion.get(id);
    const r = text.trim().toLowerCase();
    if (/^(sí|si|yes|s|confirmar|confirma|ok|dale|adelante)$/i.test(r)) {
      state.pendienteConfirmacion.delete(id);
      if (accion.tipo === "borrar_duplicados") {
        let borrados = 0;
        const errores = [];
        for (const dup of accion.duplicados) {
          try { fs.unlinkSync(dup.ruta); borrados++; }
          catch(e) { errores.push(dup.nombre); }
        }
        // Actualizar state.contextoListas con la lista limpia
        const userDir = path.join(ARCHIVOS_DIR, id.replace(/[^a-z0-9]/gi, "_"));
        const archivos = fs.readdirSync(path.join(userDir, accion.carpeta));
        state.contextoListas.set(id, {
          carpeta: accion.carpeta,
          archivos: archivos.map(a => ({ nombre: a, ruta: path.join(userDir, accion.carpeta, a) }))
        });
        let msg = `✅ Borré ${borrados} archivo${borrados !== 1 ? "s" : ""} duplicado${borrados !== 1 ? "s" : ""}.\n\n`;
        msg += `📁 *${accion.carpeta}* ahora tiene ${archivos.length} archivo${archivos.length !== 1 ? "s" : ""}:\n\n`;
        archivos.forEach((a, i) => {
          const s = fs.statSync(path.join(userDir, accion.carpeta, a));
          msg += `${i+1}. ${a} (${(s.size/1024).toFixed(0)} KB)\n`;
        });
        if (errores.length > 0) msg += `\n⚠️ No pude borrar: ${errores.join(", ")}`;
        await client.sendMessage(id, msg);
      }
    } else if (/^(no|cancel|cancelar|nope)$/i.test(r)) {
      state.pendienteConfirmacion.delete(id);
      await client.sendMessage(id, "Cancelado. No se borró nada.");
    } else {
      await client.sendMessage(id, "Responde *sí* para confirmar o *no* para cancelar.");
    }
    return;
  }

  // ── CAPA DETERMINISTA: operaciones de filesystem NUNCA pasan por Gemini ──

  // ── YouTube: búsqueda de videos/canciones ────────────────────
  if (/busca.*youtube|en youtube|youtube.*busca|búscame.*canción|buscame.*cancion|búscame.*video|buscame.*video|pon.*canción|pon.*cancion|busca.*de\s+\w+.*en\s+youtube/i.test(text) ||
      /búscame|buscame/.test(text) && /canción|cancion|video|musica|música|tema|song/.test(text)) {
    // Extraer la query limpiando el comando
    const query = text
      .replace(/búscame|buscame|busca|en youtube|youtube|la canción|la cancion|el video|el tema|pon|ponme/gi, "")
      .trim();
    if (query.length < 2) {
      await client.sendMessage(id, "¿Qué canción o video quieres que busque en YouTube?");
      return;
    }
    await client.sendMessage(id, `🔍 Buscando *${query}* en YouTube...`);
    // Verificar/instalar yt-dlp
    const resultados = await (async () => {
      try {
        const { execSync } = await import('child_process');
        try { execSync('which yt-dlp', { stdio: 'ignore' }); }
        catch {
          await client.sendMessage(id, '⏳ Instalando yt-dlp...');
          execSync('pip3 install yt-dlp --break-system-packages -q', { timeout: 60000 });
        }
        const titles = execSync(
          `yt-dlp "ytsearch5:${query.replace(/"/g, '')}" --flat-playlist --print "%(title)s" --no-warnings 2>/dev/null`,
          { timeout: 30000, encoding: 'utf8' }
        ).trim().split('\n').filter(Boolean);
        const urls = execSync(
          `yt-dlp "ytsearch5:${query.replace(/"/g, '')}" --flat-playlist --print "%(webpage_url)s" --no-warnings 2>/dev/null`,
          { timeout: 30000, encoding: 'utf8' }
        ).trim().split('\n').filter(Boolean);
        if (!urls.length) return [];
        return urls.map((url, i) => ({ titulo: (titles[i]?.trim() || 'Sin título').replace(/\s*\|.*$/, ''), url: url.trim() })).filter(r => r.url.startsWith('http'));
      } catch(e) {
        console.log('[YOUTUBE] Error búsqueda:', e.message);
        return [];
      }
    })();
    if (resultados.length === 0) {
      await client.sendMessage(id, `No encontré resultados para *${query}* en YouTube.`);
      return;
    }
    let msg = `🎵 *Resultados para "${query}":*\n\n`;
    resultados.forEach((r, i) => {
      msg += `${i + 1}. ${r.titulo}\n${r.url}\n\n`;
    });
    msg += `\nResponde *descarga 1* (o el número) + *audio* o *video*\nEjemplo: _descarga 1 audio_ o _descarga 2 video_`;
    await client.sendMessage(id, msg);
    // Guardar en sesión para descarga posterior
    setSession(id, { tema: "youtube", resultados, query });
    agregarAlHistorial(id, "user", text);
    agregarAlHistorial(id, "assistant", `Resultados YouTube para: ${query}`);
    return;
  }

  // Descarga desde resultado de búsqueda YouTube
  if (/descarga[r]?\s*(el\s*)?(\d+)|b[aá]jame\s*(el\s*)?(\d+)/i.test(text)) {
    const ses = getSession(id);
    if (ses?.tema === "youtube" && ses.resultados?.length > 0) {
      const numMatch = text.match(/\b(\d+)\b/);
      const idx = numMatch ? parseInt(numMatch[1]) - 1 : 0;
      const item = ses.resultados[Math.min(idx, ses.resultados.length - 1)];
      if (item) {
        state.esperandoRespuesta.set(id, { url: item.url });
        await client.sendMessage(id, `¿Lo quieres como:\n\n1 Audio (mp3)\n2 Video\n\nResponde *audio* o *video*`);
        return;
      }
    }
  }
  // ── Reportar módulo roto al Bridge ───────────────────────────
  if (/no sirve|no funciona|está roto|sigue fallando|no aprendiste|no lo hace bien/i.test(text)) {
    const ses = getSession(id);
    const habilidadMatch = text.match(/(?:el módulo de|el |la )(.+?)(?:\s+no\s+(?:sirve|funciona))/i);
    const habilidad = habilidadMatch?.[1] || ses?.ultimaHabilidad || "modulo_desconocido";
    // No interceptar — continúa al procesamiento normal
  }

  const sesActiva = getSession(id);
  const esContextoBackup = sesActiva?.tema === "backups";
  if (/backup|respaldo|backups|respaldos/i.test(text) ||
      (esContextoBackup && /lista|todos|cuáles|cuantos|cuántos|muestra|nuevo|crea|haz/i.test(text))) {

    // Crear backup
    if (/crea|haz|has|hacer|nuevo|genera/i.test(text)) {
      if (!esAutorizado(id)) { await client.sendMessage(id, "Solo el admin puede crear backups."); return; }
      try {
        const fecha = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const archivosBackup = [
          { src: `${ROOT_DIR}/index.js`, dest: `index.js.manual_${fecha}` },
          { src: `${ROOT_DIR}/orquestador.js`, dest: `orquestador.js.manual_${fecha}` },
        ].filter(f => fs.existsSync(f.src));
        for (const f of archivosBackup) {
          fs.copyFileSync(f.src, path.join(`${ROOT_DIR}/backups`, f.dest));
        }
        const msg = `✅ Backup creado (${fecha}):\n` + archivosBackup.map(f => `  • ${f.dest}`).join("\n");
        await client.sendMessage(id, msg);
        setSession(id, { tema: "backups", dir: `${ROOT_DIR}/backups` });
      } catch(e) {
        await client.sendMessage(id, "❌ Error al crear backup: " + e.message.slice(0, 100));
      }
      return;
    }

    // Listar backups — filesystem real, formato legible
    const backupDir = `${ROOT_DIR}/backups`
    if (!fs.existsSync(backupDir)) {
      await client.sendMessage(id, "No hay backups todavía.");
      return;
    }
    const todos = fs.readdirSync(backupDir)
      .map(f => ({ nombre: f, mtime: fs.statSync(path.join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (todos.length === 0) { await client.sendMessage(id, "No hay backups todavía."); return; }

    // Guardar en sesión y state.contextoListas para poder pedir por número
    setSession(id, { tema: "backups", dir: backupDir });
    state.contextoListas.set(id, {
      carpeta: backupDir,
      archivos: todos.map(f => ({ nombre: f.nombre, ruta: path.join(backupDir, f.nombre) }))
    });

    // Agrupar: index.js, orquestador.js, auto_, manual_
    const manuales = todos.filter(f => f.nombre.includes(".manual_"));
    const autos    = todos.filter(f => f.nombre.includes(".auto_") || f.nombre.includes("index_"));
    const otros    = todos.filter(f => !f.nombre.includes(".manual_") && !f.nombre.includes(".auto_") && !f.nombre.includes("index_"));

    let msg = `📦 *Backups disponibles* (${todos.length} total):\n\n`;
    if (manuales.length > 0) {
      msg += `*Manuales (${manuales.length}):*\n`;
      manuales.slice(0, 5).forEach((f, i) => {
        const d = new Date(f.mtime).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" });
        const kb = (fs.statSync(path.join(backupDir, f.nombre)).size / 1024).toFixed(0);
        msg += `  ${i+1}. ${f.nombre} — ${kb}KB — ${d}\n`;
      });
      if (manuales.length > 5) msg += `  ... y ${manuales.length - 5} más\n`;
    }
    if (autos.length > 0) {
      msg += `\n*Automáticos (${autos.length}):*\n`;
      autos.slice(0, 3).forEach(f => {
        const d = new Date(f.mtime).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" });
        msg += `  • ${f.nombre} — ${d}\n`;
      });
      if (autos.length > 3) msg += `  ... y ${autos.length - 3} más\n`;
    }
    msg += `\nEscribe *crea backup* para hacer uno nuevo.`;
    await client.sendMessage(id, msg);
    return;
  }

  // Borrar duplicados — con confirmación, hash Node puro, sin shell
  if (/borra.*repetidos|elimina.*duplicados|quita.*repetidos|borra.*duplicados/i.test(text)) {
    const ctx = state.contextoListas.get(id);
    const ses = getSession(id);
    const carpeta = ctx?.carpeta || ses?.carpetaActual;
    if (!carpeta || carpeta.includes("/backups")) {
      await client.sendMessage(id, "Primero dime qué carpeta quieres limpiar con: *qué hay en [carpeta]*");
      return;
    }
    const userDir = path.join(ARCHIVOS_DIR, id.replace(/[^a-z0-9]/gi, "_"));
    const { duplicados, unicos } = detectarDuplicados(userDir, carpeta);
    if (duplicados.length === 0) {
      await client.sendMessage(id, `✅ No hay duplicados en *${carpeta}*. Todos los archivos son únicos.`);
      return;
    }
    let msg = `🔍 Encontré *${duplicados.length} archivo${duplicados.length !== 1 ? "s" : ""} duplicado${duplicados.length !== 1 ? "s" : ""}* en *${carpeta}*:\n\n`;
    msg += `*Se conservará:*\n`;
    unicos.filter(u => duplicados.some(d => {
      const hU = hashArchivo(u.ruta); const hD = hashArchivo(d.ruta); return hU === hD;
    })).forEach(u => { msg += `  ✅ ${u.nombre} (más reciente)\n`; });
    msg += `\n*Se borrará:*\n`;
    duplicados.forEach(d => { msg += `  🗑 ${d.nombre}\n`; });
    msg += `\n¿Confirmas? Responde *sí* o *no*`;
    state.pendienteConfirmacion.set(id, { tipo: "borrar_duplicados", duplicados, carpeta });
    await client.sendMessage(id, msg);
    return;
  }
  // Resolver "mándamelo", "el 1", "envíamelo" contra state.contextoListas real
  if (/mándamelo|mandamelo|envíamelo|enviamelo|mándame|mandame|envíame|enviame|el\s+\d+|comparte.*archivo|dame.*archivo/i.test(text)) {
    const ctx = state.contextoListas.get(id);
    if (ctx && ctx.archivos && ctx.archivos.length > 0) {
      const numMatch = text.match(/\b(\d+)\b/);
      const idx = numMatch ? parseInt(numMatch[1]) - 1 : 0;
      const archivoInfo = ctx.archivos[Math.min(idx, ctx.archivos.length - 1)];
      const nombre = archivoInfo.nombre || archivoInfo;
      // Ruta directa desde state.contextoListas (ya es absoluta y verificada)
      const rutaArchivo = archivoInfo.ruta || path.join(ARCHIVOS_DIR, id.replace(/[^a-z0-9]/gi, "_"), ctx.carpeta, nombre);
      if (fs.existsSync(rutaArchivo)) {
        try {
          await client.sendMessage(id, `📤 Enviando *${nombre}*...`);
          const media = MessageMedia.fromFilePath(rutaArchivo);
          await client.sendMessage(id, media, { caption: nombre });
          agregarAlHistorial(id, "user", text);
          agregarAlHistorial(id, "assistant", "Archivo enviado: " + nombre);
        } catch(e) {
          await client.sendMessage(id, "Error al enviar: " + e.message.slice(0, 100));
        }
      } else {
        await client.sendMessage(id, `No encontré *${nombre}*. Actualiza la lista con: *qué hay en ${ctx.carpeta}*`);
      }
      return;
    }
    if (/archivo|pdf|documento|carpeta/i.test(text)) {
      await client.sendMessage(id, "No tengo claro qué archivo quieres. Primero dime: *qué hay en [nombre de carpeta]*");
      return;
    }
  }

    // Goals — gestión directa sin pasar por Gemini
  const goalMatch = text.match(/elimina(?:r)?\s+(?:el\s+)?goal\s+#?(\d+)|borra(?:r)?\s+(?:el\s+)?goal\s+#?(\d+)/i);
  if (goalMatch) {
    const goalId = parseInt(goalMatch[1] || goalMatch[2]);
    const { eliminarGoal } = await import('../../goals/goal_manager.js');
    const ok = eliminarGoal(goalId);
    await client.sendMessage(id, ok ? `✅ Goal #${goalId} eliminado.` : `❌ No encontré el goal #${goalId}.`);
    return;
  }
  if (/lista(?:r)?\s+(?:mis\s+)?goals|ver\s+goals|mis\s+goals/i.test(text)) {
    // listarGoals y formatearGoals ya importados estáticamente
    const goals = listarGoals(id);
    await client.sendMessage(id, formatearGoals(goals));
    return;
  }

  // ── FIN CAPA DETERMINISTA ──────────────────────────────────

  // --- Recordatorios ---
  if (/recu[eé]rdame|mándame|mandame|avísame|avisame|notifícame|notificame|dime en|recuérdame/i.test(text)) {
    await _procesarConIAWrapper(id, text, client);
    return;
  }

  // --- Deteccion de enlaces ---
  const enlace = detectarEnlace(text);
  if (enlace) {
    state.esperandoRespuesta.set(id, { url: enlace });
    await client.sendMessage(id, "Detecte un enlace! Quieres descargar el:\n\n1 Audio (mp3)\n2 Video\n\nResponde audio o video");
    return;
  }

  // --- Comandos directos con ! (solo autorizado) ---
  if (autorizado && text.startsWith("!")) {
    const cmd = text.slice(1).trim();
    try {
      await client.sendMessage(id, "Ejecutando: " + cmd);
      const { stdout, stderr } = await execAsync(cmd, { timeout: 30000 });
      await client.sendMessage(id, (stdout || stderr || "Sin salida.").trim().slice(0, 3000));
    } catch (err) { await client.sendMessage(id, "Error: " + err.message); }
    return;
  }

  // --- Gemini como cerebro principal ---
  
  await _procesarConIAWrapper(id, text, client);


}

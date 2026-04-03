// core/features/download_commands.js
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import { callModel } from '../model_router.js';
import { ROOT_DIR } from '../../config/bmo.config.js';

const execAsync = promisify(exec);

const TEMP_DIR = path.join(ROOT_DIR, "temp_files");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const colaDescargas = [];
let descargaActiva = false;
export const ultimoArchivo = new Map();

async function intentarReparar(client, id, contexto, accionOriginal) {
  console.log("Iniciando autoreparacion en segundo plano...");
  await client.sendMessage(id, "Detecte un problema, voy a intentar repararlo en segundo plano. Te aviso cuando este listo.");
  (async () => {
    try {
      const respuesta = await callModel('rapido',
        "Contexto del error: " + contexto + "\nAccion que fallaba: " + accionOriginal + "\nGenera UN comando bash para solucionar esto. Responde SOLO el comando, sin markdown ni explicaciones."
      );
      let cmd = (respuesta || "").trim();
      cmd = cmd.replace(/`/g, "").split("\n")[0].trim();
      if (!cmd || cmd.length < 5) { await client.sendMessage(id, "No encontre una solucion automatica para este problema."); return; }
      // Validar que no sea un comando peligroso
      if (/rm\s+-rf|mkfs|dd\s+if|shutdown|reboot|format/i.test(cmd)) { console.warn("[REPAIR] Comando peligroso rechazado:", cmd); return; }
      console.log("Reparacion propuesta: " + cmd.slice(0, 100));
      const { stdout, stderr } = await execAsync(cmd, { timeout: 60000 });
      const salida = (stdout || stderr || "completado").trim();
      console.log("Reparacion exitosa: " + salida.slice(0, 100));
      await client.sendMessage(id, "Reparacion completada. Resultado: " + salida.slice(0, 300));
    } catch (err) {
      console.error("Reparacion fallida:", err.message);
      await client.sendMessage(id, "Intente repararlo pero no pude. Error: " + err.message.slice(0, 200));
    }
  })();
}

async function ejecutarDescarga(client, id, url, tipo, usuariosConocidos = {}) {
  await client.sendMessage(id, "Descargando " + tipo + ", esto puede tardar unos segundos...");
  try {
    const outputFijo = path.join(TEMP_DIR, "dl_" + Date.now());
    const cmd = tipo === "audio"
      ? `yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${outputFijo}.%(ext)s" "${url}" 2>&1`
      : `yt-dlp -f "bestvideo[height<=480]+bestaudio/best[height<=480]/best" -o "${outputFijo}.%(ext)s" "${url}" 2>&1`;
    await execAsync(cmd, { timeout: 600000 }).catch(e => { throw new Error(e.stdout || e.stderr || e.message); });

    const tiempoInicio = Date.now() - 180000;
    const archivos = fs.readdirSync(TEMP_DIR)
      .filter(f => (f.startsWith("dl_") || f.endsWith(".mp4") || f.endsWith(".mp3") || f.endsWith(".m4a") || f.endsWith(".webm")))
      .filter(f => fs.statSync(path.join(TEMP_DIR, f)).mtimeMs > tiempoInicio)
      .sort((a, b) => fs.statSync(path.join(TEMP_DIR, b)).mtimeMs - fs.statSync(path.join(TEMP_DIR, a)).mtimeMs);
    console.log("Archivos en temp:", archivos);
    if (archivos.length === 0) { await client.sendMessage(id, "No pude encontrar el archivo descargado."); return; }

    const archivoPath = path.join(TEMP_DIR, archivos[0]);
    const sizeMB = fs.statSync(archivoPath).size / (1024 * 1024);
    if (sizeMB > 64) {
      await client.sendMessage(id, "El archivo pesa " + sizeMB.toFixed(1) + "MB, muy grande para WhatsApp (max 64MB).");
      fs.unlinkSync(archivoPath);
      return;
    }

    let archivoFinal = archivoPath;
    if (tipo === "video") {
      try {
        const { stdout: codecInfo } = await execAsync(`ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${archivoPath}" 2>/dev/null`);
        const codec = codecInfo.trim().toLowerCase();
        console.log("Codec detectado: " + codec);
        if (codec === "h264" || codec === "avc") {
          console.log("Ya es H.264, no necesita conversion.");
          const fileData = fs.readFileSync(archivoPath);
          const media = new MessageMedia("video/mp4", fileData.toString("base64"), path.basename(archivoPath));
          await client.sendMessage(id, media, { caption: "Aqui tienes el video" });
          ultimoArchivo.set(id, { path: archivoPath, tipo: "video", nombre: path.basename(archivoPath) });
          fs.unlinkSync(archivoPath);
          return;
        }
      } catch(e) { console.error("Error silencioso:", e.message); }
    }

    if (tipo === "video") {
      const mp4Path = archivoPath.replace(/\.[^.]+$/, "_conv.mp4");
      console.log("Convirtiendo a H.264...");
      try {
        await execAsync(`ffmpeg -i "${archivoPath}" -vcodec libx264 -preset ultrafast -crf 35 -vf scale=-2:360 -acodec aac -movflags +faststart "${mp4Path}" -y 2>&1`, { timeout: 600000 });
        if (fs.existsSync(mp4Path)) { fs.unlinkSync(archivoPath); archivoFinal = mp4Path; console.log("Conversion exitosa: " + mp4Path); }
      } catch(e) {
        console.error("Error ffmpeg:", e.message.slice(0, 100));
        intentarReparar(client, id,
          "ffmpeg fallo al convertir video a H.264 en Raspberry Pi. Error: " + e.message.slice(0, 200),
          `ffmpeg -i "${archivoPath}" -vcodec libx264 -preset ultrafast -crf 35 -vf scale=-2:360 -acodec aac "${mp4Path}" -y`
        );
        return;
      }
    }

    const sizeFinal = fs.statSync(archivoFinal).size / (1024 * 1024);
    console.log("Enviando archivo: " + archivoFinal + " (" + sizeFinal.toFixed(1) + "MB)");
    const mimeType = archivoFinal.endsWith(".mp3") ? "audio/mpeg" : "video/mp4";

    if (sizeFinal > 50 && tipo === "video") {
      await client.sendMessage(id, "El video pesa " + sizeFinal.toFixed(1) + "MB, lo dividiré en partes...");
      const { stdout: durInfo } = await execAsync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${archivoFinal}" 2>/dev/null`);
      const durTotal = parseFloat(durInfo.trim());
      const partes = Math.ceil(sizeFinal / 50);
      const segDur = Math.floor(durTotal / partes);
      for (let i = 0; i < partes; i++) {
        const startTime = i * segDur;
        const partePath = archivoFinal.replace(/\.mp4$/, "_parte" + (i+1) + ".mp4");
        try {
          await execAsync(`ffmpeg -i "${archivoFinal}" -ss ${startTime} -t ${segDur} -c copy "${partePath}" -y 2>&1`, { timeout: 120000 });
          if (fs.existsSync(partePath)) {
            const parteData = fs.readFileSync(partePath);
            const parteMedia = new MessageMedia("video/mp4", parteData.toString("base64"), path.basename(partePath));
            await client.sendMessage(id, parteMedia, { caption: "Parte " + (i+1) + " de " + partes });
            fs.unlinkSync(partePath);
          }
        } catch(e) { console.error("Error enviando parte " + (i+1) + ":", e.message.slice(0, 100)); }
      }
      fs.unlinkSync(archivoFinal);
      return;
    }

    const fileData = fs.readFileSync(archivoFinal);
    const media = new MessageMedia(mimeType, fileData.toString("base64"), path.basename(archivoFinal));
    await client.sendMessage(id, media, { caption: tipo === "audio" ? "Aqui tienes el audio" : "Aqui tienes el video" });
    ultimoArchivo.set(id, { path: archivoFinal, tipo, nombre: path.basename(archivoFinal) });

    if (tipo === "audio" && archivoFinal.endsWith(".mp3")) {
      try {
        const MUSICA_DIR = `${ROOT_DIR}/musica_biblioteca`
        const DB_MUSICA = path.join(MUSICA_DIR, "biblioteca.json");
        if (!fs.existsSync(MUSICA_DIR)) fs.mkdirSync(MUSICA_DIR, { recursive: true });
        let titulo = "Cancion", artista = "Desconocido", thumbnail = "";
        try {
          const { stdout } = await execAsync(`yt-dlp --print "%(title)s|||%(uploader)s|||%(thumbnail)s" --no-playlist "${url}" 2>/dev/null`, { timeout: 15000 });
          const partes = stdout.trim().split("|||");
          titulo = partes[0]?.trim() || "Cancion";
          artista = partes[1]?.trim() || "Desconocido";
          thumbnail = partes[2]?.trim() || "";
        } catch(e) { console.error("Error silencioso:", e.message); }
        const nombreArchivo = path.basename(archivoFinal);
        const destino = path.join(MUSICA_DIR, nombreArchivo);
        fs.copyFileSync(archivoFinal, destino);
        const db = fs.existsSync(DB_MUSICA) ? JSON.parse(fs.readFileSync(DB_MUSICA, "utf8")) : { canciones: [] };
        const nombreUsuario = usuariosConocidos[id]?.nombre || id.split("@")[0];
        db.canciones.push({ id: path.basename(archivoFinal, ".mp3"), titulo, artista, thumbnail, url_original: url, archivo: nombreArchivo, userId: id, nombreUsuario, fecha: new Date().toISOString(), tamano: fs.statSync(archivoFinal).size });
        fs.writeFileSync(DB_MUSICA, JSON.stringify(db, null, 2));
        console.log("[MUSICA] Guardada en biblioteca:", titulo);
      } catch(e) { console.error("[MUSICA] Error guardando en biblioteca:", e.message); }
    }
    fs.unlinkSync(archivoFinal);
  } catch (err) {
    console.error("Error descarga completo:", err.message);
    if (err.message === "t") {
      intentarReparar(client, id, "Error al enviar archivo multimedia por WhatsApp Web.", "enviar archivo mp4 por whatsapp-web.js");
    } else {
      await client.sendMessage(id, "Error al descargar: " + err.message.slice(0, 200));
    }
  }
}

export async function procesarColaDescargas(usuariosConocidos = {}) {
  if (descargaActiva || colaDescargas.length === 0) return;
  descargaActiva = true;
  const { client, id, url, tipo } = colaDescargas.shift();
  try {
    await ejecutarDescarga(client, id, url, tipo, usuariosConocidos);
  } catch(e) {
    console.error("Error en descarga de cola:", e.message);
  }
  descargaActiva = false;
  procesarColaDescargas(usuariosConocidos);
}

export async function descargarMedia(client, id, url, tipo, usuariosConocidos = {}) {
  const posicion = colaDescargas.length;
  if (descargaActiva || posicion > 0) {
    colaDescargas.push({ client, id, url, tipo });
    await client.sendMessage(id, "Hay " + (posicion + 1) + " descarga(s) en curso. Tu turno en aprox " + ((posicion + 1) * 2) + " minutos.");
    return;
  }
  colaDescargas.push({ client, id, url, tipo });
  procesarColaDescargas(usuariosConocidos);
}

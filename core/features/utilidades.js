import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { buscarWeb, buscarConSearXNG } from "../web_search.js";
import { preguntarGemini } from "../llm_gemini.js";
import { recordatorios } from "./reminder_commands.js";
import { CONFIG, ROOT_DIR } from "../../config/bmo.config.js";

const execAsync = promisify(exec);
const TEMP_DIR = path.join(ROOT_DIR, "temp_files");
const RESUMEN_ID = CONFIG.admin_wa;

export async function enviarResumenNocturno(client) {
  const id = RESUMEN_ID;
  console.log("Enviando resumen nocturno...");
  try {
    const fechaBackup = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await execAsync(`cp ${path.join(ROOT_DIR, 'index.js')} ${path.join(ROOT_DIR, 'backups', 'index.js.auto_')}${fechaBackup} && echo ok`);
    console.log("Backup nocturno creado:", fechaBackup);
  } catch(e) {
    console.error("Error backup nocturno:", e.message);
  }
  try {
    const climaResultados = await buscarWeb("clima manana Monterrey Nuevo Leon Mexico");
    await new Promise(r => setTimeout(r, 3000));
    const climaPrompt = climaResultados
      ? "DATOS CLIMA: " + climaResultados + "\nResume el clima de manana en Monterrey en 2 lineas. NO uses JSON, solo texto."
      : "Dime el clima tipico de Monterrey Nuevo Leon en febrero en 2 lineas. Solo texto, sin JSON.";
    const climaRespuesta = await preguntarGemini(id, climaPrompt, "Responde SOLO texto natural en espanol. NUNCA respondas con JSON aqui.");

    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    manana.setHours(0, 0, 0, 0);
    const pasadoManana = new Date(manana);
    pasadoManana.setDate(pasadoManana.getDate() + 1);
    const recsMañana = recordatorios.filter(r => r.fecha >= manana.getTime() && r.fecha < pasadoManana.getTime());

    await new Promise(r => setTimeout(r, 3000));
    const noticiasResultados = await buscarWeb("noticias importantes Mexico hoy");
    const noticiasPrompt = noticiasResultados
      ? "NOTICIAS: " + noticiasResultados + "\nResume las 2 noticias mas importantes en una linea cada una. Solo texto, sin JSON."
      : "Da 2 noticias relevantes de Mexico de esta semana que conozcas. Solo texto, sin JSON.";
    const noticiasRespuesta = await preguntarGemini(id, noticiasPrompt, "Responde SOLO texto natural en espanol. NUNCA respondas con JSON aqui.");

    const fraseRespuesta = await preguntarGemini(id, "Dame una frase motivacional corta y original para terminar el dia.", "Responde solo la frase, sin JSON, en espanol.");

    let mensaje = "Buenas noches Ruben! Aqui tu resumen para manana:\n\n";
    mensaje += "Clima manana en Monterrey:\n" + (climaRespuesta || "No disponible") + "\n\n";
    if (recsMañana.length > 0) {
      mensaje += "Recordatorios para manana:\n";
      recsMañana.forEach(r => {
        mensaje += "- " + r.mensaje + " a las " + new Date(r.fecha).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) + "\n";
      });
      mensaje += "\n";
    } else {
      mensaje += "No tienes recordatorios para manana.\n\n";
    }
    mensaje += "Noticias del dia:\n" + (noticiasRespuesta || "No disponible") + "\n\n";
    mensaje += "Frase del dia:\n" + (fraseRespuesta || "Cada dia es una nueva oportunidad.");
    await client.sendMessage(id, mensaje);
    console.log("Resumen nocturno enviado");
  } catch (err) {
    console.error("Error resumen nocturno:", err.message);
  }
}

export function programarResumenNocturno(client) {
  const ahora = new Date();
  const objetivo = new Date();
  objetivo.setHours(21, 30, 0, 0);
  if (ahora >= objetivo) objetivo.setDate(objetivo.getDate() + 1);
  const diff = objetivo.getTime() - ahora.getTime();
  console.log("Resumen nocturno programado en " + Math.round(diff/60000) + " minutos");
  setTimeout(() => {
    enviarResumenNocturno(client);
    programarResumenNocturno._interval = setInterval(() => enviarResumenNocturno(client), 24 * 60 * 60 * 1000);
  }, diff);
}

export async function transcribirAudio(audioPath) {
  try {
    console.log("Transcribiendo audio: " + audioPath);
    const script = `from faster_whisper import WhisperModel
model = WhisperModel("tiny", device="cpu", compute_type="int8")
segments, _ = model.transcribe("${audioPath}", language="es")
print(" ".join([s.text for s in segments]))`.trim();
    const tmpScript = "/tmp/whisper_transcribe.py";
    const fs2 = await import("fs");
    fs2.default.writeFileSync(tmpScript, script.replace("${audioPath}", audioPath));
    const { stdout } = await execAsync(`python3 ${tmpScript}`, { timeout: 180000 });
    return stdout.trim() || null;
  } catch (err) {
    console.error("Error faster-whisper:", err.message.slice(0, 100));
    return null;
  }
}

export async function obtenerClima(ciudad) {
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(ciudad)}&appid=${process.env.OPENWEATHER_API_KEY}&units=metric&lang=es`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const d = await res.json();
    if (d.main) {
      return `Clima en ${d.name}:\n Temperatura: ${d.main.temp}°C (sensacion ${d.main.feels_like}°C)\n Humedad: ${d.main.humidity}%\n Viento: ${d.wind.speed} m/s\n Condicion: ${d.weather[0].description}\n Max: ${d.main.temp_max}°C | Min: ${d.main.temp_min}°C`;
    }
  } catch(err) {
    console.log("OpenWeather fallo, usando SearXNG para clima");
  }
  const resultado = await buscarConSearXNG("clima temperatura hoy " + ciudad);
  if (resultado) return "Clima en " + ciudad + " (via busqueda):\n" + resultado;
  return null;
}

export async function generarImagen(prompt) {
  try {
    console.log("Generando imagen: " + prompt);
    const imagePath = path.join(TEMP_DIR, "img_" + Date.now() + ".jpg");
    const promptEscaped = prompt.replace(/'/g, "\'");
    await execAsync(
      `python3 -c "import requests; r=requests.post('https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell', headers={'Authorization':'Bearer ${process.env.HUGGINGFACE_API_KEY}','Content-Type':'application/json'}, json={'inputs':'${promptEscaped}'}); open('${imagePath}','wb').write(r.content)"`,
      { timeout: 600000 }
    );
    if (fs.existsSync(imagePath) && fs.statSync(imagePath).size > 1000) {
      console.log("Imagen generada: " + imagePath);
      return imagePath;
    }
    return null;
  } catch (err) {
    console.error("Error generando imagen:", err.message.slice(0, 100));
    return null;
  }
}

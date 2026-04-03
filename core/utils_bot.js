// core/utils_bot.js — Helpers de soporte para BMO
import { state, URL_REGEX, GEMINI_RETRY_MS, SESSION_TTL } from "./state.js";
import { esAutorizado } from "./context.js";
import { getHistorial } from "./session_history.js";
import axios from "axios";

export function detectarEnlace(texto) {
  const match = texto.match(URL_REGEX);
  return match ? match[0] : null;
}

export function esUsuarioLimitado(id) {
  return !esAutorizado(id);
}

export function accionPermitidaParaTodos(accion, mensaje) {
  const accionesLibres = ["imagen", "buscar", "clima", "historial_archivos", "listar_habilidades"];
  if (accionesLibres.includes(accion)) return true;
  if (/recordatorio|recuerdame|recuérdame|reminder|ponme un aviso/i.test(mensaje)) return true;
  if (/descargar|download|youtube|tiktok|instagram|facebook|spotify|musica|música|video|cancion|canción/i.test(mensaje)) return true;
  if (/busca|buscar|busca en internet|google|busca en la web|qué es|que es|quien es|quién es/i.test(mensaje)) return true;
  if (/clima|temperatura|tiempo.*hoy|lluvia|pronóstico|pronostico/i.test(mensaje) && !/\b(script|python|código|programa|bash|node|javascript|\.py|\.sh)\b/i.test(mensaje)) return true;
  if (/convertir|convierte|pdf|word|docx|imagen a pdf|pdf a word/i.test(mensaje)) return true;
  if (/crea.*imagen|genera.*imagen|dibuja|imagen de|foto de/i.test(mensaje)) return true;
  return false;
}

export function comandoBloqueadoParaUsuario(cmd) {
  return /apt|pip|npm install|npm uninstall|rm -rf|systemctl|reboot|shutdown|passwd|chmod|chown|mkfs|dd |crontab|visudo/i.test(cmd);
}

export function splitText(text, maxLength = 800) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = start + maxLength;
    if (end < text.length) {
      const lp = text.lastIndexOf(".", end);
      if (lp > start) end = lp + 1;
    }
    parts.push(text.slice(start, end).trim());
    start = end;
  }
  return parts;
}

export function resetearTokensSiNuevoDia() {
  const hoy = new Date().toDateString();
  if (hoy !== state.ultimoResetTokens) {
    state.tokensUsadosHoy = 0;
    state.ultimoResetTokens = hoy;
    state.geminiDisponible = true;
    state.geminiCaidoDesde = null;
    console.log("Tokens reseteados para nuevo dia");
  }
  if (!state.geminiDisponible && state.geminiCaidoDesde) {
    const diff = Date.now() - state.geminiCaidoDesde;
    if (diff >= GEMINI_RETRY_MS) {
      state.geminiDisponible = true;
      state.geminiCaidoDesde = null;
      console.log("Reintentando Gemini despues de 60s");
    }
  }
}

export function estimarTokens(texto) {
  return Math.ceil(texto.length / 4);
}

export async function generateWithOllama15b(id, userMessage) {
  const h = getHistorial(id);
  let prompt = "";
  for (const entry of h) {
    prompt += entry.role === "user"
      ? "Usuario: " + entry.content + "\n"
      : "Asistente: " + entry.content + "\n";
  }
  prompt += "Usuario: " + userMessage + "\nAsistente:";
  try {
    const res = await axios.post("http://127.0.0.1:11434/api/generate", {
      model: "qwen2.5:1.5b",
      system: "Eres BMO, un asistente util y simpatico. Responde siempre en espanol de forma concisa y amigable.",
      prompt,
      stream: false,
      options: { num_predict: 500 },
    });
    return res.data.response?.trim() || "No pude generar respuesta.";
  } catch (err) {
    return "No pude conectarme con el servicio local de IA.";
  }
}

export function getSession(id) {
  const s = state.sessions.get(id);
  if (s && Date.now() < s.expiresAt) return s;
  return null;
}

export function setSession(id, datos) {
  state.sessions.set(id, { ...datos, expiresAt: Date.now() + SESSION_TTL });
}

export function clearSession(id) {
  state.sessions.delete(id);
}

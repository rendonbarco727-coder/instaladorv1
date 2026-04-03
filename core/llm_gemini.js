// core/llm_gemini.js
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHistorialGemini, getNombreUsuario } from './session_history.js';
import { podarContexto } from './context_pruner.js';
import { buscarMemoriasRelevantes } from '../cognicion/memoria_bmo.js';
import { preguntarConFallback } from './fallback_ia.js';
import { estimarTokens } from './utils.js';
import { generarContextoPersonalidad } from './personality.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Cargar SOUL.md al arrancar — editable sin tocar código
function cargarSoul() {
  const soulPath = path.join(__dirname, '../SOUL.md');
  try {
    return fs.readFileSync(soulPath, 'utf8');
  } catch(e) {
    console.log('[LLM] SOUL.md no encontrado, usando personalidad por defecto');
    return generarContextoPersonalidad();
  }
}

const SOUL = cargarSoul();
console.log('[LLM] SOUL.md cargado OK');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
let geminiDisponible = true;
let geminiCaidoDesde = null;
let tokensUsadosHoy = 0;

// Pool de keys Gemini con rotación
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
].filter(Boolean);

let geminiKeyIndex = 0;
function getGeminiKey() {
  if (!GEMINI_KEYS.length) throw new Error('No hay keys de Gemini configuradas');
  const key = GEMINI_KEYS[geminiKeyIndex % GEMINI_KEYS.length];
  geminiKeyIndex++;
  return key;
}

export async function preguntarGemini(id, userMessage, contextoExtra = "", esAdmin = false) {
  const historial = podarContexto(getHistorialGemini(id));
  const nombreUsuario = getNombreUsuario(id) || "Usuario";
  const ahora = new Date().toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const memoriasRelevantes = await buscarMemoriasRelevantes(id, userMessage, 5);
  const contextoMemoria = memoriasRelevantes.length > 0
    ? `\n\n## LO QUE RECUERDAS DE ${nombreUsuario}:\n${memoriasRelevantes.map(m => `- [${m.tipo}] ${m.contenido}`).join('\n')}`
    : '';

  const systemPrompt = `${SOUL}

## CONTEXTO DINÁMICO
Usuario: ${nombreUsuario}
Fecha y hora: ${ahora}${contextoMemoria}${contextoExtra ? "\n## CONTEXTO ADICIONAL\n" + contextoExtra : ""}
`;

  try {
    const contents = [
      ...historial,
      { role: "user", parts: [{ text: userMessage }] }
    ];

    const key = getGeminiKey();
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
      {
        contents: [
          { role: "user", parts: [{ text: systemPrompt }] },
          { role: "model", parts: [{ text: "Entendido." }] },
          ...contents
        ],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.7 }
      }
    );

    const respuesta = res.data.candidates[0].content.parts[0].text.trim();
    const tokensEntrada = estimarTokens(systemPrompt + userMessage);
    const tokensSalida = estimarTokens(respuesta);
    tokensUsadosHoy += tokensEntrada + tokensSalida;
    console.log(`Tokens esta consulta: ${tokensEntrada + tokensSalida} | Total hoy: ${tokensUsadosHoy}`);
    return respuesta;

  } catch (err) {
    const errorData = err.response?.data || {};
    console.error("Error Gemini:", errorData);
    if (err.response?.status === 429 ||
        JSON.stringify(errorData).includes("quota") ||
        JSON.stringify(errorData).includes("RESOURCE_EXHAUSTED")) {
      geminiDisponible = false;
      geminiCaidoDesde = Date.now();
      console.log("Gemini sin quota - activando fallback Groq/Mistral");
    }
    try {
      const fallback = await preguntarConFallback(
        [{ role: "user", content: userMessage }],
        systemPrompt
      );
      if (fallback) {
        console.log("[Fallback] Respondió: " + fallback.fuente);
        return fallback.respuesta;
      }
    } catch(fe) {
      console.log("[Fallback] Todos fallaron:", fe.message.slice(0, 50));
    }
    return null;
  }
}

export async function generarComandoOllama(descripcion, modelo = "qwen2.5:0.5b") {
  try {
    const res = await axios.post("http://127.0.0.1:11434/api/generate", {
      model: modelo,
      system: "Convierte la descripcion a un comando bash de Linux. Responde SOLO el comando, sin explicaciones, sin markdown.",
      prompt: descripcion,
      stream: false,
      options: { num_predict: 100 },
    });
    let cmd = res.data.response?.trim() || null;
    if (cmd) {
      cmd = cmd.replace(/`/g, "").trim();
      cmd = cmd.split("\n")[0].trim();
      cmd = cmd.replace(/^(bash|sh|shell)\s+/i, "");
    }
    return cmd;
  } catch (err) {
    console.error("Error Ollama:", err.message);
    return null;
  }
}

export function getTokensHoy() { return tokensUsadosHoy; }
export function isGeminiDisponible() { return geminiDisponible; }

// ─────────────────────────────────────────────────────────────
// ORQUESTADOR COGNITIVO — Debate Multi-Agente BMO
//
// Flujo:
//   1. Gemini propone respuesta (conversacional, contexto largo)
//   2. Mistral la critica (técnico, detecta errores/riesgos)
//   3. Ollama local da su versión rápida (sin costo)
//   4. Árbitro evalúa las tres y elige o sintetiza la mejor
//
// Solo activa debate para mensajes que lo merezcan.
// Conversación simple → Gemini directo (sin overhead).
// ─────────────────────────────────────────────────────────────

import axios from "axios";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemma-3-27b-it";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

// ── Clasificador de complejidad ───────────────────────────────
// Decide si el mensaje merece debate o respuesta directa
export function necesitaDebate(mensaje) {
  // Conversación trivial → no debate
  const trivial = /^(hola|hello|hi|hey|buenas|qué tal|gracias|ok|bien|sí|no|vale|claro|perfecto|genial|entendido|jaja|xd|👍|😂)/i;
  if (trivial.test(mensaje.trim())) return false;

  // Preguntas cortas simples → no debate
  if (mensaje.trim().length < 25) return false;

  // Merece debate:
  const triggers = [
    /ejecuta|corre|instala|borra|elimina|modifica|cambia|actualiza/i,  // acciones del sistema
    /aprende|habilidad|módulo|automatiza|crea.*función/i,               // auto-aprendizaje
    /cómo|como|por qué|porqué|explica|dime|analiza|compara/i,          // preguntas complejas
    /tráfico|busca|descarga|convierte|guarda/i,                   // tareas con herramientas (clima va directo)
    /error|problema|falla|no funciona|arregla/i,                       // diagnóstico
  ];
  return triggers.some(r => r.test(mensaje));
}

// ── Agente 1: Gemini (conversacional) ────────────────────────
async function consultarGemini(mensaje, systemPrompt, historial = []) {
  try {
    const contents = [
      { role: "user", parts: [{ text: systemPrompt }] },
      { role: "model", parts: [{ text: "Entendido." }] },
      ...historial,
      { role: "user", parts: [{ text: mensaje }] }
    ];
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { contents, generationConfig: { maxOutputTokens: 800, temperature: 0.7 } },
      { timeout: 20000 }
    );
    return res.data.candidates[0].content.parts[0].text.trim();
  } catch(e) {
    console.log("[Debate] Gemini falló:", e.message.slice(0, 60));
    return null;
  }
}

// ── Agente 2: Mistral (crítico técnico) ──────────────────────
async function consultarMistral(mensaje, respuestaGemini) {
  try {
    const prompt = `Eres un agente crítico técnico. Analiza esta situación:

MENSAJE DEL USUARIO: "${mensaje}"

RESPUESTA PROPUESTA POR GEMINI:
"${respuestaGemini}"

Tu tarea:
1. ¿La respuesta es correcta y segura? 
2. ¿Hay errores técnicos, riesgos o información incorrecta?
3. ¿Qué mejorarías o cambiarías?

Responde en JSON exactamente así:
{
  "aprueba": true/false,
  "confianza": 0-100,
  "critica": "qué está mal o podría mejorar (null si nada)",
  "mejora": "versión mejorada de la respuesta (null si aprueba sin cambios)"
}`;

    const res = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model: "mistral-small-latest",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
        temperature: 0.3  // más determinista para crítica
      },
      {
        headers: {
          "Authorization": `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    );
    const texto = res.data.choices[0].message.content.trim();
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch(e) {
    console.log("[Debate] Mistral falló:", e.message.slice(0, 60));
    return null;
  }
}

// ── Agente 3: Ollama (perspectiva local rápida) ───────────────
async function consultarOllama(mensaje) {
  try {
    const res = await axios.post(
      "http://127.0.0.1:11434/api/generate",
      {
        model: OLLAMA_MODEL,
        system: "Eres BMO, asistente en WhatsApp. Responde en español de forma concisa y útil.",
        prompt: mensaje,
        stream: false,
        options: { num_predict: 300 }
      },
      { timeout: 12000 }
    );
    return res.data.response?.trim() || null;
  } catch(e) {
    console.log("[Debate] Ollama falló:", e.message.slice(0, 60));
    return null;
  }
}

// ── Árbitro: decide la respuesta final ───────────────────────
function arbitrar(gemini, critica, ollama) {
  // Si Mistral aprueba con alta confianza → usar Gemini
  if (critica && critica.aprueba && critica.confianza >= 75) {
    console.log(`[Debate] Gemini aprobado (confianza: ${critica.confianza})`);
    return { respuesta: gemini, fuente: "gemini", debate: critica };
  }

  // Si Mistral propone mejora → usar la mejora de Mistral
  if (critica && critica.mejora) {
    console.log(`[Debate] Mistral mejoró respuesta. Critica: ${critica.critica?.slice(0, 60)}`);
    return { respuesta: critica.mejora, fuente: "mistral", debate: critica };
  }

  // Si Mistral rechaza pero sin proponer mejora → Gemini igual (Mistral solo criticó)
  if (gemini) {
    console.log(`[Debate] Usando Gemini por defecto`);
    return { respuesta: gemini, fuente: "gemini", debate: critica };
  }

  // Último recurso: Ollama
  if (ollama) {
    console.log(`[Debate] Usando Ollama como último recurso`);
    return { respuesta: ollama, fuente: "ollama", debate: null };
  }

  return null;
}

// ── Función principal exportada ───────────────────────────────
export async function debatirRespuesta(mensaje, systemPrompt, historial = []) {
  console.log(`[Debate] Iniciando para: "${mensaje.slice(0, 60)}"`);
  const inicio = Date.now();

  // Lanzar Gemini y Ollama en paralelo para ahorrar tiempo
  const [geminiResp, ollamaResp] = await Promise.all([
    consultarGemini(mensaje, systemPrompt, historial),
    consultarOllama(mensaje)
  ]);

  if (!geminiResp) {
    // Gemini falló — usar Ollama directamente sin debate
    console.log("[Debate] Gemini no disponible, usando Ollama sin debate");
    return { respuesta: ollamaResp || "No pude generar respuesta.", fuente: "ollama", debate: null };
  }

  // Mistral critica la respuesta de Gemini
  const critica = await consultarMistral(mensaje, geminiResp);

  const resultado = arbitrar(geminiResp, critica, ollamaResp);
  const duracion = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log(`[Debate] Resuelto en ${duracion}s → fuente: ${resultado?.fuente}`);
  if (critica) {
    console.log(`[Debate] Mistral confianza: ${critica.confianza} | Aprueba: ${critica.aprueba}`);
    if (critica.critica) console.log(`[Debate] Critica: ${critica.critica.slice(0, 100)}`);
  }

  return resultado;
}

// ── Log de debates para análisis posterior ────────────────────
import fs from "fs";
const DEBATE_LOG = "./debate_log.json";

export function registrarDebate(mensaje, resultado) {
  try {
    let log = [];
    if (fs.existsSync(DEBATE_LOG)) {
      log = JSON.parse(fs.readFileSync(DEBATE_LOG, "utf8"));
    }
    log.push({
      fecha: new Date().toISOString(),
      mensaje: mensaje.slice(0, 100),
      fuente: resultado.fuente,
      aprobado: resultado.debate?.aprueba ?? null,
      confianza: resultado.debate?.confianza ?? null,
      critica: resultado.debate?.critica?.slice(0, 100) ?? null
    });
    // Mantener solo los últimos 200 debates
    if (log.length > 200) log.splice(0, log.length - 200);
    fs.writeFileSync(DEBATE_LOG, JSON.stringify(log, null, 2));
  } catch(e) { /* no crashear por log */ }
}

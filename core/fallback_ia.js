import axios from 'axios';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

export async function preguntarGroq(mensajes, systemPrompt) {
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...mensajes
    ],
    max_tokens: 1000,
    temperature: 0.7
  }, {
    headers: {
      'Authorization': `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });
  return res.data.choices[0].message.content.trim();
}

export async function preguntarMistral(mensajes, systemPrompt) {
  const res = await axios.post('https://api.mistral.ai/v1/chat/completions', {
    model: 'mistral-medium-latest',
    messages: [
      { role: 'system', content: systemPrompt },
      ...mensajes
    ],
    max_tokens: 1000,
    temperature: 0.7
  }, {
    headers: {
      'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });
  return res.data.choices[0].message.content.trim();
}

// Fallback en cadena: Groq → Mistral → Ollama
export async function preguntarConFallback(mensajes, systemPrompt) {
  // 1. Groq
  try {
    const respuesta = await preguntarGroq(mensajes, systemPrompt);
    if (respuesta && respuesta.length > 5) {
      console.log("[Fallback] Groq respondió");
      return { respuesta, fuente: 'groq' };
    }
  } catch(e) {
    console.log("[Fallback] Groq falló:", e.message.slice(0, 50));
  }

  // 2. Mistral
  try {
    const respuesta = await preguntarMistral(mensajes, systemPrompt);
    if (respuesta && respuesta.length > 5) {
      console.log("[Fallback] Mistral respondió");
      return { respuesta, fuente: 'mistral' };
    }
  } catch(e) {
    console.log("[Fallback] Mistral falló:", e.message.slice(0, 50));
  }

  return null;
}

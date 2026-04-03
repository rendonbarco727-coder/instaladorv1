import { callMistral } from '../models/mistral.js';
import { callOllama } from '../models/ollama.js';
import { callBestAPI, callGroq, callGrok, API_POOL } from '../models/api_pool.js';

const MODEL_MAP = {
    razonamiento: { provider: 'groq',    model: 'llama-3.3-70b-versatile' },
    generacion:   { provider: 'groq',    model: 'llama-3.1-8b-instant' },
    codigo:       { provider: 'groq',    model: 'llama-3.3-70b-versatile' },
    web:          { provider: 'groq',    model: 'llama-3.3-70b-versatile' },
    rapido:       { provider: 'groq',    model: 'llama-3.1-8b-instant' },
    analitico:    { provider: 'groq',    model: 'qwen/qwen3-32b' },
    vision:       { provider: 'ollama',  model: 'llava:7b' },
};

export async function callModel(tipo, prompt, options = {}) {
    const cfg = MODEL_MAP[tipo] || MODEL_MAP.generacion;
    console.log(`[MODEL_ROUTER] tipo=${tipo} model=${cfg.model}`);

    if (cfg.provider === 'grok') {
        try {
            return await callGrok(prompt, { ...options, model: cfg.model });
        } catch(e) {
            console.log(`[MODEL_ROUTER] Grok falló (${e.message.slice(0,40)}), usando Groq...`);
            return await callGroq(prompt, { ...options, model: 'llama-3.3-70b-versatile' });
        }
    } else if (cfg.provider === 'groq') {
        try {
            return await callGroq(prompt, { ...options, model: cfg.model });
        } catch(e) {
            console.log(`[MODEL_ROUTER] Groq falló (${e.message.slice(0,40)}), intentando Mistral...`);
            try {
                return await callMistral(prompt, { ...options, model: 'mistral-small-latest' });
            } catch(e2) {
                console.log(`[MODEL_ROUTER] Mistral falló, usando pool completo...`);
                return await callBestAPI(prompt, options);
            }
        }
    } else if (cfg.provider === 'ollama') {
        try {
            return await callOllama(prompt, { ...options, model: cfg.model });
        } catch(e) {
            console.log(`[MODEL_ROUTER] Ollama falló, usando pool...`);
            return await callBestAPI(prompt, options);
        }
    }
    return await callBestAPI(prompt, options);
}

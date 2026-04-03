import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
const execAsync = promisify(exec);

// POOL DE KEYS POR PROVEEDOR
const API_POOL = {
    gemini: {
        keys: [
            process.env.GEMINI_API_KEY,
            process.env.GEMINI_API_KEY_2,
            process.env.GEMINI_API_KEY_3,
            process.env.GEMINI_API_KEY_4,
            process.env.GEMINI_API_KEY_5,
        ].filter(Boolean),
        currentIdx: 0,
        failedKeys: new Set(),
        lastLatency: 999,
    },
    grok: {
        keys: [
            process.env.GROK_API_KEY_1,
            process.env.GROK_API_KEY_2,
            process.env.GROK_API_KEY_3,
            process.env.GROK_API_KEY_4,
        ].filter(Boolean),
        currentIdx: 0,
        failedKeys: new Set(),
        lastLatency: 999,
    },
    openai: {
        keys: [
            process.env.OPENAI_API_KEY_1,
            process.env.OPENAI_API_KEY_2,
            process.env.OPENAI_API_KEY_3,
        ].filter(Boolean),
        currentIdx: 0,
        failedKeys: new Set(),
        lastLatency: 999,
    },
    groq: {
        queue: [], processing: false,
        keys: [
            process.env.GROQ_API_KEY,
            process.env.GROQ_API_KEY_2,
            process.env.GROQ_API_KEY_3,
            process.env.GROQ_API_KEY_4,
        ].filter(Boolean),
        currentIdx: 0,
        failedKeys: new Set(),
        lastLatency: 999,
    },
    mistral: {
        keys: [process.env.MISTRAL_API_KEY].filter(Boolean),
        currentIdx: 0,
        failedKeys: new Set(),
        lastLatency: 999,
    }
};

// Obtener siguiente key disponible del pool
function getNextKey(provider) {
    const pool = API_POOL[provider];
    if (!pool) return null;
    const available = pool.keys.filter(k => !pool.failedKeys.has(k));
    if (!available.length) {
        // Reset con cooldown — solo resetear si han pasado 60s
        const ahora = Date.now();
        if (!pool.lastReset || (ahora - pool.lastReset) > 60000) {
            pool.failedKeys.clear();
            pool.lastReset = ahora;
            console.log(`[API_POOL] Reset de keys ${provider} después de cooldown`);
            return pool.keys[0];
        }
        return null; // Sin keys disponibles, dejar fallar al caller
    }
    return available[pool.currentIdx % available.length];
}

// Marcar key como fallida y rotar
function markKeyFailed(provider, key) {
    const pool = API_POOL[provider];
    if (pool) {
        pool.failedKeys.add(key);
        pool.currentIdx++;
        console.log(`[API_POOL] Key de ${provider} marcada como fallida, rotando (${pool.failedKeys.size}/${pool.keys.length} fallidas)`);
    }
}

// Llamar a Gemini
async function callGemini(prompt, options = {}) {
    const model = options.model || 'gemini-2.0-flash';
    // Intentar todas las keys disponibles
    const availableKeys = API_POOL.gemini.keys.filter(k => !API_POOL.gemini.failedKeys.has(k));
    const keysToTry = availableKeys.length > 0 ? availableKeys : API_POOL.gemini.keys;
    let lastError = null;
    for (const key of keysToTry) {
    const body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: options.temperature || 0.7,
            maxOutputTokens: options.max_tokens || 1000,
        }
    });
    const tmpFile = `/tmp/gemini_req_${Date.now()}.json`;
    fs.writeFileSync(tmpFile, body);
    const t0 = Date.now();
    const { stdout } = await execAsync(
        `curl -s --max-time 30 "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}" -H "Content-Type: application/json" -d @${tmpFile}`
    );
    try { fs.unlinkSync(tmpFile); } catch(e) {}
    const latency = Date.now() - t0;
    API_POOL.gemini.lastLatency = latency;
        const data = JSON.parse(stdout);
        if (data.error) {
            const msg = data.error.message || '';
            // Si es rate limit, esperar y reintentar con misma key
            if (msg.includes('retry in') || msg.includes('RESOURCE_EXHAUSTED')) {
                const seconds = parseFloat(msg.match(/retry in ([\d.]+)s/)?.[1] || '5');
                console.log(`[API_POOL] Gemini rate limit, esperando ${Math.ceil(seconds)}s...`);
                await new Promise(r => setTimeout(r, Math.ceil(seconds) * 1000));
                // Reintentar esta key
                const { stdout: stdout2 } = await execAsync(
                    `curl -s --max-time 30 "https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}" -H "Content-Type: application/json" -d @${tmpFile.replace('.json','_retry.json')}`
                ).catch(() => ({stdout:'{}'}));
                const data2 = JSON.parse(stdout2 || '{}');
                if (!data2.error) {
                    return data2.candidates?.[0]?.content?.parts?.[0]?.text || '';
                }
            }
            markKeyFailed('gemini', key);
            lastError = msg;
            continue;
        }
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    throw new Error(`Gemini error (todas las keys fallaron): ${lastError}`);
}

// Llamar a Grok (xAI)
async function callGrok(prompt, options = {}) {
    const key = getNextKey('grok');
    const body = JSON.stringify({
        model: options.model || 'grok-3-mini-fast',
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1000,
        stream: false,
    });
    const tmpFile = `/tmp/grok_req_${Date.now()}.json`;
    fs.writeFileSync(tmpFile, body);
    const t0 = Date.now();
    const { stdout } = await execAsync(
        `curl -s --max-time 30 "https://api.x.ai/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer ${key}" -d @${tmpFile}`
    );
    try { fs.unlinkSync(tmpFile); } catch(e) {}
    const latency = Date.now() - t0;
    API_POOL.grok.lastLatency = latency;
    const data = JSON.parse(stdout);
    if (data.error) {
        markKeyFailed('grok', key);
        throw new Error(`Grok error: ${data.error.message}`);
    }
    return data.choices?.[0]?.message?.content || '';
}

// Llamar a Groq (gratis, muy rápido)
async function callGroq(prompt, options = {}) {
    const key = getNextKey('groq');
    const body = JSON.stringify({
        model: options.model || 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1000,
        stream: false,
    });
    const tmpFile = `/tmp/groq_req_${Date.now()}.json`;
    fs.writeFileSync(tmpFile, body);
    const t0 = Date.now();
    const { stdout } = await execAsync(
        `curl -s --max-time 30 "https://api.groq.com/openai/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer ${key}" -d @${tmpFile}`
    );
    fs.unlinkSync(tmpFile);
    API_POOL.groq.lastLatency = Date.now() - t0;
    const data = JSON.parse(stdout);
    if (data.error) {
        markKeyFailed('groq', key);
        throw new Error(`Groq error: ${data.error.message}`);
    }
    return data.choices?.[0]?.message?.content || '';
}

// Llamar a OpenAI
async function callOpenAI(prompt, options = {}) {
    const key = getNextKey('openai');
    const body = JSON.stringify({
        model: options.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1000,
    });
    const tmpFile = `/tmp/openai_req_${Date.now()}.json`;
    fs.writeFileSync(tmpFile, body);
    const t0 = Date.now();
    const { stdout } = await execAsync(
        `curl -s --max-time 30 "https://api.openai.com/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer ${key}" -d @${tmpFile}`
    );
    try { fs.unlinkSync(tmpFile); } catch(e) {}
    const latency = Date.now() - t0;
    API_POOL.openai.lastLatency = latency;
    const data = JSON.parse(stdout);
    if (data.error) {
        markKeyFailed('openai', key);
        throw new Error(`OpenAI error: ${data.error.message}`);
    }
    return data.choices?.[0]?.message?.content || '';
}

// LLAMADA INTELIGENTE: usa la API más rápida disponible

const QUEUE_INTERVAL = 500; // 2 requests per second max

async function processGroqQueue() {
    const pool = API_POOL.groq;
    if (pool.processing || pool.queue.length === 0) return;
    pool.processing = true;
    
    const { prompt, options, resolve, reject } = pool.queue.shift();
    try {
        const result = await callGroq(prompt, options);
        resolve(result);
    } catch (e) {
        reject(e);
    } finally {
        pool.processing = false;
        setTimeout(processGroqQueue, QUEUE_INTERVAL);
    }
}

export async function callBestAPI(prompt, options = {}) {
    // Ordenar proveedores por latencia
    const providers = [
        { name: 'groq',   fn: callGroq,   latency: API_POOL.groq.lastLatency },
        { name: 'gemini', fn: callGemini, latency: API_POOL.gemini.lastLatency },
        { name: 'grok',   fn: callGrok,   latency: API_POOL.grok.lastLatency },
        { name: 'openai', fn: callOpenAI, latency: API_POOL.openai.lastLatency },
    ].sort((a, b) => a.latency - b.latency);

    for (const provider of providers) {
        try {
            console.log(`[API_POOL] Intentando ${provider.name} (latencia previa: ${provider.latency}ms)`);
            const result = await provider.fn(prompt, options);
            if (result) {
                console.log(`[API_POOL] ✅ ${provider.name} respondió en ${API_POOL[provider.name].lastLatency}ms`);
                return result;
            }
        } catch(e) {
            console.log(`[API_POOL] ❌ ${provider.name} falló: ${e.message.slice(0,60)}, probando siguiente...`);
        }
    }
    throw new Error('Todos los proveedores fallaron');
}

export { callGemini, callGrok, callGroq, callOpenAI, getNextKey, markKeyFailed, API_POOL };

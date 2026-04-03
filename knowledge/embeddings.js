import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

// Generar embedding con Ollama (nomic-embed-text o fallback a qwen2.5)
export async function generarEmbedding(texto) {
    const body = JSON.stringify({
        model: 'nomic-embed-text',
        prompt: texto.slice(0, 500)
    });

    try {
        const { stdout } = await execAsync(
            `curl -s --max-time 15 "http://localhost:11434/api/embeddings" ` +
            `-H "Content-Type: application/json" -d ${JSON.stringify(body)}`
        );
        const data = JSON.parse(stdout);
        if (data.embedding?.length) return data.embedding;
    } catch(e) {}

    // Fallback: embedding simple basado en hash de palabras
    return embedFallback(texto);
}

// Fallback cuando Ollama no tiene modelo de embeddings
function embedFallback(texto) {
    const palabras = texto.toLowerCase().replace(/[^a-záéíóúñ\s]/g, '').split(/\s+/).filter(Boolean);
    const vocab = new Map();
    palabras.forEach(p => vocab.set(p, (vocab.get(p) || 0) + 1));
    
    // Vector de 64 dimensiones por hashing
    const vec = new Array(64).fill(0);
    for (const [palabra, freq] of vocab) {
        let hash = 0;
        for (let i = 0; i < palabra.length; i++) hash = (hash * 31 + palabra.charCodeAt(i)) % 64;
        vec[Math.abs(hash)] += freq;
    }
    // Normalizar
    const mag = Math.sqrt(vec.reduce((s, v) => s + v*v, 0)) || 1;
    return vec.map(v => v / mag);
}

// Similitud coseno entre dos vectores
export function similitudCoseno(a, b) {
    if (!a?.length || !b?.length || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}

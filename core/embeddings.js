import { pipeline } from '@xenova/transformers';
import { ROOT_DIR } from '../config/bmo.config.js';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
let extractor = null;

async function getExtractor() {
    if (!extractor) {
        console.log('[Embeddings] Cargando modelo...');
        extractor = await pipeline('feature-extraction', MODEL, {
            cache_dir: `${ROOT_DIR}/models`
        });
        console.log('[Embeddings] Modelo listo ✅');
    }
    return extractor;
}

export async function getEmbedding(texto) {
    const ext = await getExtractor();
    const output = await ext(texto, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

export function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function buscarSimilar(texto, filas, topK = 3) {
    const queryVec = await getEmbedding(texto);
    return filas
        .filter(f => f.embedding)
        .map(f => ({
            ...f,
            score: cosineSimilarity(queryVec, JSON.parse(f.embedding))
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

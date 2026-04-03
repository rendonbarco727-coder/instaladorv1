// core/context_compaction.js — Context compaction con memory flush
// Inspirado en OpenClaw: antes de podar historial, migra hechos clave a disco

import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config/bmo.config.js';

const MEMORY_DIR = path.join(ROOT_DIR, 'memory');
const COMPACTION_THRESHOLD = 8;  // mensajes antes de compactar
const FLUSH_BUDGET_CHARS = 2000; // máx chars a extraer por flush

// Asegurar que el directorio memory/ existe
function ensureMemoryDir() {
    if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// Ruta del diario diario: memory/YYYY-MM-DD.md
function getDiaryPath() {
    const hoy = new Date().toISOString().slice(0, 10);
    return path.join(MEMORY_DIR, `${hoy}.md`);
}

// Ruta del archivo de memoria durable
const MEMORY_MD = path.join(ROOT_DIR, 'MEMORY.md');

// Leer MEMORY.md actual
export function leerMemoryMd() {
    try {
        if (fs.existsSync(MEMORY_MD)) return fs.readFileSync(MEMORY_MD, 'utf8');
    } catch(_) {}
    return '';
}

// Escribir en el diario diario (append)
function escribirDiario(userId, contenido) {
    ensureMemoryDir();
    const ruta = getDiaryPath();
    const entrada = `\n## [${new Date().toISOString()}] Usuario: ${userId}\n${contenido}\n`;
    fs.appendFileSync(ruta, entrada);
}

// Actualizar MEMORY.md con hechos durables
function actualizarMemoryMd(hechos) {
    ensureMemoryDir();
    const hoy = new Date().toISOString().slice(0, 10);
    let actual = leerMemoryMd();
    // Añadir sección de hechos nuevos
    const seccion = `\n### Actualización ${hoy}\n${hechos}\n`;
    // Limitar MEMORY.md a 20k chars para no saturar contexto
    const nuevo = (actual + seccion).slice(-20000);
    fs.writeFileSync(MEMORY_MD, nuevo);
}

// Flush silencioso — extrae hechos clave antes de compactar
export async function flushContextoAntesDePoda(userId, historial) {
    if (!historial || historial.length < 3) return null;

    try {
        const { callModel } = await import('./model_router.js');

        const texto = historial
            .map(e => `${e.role === 'user' ? 'Usuario' : 'BMO'}: ${String(e.content).slice(0, 300)}`)
            .join('\n');

        const prompt = `Eres el sistema de memoria de BMO. Analiza esta conversación y extrae SOLO los hechos durables que BMO debe recordar para siempre.

CONVERSACIÓN A ANALIZAR:
${texto.slice(0, FLUSH_BUDGET_CHARS)}

Extrae en formato Markdown conciso:
- Nombres, preferencias o datos del usuario
- Decisiones tomadas o acuerdos establecidos  
- Comandos o configuraciones que funcionaron
- Errores importantes a evitar
- Cualquier hecho que sería útil en futuras conversaciones

Si no hay nada importante, responde exactamente: NO_FACTS
Responde SOLO con los hechos en markdown, sin introducción ni cierre.`;

        const hechos = await callModel('rapido', prompt);

        if (!hechos || hechos.trim() === 'NO_FACTS' || hechos.trim().length < 10) {
            console.log(`[COMPACTION] Sin hechos durables para ${userId}`);
            return null;
        }

        // Guardar en diario diario
        escribirDiario(userId, hechos.trim());

        // Actualizar MEMORY.md si los hechos son significativos (>50 chars)
        if (hechos.trim().length > 50) {
            actualizarMemoryMd(hechos.trim());
            console.log(`[COMPACTION] Hechos migrados a MEMORY.md para ${userId}`);
        }

        return hechos.trim();

    } catch(e) {
        console.error('[COMPACTION] Error en flush:', e.message);
        return null;
    }
}

// Generar resumen compacto post-flush (reemplaza el resumen simple actual)
export async function generarResumenCompacto(userId, historial) {
    try {
        const { callModel } = await import('./model_router.js');
        const texto = historial
            .map(e => `${e.role === 'user' ? 'U' : 'B'}: ${String(e.content).slice(0, 200)}`)
            .join('\n');

        const resumen = await callModel('rapido',
            `Resume en máximo 3 líneas en español, conservando nombres, comandos y decisiones clave:\n\n${texto.slice(0, 1500)}`
        );
        return resumen?.trim() || null;
    } catch(e) {
        return historial.slice(-2).map(e => String(e.content)).join(' | ').slice(0, 200);
    }
}

// Verificar si el contexto se acerca al límite (para flush preventivo en agent_loop)
export function necesitaCompactar(historial, umbral = COMPACTION_THRESHOLD) {
    return historial && historial.length >= umbral;
}

// Leer diario de hoy para inyectar en contexto
export function leerDiarioHoy() {
    try {
        const ruta = getDiaryPath();
        if (fs.existsSync(ruta)) return fs.readFileSync(ruta, 'utf8').slice(-5000);
    } catch(_) {}
    return '';
}

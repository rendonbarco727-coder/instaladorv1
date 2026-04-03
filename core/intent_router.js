import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

// ═══════════════════════════════════════
// INTENT CACHE (en memoria + TTL)
// ═══════════════════════════════════════
const _cache = new Map();
const CACHE_TTL = 3 * 60 * 1000; // 3 min — reducido para datos en tiempo real

function normalizar(text) {
    return text.toLowerCase()
        .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
        .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o')
        .replace(/[úùü]/g,'u')
        .replace(/[^a-z0-9\s]/g,' ')
        .replace(/\s+/g,' ').trim().slice(0, 80);
}

function getCachedIntent(text) {
    const key = normalizar(text);
    const hit = _cache.get(key);
    if (hit && (Date.now() - hit.ts) < CACHE_TTL) {
        console.log(`[INTENT CACHE] hit → ${hit.intent.type}${hit.intent.tool ? '/' + hit.intent.tool : ''}`);
        return hit.intent;
    }
    return null;
}

function saveCachedIntent(text, intent) {
    // No cachear precios ni clima — datos en tiempo real
    if (/dolar|euro|bitcoin|crypto|precio|clima|temperatura|tiempo/i.test(text)) return;
    const key = normalizar(text);
    _cache.set(key, { intent, ts: Date.now() });
    // Limpiar entradas viejas ocasionalmente
    if (_cache.size > 200) {
        const ahora = Date.now();
        for (const [k, v] of _cache) {
            if (ahora - v.ts > CACHE_TTL) _cache.delete(k);
        }
        // Si sigue lleno, eliminar las más viejas hasta quedar en 150
        if (_cache.size > 200) {
            const sorted = [..._cache.entries()].sort((a,b) => a[1].ts - b[1].ts);
            sorted.slice(0, _cache.size - 150).forEach(([k]) => _cache.delete(k));
        }
    }
}

// ═══════════════════════════════════════
// REGLAS RÁPIDAS (sin LLM, ~0ms)
// ═══════════════════════════════════════
const RULES = [
    // Saludos
    {
        type: 'simple', subtype: 'saludo',
        regex: /^(hola|buenas|hey|hi|buenos (dias|tardes|noches)|que tal|como estas|como estas|cómo estás|cómo te va|qué tal|cómo andas)\b/i,
        response: () => '¡Hola! ¿En qué te puedo ayudar?'
    },
    // Precio crypto
    {
        type: 'tool', tool: 'buscar_precio',
        regex: /\b(bitcoin|btc|ethereum|eth|solana|sol|doge|xrp|bnb|ada)\b/i,
        extractInput: (t) => {
            const m = t.match(/\b(bitcoin|btc|ethereum|eth|solana|sol|doge|xrp|bnb|ada)\b/i);
            return m ? m[0].toLowerCase() : t;
        }
    },
    // Precio divisas / dólar
    {
        type: 'tool', tool: 'buscar_precio',
        regex: /\b(dolar|euro|libra|usd|eur|gbp|divisa|tipo de cambio|cambio)\b/i,
        extractInput: (t) => {
            const m = t.match(/\b(dolar|euro|libra|usd|eur|gbp)\b/i);
            return m ? m[0].toLowerCase() : 'dólar';
        }
    },
    // Precio genérico
    {
        type: 'tool', tool: 'buscar_precio',
        regex: /^(precio|cuanto (vale|cuesta|esta)|cotizacion)\b/i,
        extractInput: (t) => t.replace(/^(precio|cuanto vale|cuanto cuesta|cuanto esta|cotizacion)\s*/i,'').trim() || 'dólar'
    },
    // Clima — NO interceptar si es tarea de código/script
    {
        type: 'tool', tool: 'buscar_clima',
        regex: /\b(clima|temperatura|tiempo en|pronostico|lluvia|calor|frio)\b/i,
        guard: (t) => !/\b(script|python|código|programa|cpu del pi|raspberry|bash|node|javascript|\.py|\.js)\b/i.test(t),
        extractInput: (t) => {
            const mC = t.match(/(?:en|de|para)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/);
            if (mC) return mC[1];
            // Si no hay ciudad específica, usar Monterrey por defecto
            return 'Monterrey';
        }
    },
    // Estado sistema
    {
        type: 'tool', tool: 'estado_sistema',
        regex: /\b(estado del sistema|estado sistema|cpu|uso de ram|temperatura del pi|recursos del sistema)\b/i,
        guard: (t) => !/\b(script|python|crea|escribe|genera|programa|bash|node|\.py)\b/i.test(t),
        extractInput: () => ''
    },
    // Scheduler programar
    {
        type: 'scheduler', action: 'programar',
        regex: /\b(programa|programar)\s+cada\b/i
    },
    // Scheduler listar
    {
        type: 'scheduler', action: 'listar',
        regex: /\btareas\s+programadas\b|\bmis\s+tareas\b/i
    },
    // Scheduler cancelar
    {
        type: 'scheduler', action: 'cancelar',
        regex: /\b(cancela|borra|elimina)\s+(la\s+)?tarea\b|\bborrala\b|\bcancelala\b/i
    },

    // Home Assistant — controlar dispositivos del hogar
    {
        type: 'tool', tool: 'controlar_casa',
        regex: /\b(enciende|apaga|prende|luces|dispositivos|casa|home assistant|temperatura de la casa|resumen de la casa|listar dispositivos)\b/i,
        guard: (t) => !/\b(script|python|código|bash|node|\.py|\.sh)\b/i.test(t),
        extractInput: (t) => t.replace(/^bmo,?\s*/i, '').trim()
    },
    // Documentos interactivos — cartas, contratos, facturas
    {
        type: 'tool', tool: 'crear_documento_interactivo',
        regex: /\b(carta de recomendacion|carta de presentacion|contrato de servicios|factura|carta laboral)\b/i,
        extractInput: (t) => t.replace(/^bmo,?\s*/i, '').trim()
    },
    // Knowledge — guardar info que el usuario comparte (dispatch directo, sin agent loop)
    {
        type: 'tool', tool: 'knowledge_manager',
        regex: /\b(recuerda que|guarda que|anota que|aprende que|no olvides que|me llamo|mi nombre es|mi auto es|mi carro es|mi mascota es|vivo en|trabajo en|tengo un|soy tu creador)\b/i,
        extractInput: (t) => {
            const limpio = t.replace(/^(bmo,?\s*|oye,?\s*)/i, '').trim();
            return 'save|' + limpio + '|personal|3';
        },
        postMessage: '✅ Anotado. Lo recordaré para futuras conversaciones.'
    },
    // Check system health directo
    {
        type: 'tool', tool: 'check_system_health',
        regex: /\b(temperatura del (pi|raspberry|sistema)|uso de (cpu|ram|memoria)|espacio en disco|recursos del pi)\b/i,
        guard: (t) => !/\b(script|codigo|programa)\b/i.test(t),
        extractInput: () => ''
    },
];

// ═══════════════════════════════════════
// FALLBACK LLM — qwen2.5:1.5b via curl
// ═══════════════════════════════════════
const PROMPT_TEMPLATE = `Eres un clasificador de intención para un agente autónomo.
Clasifica el mensaje del usuario.

Opciones:
simple → saludo o conversación
tool → ejecutar herramienta directa
scheduler → programar tarea
agent → tarea compleja

Herramientas disponibles:
buscar_precio
buscar_clima
estado_sistema
controlar_casa
crear_documento_interactivo

Responde SOLO JSON válido.
Formato:
{"type":"tool|simple|scheduler|agent","tool":"nombre_o_null"}

Mensaje: "MENSAJE_AQUI"
JSON:`;

async function classifyWithLLM(text) {
    const tmpFile = `/tmp/intent_req_${Date.now()}.json`;
    try {
        const prompt = PROMPT_TEMPLATE.replace('MENSAJE_AQUI', text.slice(0, 120).replace(/"/g, "'"));
        const body = {
            model: 'qwen2.5:1.5b',
            prompt,
            stream: false,
            options: { temperature: 0, num_predict: 40 }
        };
        fs.writeFileSync(tmpFile, JSON.stringify(body));
        const { stdout } = await execAsync(
            `curl -s --max-time 3 "http://localhost:11434/api/generate" -H "Content-Type: application/json" -d @${tmpFile}`
        );
        try { fs.unlinkSync(tmpFile); } catch(e) {}

        const resp = JSON.parse(stdout);
        const raw = (resp.response || '').trim();

        // Extraer JSON de la respuesta
        const jsonMatch = raw.match(/\{[^}]+\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const type = parsed.type || 'agent';
            const tool = parsed.tool && parsed.tool !== 'null' ? parsed.tool : null;
            console.log(`[INTENT] LLM → ${type}${tool ? '/' + tool : ''}`);
            return { type, tool, input: text };
        }
    } catch(e) {
        try { fs.unlinkSync(tmpFile); } catch(_) {}
        if(process.env.DEBUG_INTENT) // LLM falló silenciosamente — fallback a agent
      if(false) console.log(`[INTENT] LLM falló (${e.message.slice(0,40)}), → agent`);
    }
    return { type: 'agent' };
}

// ═══════════════════════════════════════
// DETECTOR PRINCIPAL
// ═══════════════════════════════════════
export async function detectIntent(text) {
    const clean = text.replace(/^bmo,?\s*/i, '').trim();

    // Goals automáticos siempre van al agente
    if (text.startsWith('[AUTO]') || clean.startsWith('[AUTO]')) {
        console.log('[INTENT] agent → goal automático');
        return { type: 'agent' };
    }

    // Múltiples acciones → siempre agente (ej: "genera un reporte del clima")
    const verbosCreacion = /\b(genera|crea|elabora|redacta|escribe|prepara|hazme|haz|dame)\b/i;
    const verbosDocumento = /\b(reporte|informe|documento|resumen|word|excel|pdf|presentacion)\b/i;
    const verbosInvestiga = /\b(busca|investiga|analiza|consulta|revisa|compara)\b/i;

    if (verbosCreacion.test(clean) && verbosDocumento.test(clean)) {
        console.log('[INTENT] agent → crear documento detectado');
        return { type: 'agent' };
    }
    if (verbosCreacion.test(clean) && verbosInvestiga.test(clean)) {
        console.log('[INTENT] agent → múltiples acciones detectadas');
        return { type: 'agent' };
    }
    if (verbosInvestiga.test(clean) && verbosDocumento.test(clean)) {
        console.log('[INTENT] agent → investigar + documento');
        return { type: 'agent' };
    }

    // 1. Cache check — no usar cache para mensajes de código/script
    const esMensajeCodigo = /\b(script|python|código|programa|función|bash|node|javascript|\.py|\.sh|\.js|arregla|depura|refactoriza)\b/i.test(clean);
    const cached = esMensajeCodigo ? null : getCachedIntent(clean);
    if (cached) return cached;

    // 2. Reglas rápidas
    for (const rule of RULES) {
        if (rule.regex.test(clean) && (!rule.guard || rule.guard(clean))) {
            const result = {
                type:     rule.type,
                subtype:  rule.subtype  || null,
                tool:     rule.tool     || null,
                action:   rule.action   || null,
                input:    rule.extractInput ? rule.extractInput(clean) : clean,
                response: rule.response || null
            };
            console.log(`[INTENT] ${result.type}${result.tool ? ' → ' + result.tool : result.subtype ? ' → ' + result.subtype : result.action ? ' → ' + result.action : ''}`);
            saveCachedIntent(clean, result);
            return result;
        }
    }

    // 3. Heurística: mensajes cortos sin verbos de tarea → LLM rápido
    const verbosAgente = /hazme|haz|crea|genera|investiga|analiza|prepara|elabora|redacta|escribe|planifica|consigue/i;
    if (clean.length < 60 && !verbosAgente.test(clean)) {
        const result = await classifyWithLLM(clean);
        saveCachedIntent(clean, result);
        return result;
    }

    // 4. Default → agente completo
    console.log('[INTENT] agent → tarea compleja');
    return { type: 'agent' };
}

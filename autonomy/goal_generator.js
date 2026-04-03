import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import { crearGoal, listarGoals, listarGoalsTodos, getPendientes } from '../goals/goal_manager.js';
import { filtrarIdeas } from './goal_filter.js';

const execAsync = promisify(exec);
const ADMIN_ID = '100365164921028@lid';
const MAX_GOALS_DIA = 3;

export function goalsAutoHoy(userId) {
    const goals = listarGoalsTodos(userId);
    const hace24h = Date.now() - 24 * 60 * 60 * 1000;
    // Normalizar timestamp — puede estar en segundos o ms
    return goals.filter(g => {
        const ts = g.creado_en > 1e12 ? g.creado_en : g.creado_en * 1000;
        return ts > hace24h && g.objetivo.startsWith('[AUTO]');
    }).length;
}

export async function generarIdeasConMistral(temas) {
    if (!temas.length) return [];
    const tmpFile = `/tmp/goal_gen_${Date.now()}.json`;
    try {
        const prompt = `Analiza estos temas recientes de un agente autónomo: ${temas.slice(0,8).join(', ')}.

Genera exactamente 3 ideas de investigación útiles, concretas y distintas entre sí.
Responde SOLO JSON válido, sin texto extra:
["idea 1","idea 2","idea 3"]`;

        const body = {
            model: 'mistral-small-latest',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.7
        };

        const apiKey = process.env.MISTRAL_API_KEY || '';
        if (!apiKey) throw new Error('MISTRAL_API_KEY no configurada');
        fs.writeFileSync(tmpFile, JSON.stringify(body));
        const { stdout } = await execAsync(
            `curl -s --max-time 20 "https://api.mistral.ai/v1/chat/completions" ` +
            `-H "Content-Type: application/json" ` +
            `-H "Authorization: Bearer ${apiKey}" ` +
            `-d @${tmpFile}`
        );
        try { fs.unlinkSync(tmpFile); } catch(e) {}

        const resp = JSON.parse(stdout);
        const raw = resp.choices?.[0]?.message?.content || '[]';
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
            const ideas = JSON.parse(match[0]);
            return Array.isArray(ideas) ? ideas.filter(i => typeof i === 'string' && i.length > 10) : [];
        }
    } catch(e) {
        try { fs.unlinkSync(tmpFile); } catch(_) {}
        console.log('[GOAL_GEN] Error Mistral:', e.message.slice(0, 60));
    }
    return [];
}

export function ideaAGoal(idea) {
    // Convertir idea corta en objetivo ejecutable
    const verbo = idea.toLowerCase().startsWith('investig') ? 'investiga' :
                  idea.toLowerCase().startsWith('analiz')   ? 'analiza'   :
                  idea.toLowerCase().startsWith('busc')     ? 'busca'     : 'investiga';
    return `BMO ${verbo} ${idea.replace(/^(investiga|analiza|busca|explorar?)\s*/i,'').trim()} y resume los hallazgos más relevantes`;
}

export async function crearGoalsAutomaticos(temas, huecos, userId) {
    // No crear más goals si ya hay 2+ pendientes
    const pendientes = getPendientes ? getPendientes() : [];
    if (pendientes.length >= 2) {
        console.log(`[GOAL_GEN] ${pendientes.length} goals pendientes, omitiendo creación`);
        return [];
    }

    // No crear más de MAX_GOALS_DIA goals automáticos por día
    const autoHoy = goalsAutoHoy(userId);
    if (autoHoy >= MAX_GOALS_DIA) {
        console.log(`[GOAL_GEN] Límite diario alcanzado (${autoHoy}/${MAX_GOALS_DIA})`);
        return [];
    }

    // goal_filter maneja CPU, RAM y duplicados
    const ideasCrudas = [...huecos.slice(0, 2), ...(await generarIdeasConMistral(temas))];
    const todasLasIdeas = await filtrarIdeas(ideasCrudas);

    // Crear máximo 1 goal por ciclo
    const creados = [];
    for (const idea of todasLasIdeas.slice(0, 1)) {
        const objetivo = `[AUTO] ${ideaAGoal(idea)}`;
        const id = crearGoal(userId, objetivo);
        console.log(`[GOAL_GEN] Creado #${id}: ${objetivo.slice(0, 70)}`);
        creados.push({ id, objetivo });
    }
    return creados;
}

export async function generarGoalsDesdeHuecos(userId, huecos = [], temas = []) {
    try {
        const resultado = await crearGoalsAutomaticos(temas, huecos, userId);
        return resultado;
    } catch(e) {
        console.log('[GOAL_GEN] Error generarGoalsDesdeHuecos:', e.message);
        return null;
    }
}

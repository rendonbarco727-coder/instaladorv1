import { exec } from 'child_process';
import { promisify } from 'util';
import { listarGoals, listarGoalsTodos } from '../goals/goal_manager.js';

const execAsync = promisify(exec);
const ADMIN_ID = '100365164921028@lid';
const MAX_POR_CICLO = 3;
const MAX_POR_DIA = 6;

async function getRecursos() {
    try {
        const { stdout: cpuOut } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d. -f1");
        const { stdout: ramOut } = await execAsync("free | grep Mem | awk '{print int($3/$2*100)}'");
        return { cpu: parseInt(cpuOut.trim()) || 0, ram: parseInt(ramOut.trim()) || 0 };
    } catch(e) { return { cpu: 0, ram: 0 }; }
}

function goalsActivosHoy() {
    try {
        const goals = listarGoalsTodos(ADMIN_ID);
        const hace24h = Date.now() - 24 * 60 * 60 * 1000;
        return goals.filter(g => g.creado_en > hace24h && g.objetivo.startsWith('[AUTO]'));
    } catch(e) { return []; }
}

export async function filtrarIdeas(ideas) {
    console.log(`[GOAL FILTER] Ideas recibidas: ${ideas.length}`);

    // Regla 6 y 7: verificar recursos
    const { cpu, ram } = await getRecursos();
    if (cpu > 70) {
        console.log(`[GOAL FILTER] Bloqueado: CPU ${cpu}%`);
        return [];
    }
    if (ram > 80) {
        console.log(`[GOAL FILTER] Bloqueado: RAM ${ram}%`);
        return [];
    }

    // Regla 5: verificar límite diario
    const autoHoy = goalsActivosHoy();
    const disponibles = MAX_POR_DIA - autoHoy.length;
    if (disponibles <= 0) {
        console.log(`[GOAL FILTER] Límite diario (${MAX_POR_DIA}) alcanzado`);
        return [];
    }

    // Incluir goals completados en las últimas 48h para evitar repetición
    let todosLosGoals = [];
    try {
        const todosGoals = listarGoalsTodos(ADMIN_ID);
        const hace48h = Date.now() - 48 * 60 * 60 * 1000;
        todosLosGoals = todosGoals
            .filter(g => g.creado_en > hace48h && g.objetivo.startsWith('[AUTO]'))
            .map(g => normalizar(g.objetivo));
    } catch(e) {}
    const objetivosActivos = todosLosGoals;

    const vistas = new Set();
    const validas = [];

    for (const idea of ideas) {
        const texto = String(idea).trim();

        // Regla 1: mínimo 15 caracteres
        if (texto.length < 15) {
            console.log(`[GOAL FILTER] Descartada (corta): "${texto}"`);
            continue;
        }

        // Regla 2: sin duplicados dentro del lote
        const clave = normalizar(texto);
        if (vistas.has(clave)) {
            console.log(`[GOAL FILTER] Descartada (duplicada): "${texto.slice(0,40)}"`);
            continue;
        }

        // Regla 3: no existe ya como goal activo
        const yaExiste = objetivosActivos.some(obj => similitud(obj, clave) > 0.5);
        if (yaExiste) {
            console.log(`[GOAL FILTER] Descartada (ya existe): "${texto.slice(0,40)}"`);
            continue;
        }

        vistas.add(clave);
        validas.push(texto);

        // Regla 4: máximo por ciclo
        if (validas.length >= MAX_POR_CICLO) break;
    }

    // Aplicar límite diario disponible
    const resultado = validas.slice(0, Math.min(MAX_POR_CICLO, disponibles));
    console.log(`[GOAL FILTER] Ideas válidas: ${resultado.length}/${ideas.length}`);
    return resultado;
}

function normalizar(texto) {
    return texto.toLowerCase()
        .replace(/\[auto\]/gi, '')
        .replace(/bmo\s+(investiga|analiza|busca|explora)\s*/gi, '')
        .replace(/[^a-záéíóúüñ\s]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

// Similitud simple por palabras compartidas
function similitud(a, b) {
    const setA = new Set(a.split(' ').filter(p => p.length > 3));
    const setB = new Set(b.split(' ').filter(p => p.length > 3));
    if (!setA.size || !setB.size) return 0;
    const comunes = [...setA].filter(p => setB.has(p)).length;
    return comunes / Math.max(setA.size, setB.size);
}

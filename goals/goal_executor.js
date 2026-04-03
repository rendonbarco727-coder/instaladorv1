import { exec } from 'child_process';
import { promisify } from 'util';
import { getGoal, actualizarEstado, actualizarProgreso, marcarCompleto, marcarFallido, incrementarIntentos } from './goal_manager.js';
import { ejecutarAgente } from '../core/orchestrator.js';

const execAsync = promisify(exec);
const MAX_INTENTOS = 3;

async function getCPU() {
    try {
        const { stdout } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d. -f1");
        return parseInt(stdout.trim()) || 0;
    } catch(e) { return 0; }
}

export async function ejecutarGoal(goal, clienteWA) {
    if (!goal || !clienteWA) return;

    // Verificar CPU
    const cpu = await getCPU();
    if (cpu > 70) {
        console.log(`[GOAL] #${goal.id} pospuesto (CPU ${cpu}%)`);
        return;
    }

    // Verificar intentos
    if (goal.intentos >= MAX_INTENTOS) {
        marcarFallido(goal.id, `Máximo de ${MAX_INTENTOS} intentos alcanzado`);
        return;
    }

    console.log(`[GOAL] Ejecutando #${goal.id}: ${goal.objetivo.slice(0, 60)}`);
    actualizarEstado(goal.id, 'running');
    incrementarIntentos(goal.id);
    actualizarProgreso(goal.id, 10);

    try {
        await ejecutarAgente(goal.objetivo, goal.user_id, clienteWA);
        actualizarProgreso(goal.id, 80);
        marcarCompleto(goal.id, 'Objetivo ejecutado por el agente');

        // Notificar al usuario
        await clienteWA.sendMessage(goal.user_id,
            `✅ *Objetivo completado* #${goal.id}\n_${goal.objetivo.slice(0, 80)}_`
        ).catch(() => {});
    } catch(e) {
        console.error(`[GOAL] Error en #${goal.id}:`, e.message);
        marcarFallido(goal.id, e.message);
    }
}

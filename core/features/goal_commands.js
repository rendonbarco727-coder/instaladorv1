// core/features/goal_commands.js
import { CONFIG } from '../../config/bmo.config.js';
const esAutorizado = (id) => CONFIG.admin_ids.includes(id.replace('@lid','').replace('@c.us','')) || id === CONFIG.admin_wa;
import { listarGoals, getGoal, actualizarEstado, formatearGoals } from '../../goals/goal_manager.js';
import { ejecutarGoal } from '../../goals/goal_executor.js';
import { forzarCiclo } from '../../autonomy/autonomous_loop.js';

export async function handleGoalCommands(userMessage, id, client) {
  if (!esAutorizado(id)) return false;

  // Forzar ciclo autonomo
  if (/BMO,?\s+(ciclo autonomo|autonomy|fuerza ciclo|ciclo manual)/i.test(userMessage)) {
    await client.sendMessage(id, '🔄 Iniciando ciclo autónomo...');
    forzarCiclo().catch(() => {});
    return true;
  }

  // BMO, mis objetivos
  if (/BMO,?\s+mis objetivos/i.test(userMessage)) {
    const goals = listarGoals(id);
    await client.sendMessage(id, formatearGoals(goals));
    return true;
  }

  // BMO, cancela objetivo N
  const matchCancela = userMessage.match(/BMO,?\s+cancela\s+objetivo\s+(\d+)/i);
  if (matchCancela) {
    const goal = getGoal(parseInt(matchCancela[1]));
    if (goal && goal.user_id === id) {
      actualizarEstado(goal.id, 'failed');
      await client.sendMessage(id, `✅ Objetivo #${goal.id} cancelado.`);
    } else {
      await client.sendMessage(id, 'No encontré ese objetivo.');
    }
    return true;
  }

  // BMO, progreso objetivo N
  const matchProgreso = userMessage.match(/BMO,?\s+progreso\s+objetivo\s+(\d+)/i);
  if (matchProgreso) {
    const goal = getGoal(parseInt(matchProgreso[1]));
    if (goal && goal.user_id === id) {
      await client.sendMessage(id, `*Objetivo #${goal.id}*\n${goal.objetivo}\nEstado: ${goal.estado}\nProgreso: ${goal.progreso}%\n${goal.resultado ? 'Resultado: ' + goal.resultado : ''}`);
    } else {
      await client.sendMessage(id, 'No encontré ese objetivo.');
    }
    return true;
  }

  // BMO, ejecuta objetivo N
  const matchEjecuta = userMessage.match(/BMO,?\s+ejecuta\s+objetivo\s+(\d+)/i);
  if (matchEjecuta) {
    const goal = getGoal(parseInt(matchEjecuta[1]));
    if (goal && goal.user_id === id) {
      await client.sendMessage(id, `🔄 Ejecutando objetivo #${goal.id}...`);
      ejecutarGoal(goal, client).catch(() => {});
    } else {
      await client.sendMessage(id, 'No encontré ese objetivo.');
    }
    return true;
  }

  return false;
}

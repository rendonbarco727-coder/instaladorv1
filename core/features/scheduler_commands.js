// core/features/scheduler_commands.js
import { CONFIG } from '../../config/bmo.config.js';
const esAutorizado = (id) => CONFIG.admin_ids.includes(id.replace('@lid','').replace('@c.us','')) || id === CONFIG.admin_wa;
import { programarTarea, cancelarTarea, listarTareas } from '../scheduler.js';

export async function handleSchedulerCommands(userMessage, id, client) {
  if (!esAutorizado(id)) return false;

  // BMO, programa cada X: objetivo
  const matchPrograma = userMessage.match(/BMO,?\s+programa\s+cada\s+(\d+)\s*(min|hora|h|m)[^:]*:\s*(.+)/i);
  if (matchPrograma) {
    const cantidad = parseInt(matchPrograma[1]);
    const unidad = matchPrograma[2].toLowerCase();
    const objetivo = matchPrograma[3].trim();
    const ms = unidad.startsWith('h') ? cantidad * 60 * 60 * 1000 : cantidad * 60 * 1000;
    const taskId = `tarea_${Date.now()}`;
    programarTarea(taskId, objetivo.slice(0,30), objetivo, { delayMs: ms, unaVez: false });
    await client.sendMessage(id, `✅ Tarea programada cada ${cantidad} ${unidad}: "${objetivo}"`);
    return true;
  }

  // Cancelar tarea
  if (/BMO,?\s+(cancela|borra|elimina)\s+tarea\s*(\d+)?/i.test(userMessage) ||
      /BMO,?\s+(borrala|cancelala|eliminala)/i.test(userMessage)) {
    const tareas = listarTareas();
    const numMatch = userMessage.match(/\d+/);
    const idx = numMatch ? parseInt(numMatch[0]) - 1 : 0;
    if (tareas[idx]) {
      cancelarTarea(tareas[idx].id);
      await client.sendMessage(id, `✅ Tarea cancelada: "${tareas[idx].nombre}"`);
    } else {
      await client.sendMessage(id, 'No encontré esa tarea. Usa "BMO, tareas programadas" para ver la lista.');
    }
    return true;
  }

  // BMO, tareas programadas
  if (/BMO,?\s+(tareas programadas|mis tareas|scheduler)/i.test(userMessage)) {
    const tareas = listarTareas();
    if (!tareas.length) {
      await client.sendMessage(id, 'No hay tareas programadas.');
    } else {
      const lista = tareas.map((t,i) => (i+1) + '. ' + t.nombre + ' (proxima: ' + new Date(t.proximaEjecucion).toLocaleTimeString() + ')').join('\n');
      await client.sendMessage(id, "📋 *Tareas programadas:*\n" + lista);
    }
    return true;
  }

  return false;
}

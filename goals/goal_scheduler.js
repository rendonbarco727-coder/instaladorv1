import { getPendientes } from './goal_manager.js';
import { ejecutarGoal } from './goal_executor.js';
import { ROOT_DIR } from '../config/bmo.config.js';

const INTERVALO_MS = 10 * 60 * 1000; // cada 10 min
let _intervalo = null;
let _clienteWA = null;
let _ejecutando = false; // Lock anti race condition

export function iniciarGoalScheduler(clienteWA) {
    _clienteWA = clienteWA;
    if (_intervalo) return;
    _intervalo = setInterval(revisarGoals, INTERVALO_MS);
    console.log('[GOAL_SCHEDULER] Iniciado, intervalo 10min');
}

async function revisarGoals() {
    if (!_clienteWA) return;
    if (_ejecutando) { console.log('[GOAL_SCHEDULER] Ya hay un goal en ejecución, saltando ciclo'); return; }

    // 1. Limpiar tasks huérfanas viejas (más de 1h con RESULTADO_ sin resolver)
    try {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(`${ROOT_DIR}/memory/bmo_memory.db`);
        db.pragma('journal_mode = WAL');
        const limpiadas = db.prepare(
            "UPDATE tasks SET estado='failed', resultado='Sesión expirada' WHERE estado='pending' AND input LIKE 'RESULTADO_%' AND creado < ?"
        ).run(Date.now() - 3600000);
        if (limpiadas.changes > 0) console.log(`[GOAL_SCHEDULER] ${limpiadas.changes} tasks huérfanas limpiadas`);
    } catch(e) {}

    // 2. Ejecutar goals pendientes
    const pendientes = getPendientes();
    if (!pendientes.length) return;
    console.log(`[GOAL_SCHEDULER] ${pendientes.length} goals pendientes`);
    const goal = pendientes[0];
    _ejecutando = true;
    try {
        await ejecutarGoal(goal, _clienteWA);
    } finally {
        _ejecutando = false;
    }
}

export function detenerGoalScheduler() {
    if (_intervalo) { clearInterval(_intervalo); _intervalo = null; }
}

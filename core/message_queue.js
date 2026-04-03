/**
 * MessageQueue — serializa mensajes por sesión (estilo OpenClaw)
 * Evita condiciones de carrera cuando llegan mensajes simultáneos
 */

const queues = new Map(); // userId → Promise (cola activa)

/**
 * Encola un mensaje para un usuario específico.
 * Si ya hay un mensaje procesándose, espera a que termine.
 */
export async function enqueue(userId, fn) {
    const current = queues.get(userId) || Promise.resolve();
    const next = current.then(() => fn()).catch(err => {
        console.error(`[QUEUE] Error procesando mensaje de ${userId}:`, err.message);
    });
    queues.set(userId, next);
    // Limpiar la referencia cuando termine para no acumular memoria
    next.finally(() => {
        if (queues.get(userId) === next) queues.delete(userId);
    });
    return next;
}

/**
 * Ver estado actual de las colas
 */
export function estadoColas() {
    return { activas: queues.size, usuarios: [...queues.keys()] };
}

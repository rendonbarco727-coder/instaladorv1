// Sistema de señales de cancelación por usuario
const cancelSignals = new Map(); // userId → timestamp

export function setCancelSignal(userId) {
    cancelSignals.set(userId, Date.now());
    console.log(`[CANCEL] Señal de cancelación para ${userId}`);
}

export function checkCancelled(userId) {
    const ts = cancelSignals.get(userId);
    if (!ts) return false;
    if (Date.now() - ts > 5 * 60 * 1000) { cancelSignals.delete(userId); return false; }
    return true;
}

export function clearCancelSignal(userId) {
    cancelSignals.delete(userId);
}

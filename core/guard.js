// Guard — filtra mensajes antes de procesarlos
const userCooldowns = new Map(); // userId → timestamp último mensaje
const userMsgCount = new Map();  // userId → {count, windowStart}
const blockedUsers = new Set();

const RATE_LIMIT = 8;        // max mensajes por ventana
const RATE_WINDOW = 60000;   // ventana de 60 segundos
const COOLDOWN_MS = 800;     // mínimo entre mensajes

export function checkGuard(userId, mensaje) {
    // Usuario bloqueado
    if (blockedUsers.has(userId)) return { ok: false, reason: 'blocked' };

    const now = Date.now();

    // Cooldown entre mensajes
    const lastMsg = userCooldowns.get(userId) || 0;
    if (now - lastMsg < COOLDOWN_MS) return { ok: false, reason: 'cooldown' };

    // Rate limit por ventana
    let stats = userMsgCount.get(userId) || { count: 0, windowStart: now };
    if (now - stats.windowStart > RATE_WINDOW) {
        stats = { count: 0, windowStart: now };
    }
    stats.count++;
    userMsgCount.set(userId, stats);

    if (stats.count > RATE_LIMIT) {
        const remaining = Math.ceil((RATE_WINDOW - (now - stats.windowStart)) / 1000);
        return { ok: false, reason: 'rate_limit', remaining };
    }

    // Mensaje vacío o muy corto
    if (!mensaje || mensaje.trim().length < 1) return { ok: false, reason: 'empty' };

    // Mensaje demasiado largo (posible spam)
    if (mensaje.length > 4000) return { ok: false, reason: 'too_long' };

    userCooldowns.set(userId, now);
    limpiarMaps();
    return { ok: true };
}

export function blockUser(userId, ms = 300000) {
    blockedUsers.add(userId);
    setTimeout(() => blockedUsers.delete(userId), ms);
}

export function resetUser(userId) {
    userCooldowns.delete(userId);
    userMsgCount.delete(userId);
    blockedUsers.delete(userId);
}

// Limpiar entradas viejas cada 100 llamadas
let _llamadas = 0;
function limpiarMaps() {
    if (++_llamadas % 100 !== 0) return;
    const now = Date.now();
    for (const [k, v] of userMsgCount) {
        if (now - v.windowStart > RATE_WINDOW * 2) userMsgCount.delete(k);
    }
    for (const [k, v] of userCooldowns) {
        if (now - v > RATE_WINDOW) userCooldowns.delete(k);
    }
}

export function getStats() {
    return { active: userMsgCount.size, blocked: blockedUsers.size };
}

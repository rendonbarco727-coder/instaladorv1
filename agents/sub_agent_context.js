// Contexto compartido entre sub-agentes de la misma sesión
const contextos = new Map();

export function crearContexto(sesionId) {
    const ctx = {
        sesionId,
        datos: {},
        mensajes: [],
        timestamp: Date.now()
    };
    contextos.set(sesionId, ctx);
    return ctx;
}

export function getContexto(sesionId) {
    return contextos.get(sesionId) || crearContexto(sesionId);
}

export function setDato(sesionId, clave, valor) {
    const ctx = getContexto(sesionId);
    ctx.datos[clave] = valor;
    console.log(`[CTX:${sesionId.slice(-6)}] ${clave} = ${String(valor).slice(0,60)}`);
}

export function getDato(sesionId, clave) {
    return contextos.get(sesionId)?.datos?.[clave];
}

export function agregarMensaje(sesionId, rol, contenido) {
    const ctx = getContexto(sesionId);
    ctx.mensajes.push({ rol, contenido: contenido.slice(0, 500), ts: Date.now() });
    if (ctx.mensajes.length > 20) ctx.mensajes.shift();
}

export function getResumen(sesionId) {
    const ctx = contextos.get(sesionId);
    if (!ctx) return '';
    const datos = Object.entries(ctx.datos)
        .map(([k,v]) => `${k}: ${String(v).slice(0,100)}`)
        .join('\n');
    return datos;
}

export function limpiarContexto(sesionId) {
    contextos.delete(sesionId);
}

// Limpiar contextos viejos cada 30 min
setInterval(() => {
    const limite = Date.now() - 30 * 60 * 1000;
    for (const [id, ctx] of contextos) {
        if (ctx.timestamp < limite) contextos.delete(id);
    }
}, 30 * 60 * 1000);

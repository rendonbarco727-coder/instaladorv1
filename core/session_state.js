import { saveLongTerm, getLongTerm } from '../memory/memory_manager.js';

// Estado en memoria (rápido) + persistido en SQLite (sobrevive reinicios)
const estadoActual = new Map();

export function setEstadoSesion(userId, estado) {
    estadoActual.set(userId, { ...estado, ts: Date.now() });
    saveLongTerm(userId, 'estado_sesion', JSON.stringify(estado), 5);
}

export function getEstadoSesion(userId) {
    // Primero memoria
    if (estadoActual.has(userId)) return estadoActual.get(userId);
    // Luego SQLite
    try {
        const items = getLongTerm(userId, 5).filter(i => i.tipo === 'estado_sesion');
        if (items.length) return JSON.parse(items[0].contenido);
    } catch(e) {}
    return null;
}

export function actualizarProgreso(userId, paso, total, descripcion) {
    const estado = getEstadoSesion(userId) || {};
    setEstadoSesion(userId, {
        ...estado,
        pasoActual: paso,
        totalPasos: total,
        descripcionActual: descripcion,
        porcentaje: Math.round((paso/total)*100)
    });
}

export function iniciarTareaGlobal(userId, objetivo, pasos) {
    const listaPasos = pasos.map(p => p.descripcion || p.accion);
    setEstadoSesion(userId, {
        objetivo: objetivo.slice(0,100),
        pasos: listaPasos,
        pasoActual: 1,
        totalPasos: pasos.length,
        porcentaje: Math.round((1/Math.max(pasos.length,1))*100),
        descripcionActual: listaPasos[0] || 'Iniciando...',
        iniciado: Date.now(),
        estado: 'ejecutando'
    });
}

export function finalizarTareaGlobal(userId) {
    const estado = getEstadoSesion(userId) || {};
    setEstadoSesion(userId, { ...estado, estado: 'completado', finalizado: Date.now() });
}

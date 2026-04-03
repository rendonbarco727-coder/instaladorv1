import { saveLongTerm, getLongTerm } from '../memory/memory_manager.js';
import fs from 'fs';

// Guardar documento con metadata
export function registrarDocumento(userId, ruta, titulo, tipo) {
    const id = `doc_${Date.now()}`;
    const meta = { id, ruta, titulo, tipo, creado: Date.now(), userId };
    saveLongTerm(userId, 'documento', JSON.stringify(meta), 5);
    console.log(`[DOC_MGR] Registrado: ${id} → ${ruta}`);
    return id;
}

// Listar documentos del usuario (últimos 20)
export function listarDocumentos(userId) {
    const items = getLongTerm(userId, 50).filter(i => i.tipo === 'documento');
    return items.map(i => {
        try { return JSON.parse(i.contenido); } catch { return null; }
    }).filter(Boolean).filter(d => fs.existsSync(d.ruta));
}

// Buscar documento por ID o título
export function buscarDocumento(userId, query) {
    const docs = listarDocumentos(userId);
    const q = query.toLowerCase();
    return docs.find(d =>
        d.id === query ||
        d.titulo?.toLowerCase().includes(q) ||
        d.ruta?.includes(q)
    );
}

// Eliminar documento
export function eliminarDocumento(userId, query) {
    const doc = buscarDocumento(userId, query);
    if (!doc) return null;
    try { fs.unlinkSync(doc.ruta); } catch {}
    return doc;
}

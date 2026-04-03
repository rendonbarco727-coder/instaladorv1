import { appendFileSync } from 'fs';

const EVENT_PIPE = '/tmp/bmo_events.pipe';

export function emitirEvento(tipo, datos) {
    try {
        const line = JSON.stringify({ tipo, datos, ts: Date.now() }) + '\n';
        appendFileSync(EVENT_PIPE, line);
    } catch(e) {}
}

export function agregarCliente() {}
export function removerCliente() {}
export function totalClientes() { return 0; }

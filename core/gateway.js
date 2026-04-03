/**
 * BMO Gateway — Control plane compatible con protocolo OpenClaw
 * ws://127.0.0.1:18790/ws
 * Protocol version 3
 */
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { ejecutarAgente } from './orchestrator.js';
import { estadoColas } from './message_queue.js';
import { listarTareas } from './scheduler.js';
import { getPendientes } from '../goals/goal_manager.js';
import { estadoCache } from '../reasoning_cache/cache.js';
import { listarSkills, getSkill, buscarSkillEnHub, registrarSkill } from '../skills/skill_registry.js';
import { getMetricasResumen, getToolStats } from '../observability/metrics.js';
import { getErroresRecientes } from '../observability/errors.js';

const GATEWAY_PORT = 18790;
const PROTOCOL_VERSION = 3;
const GATEWAY_TOKEN = process.env.BMO_GATEWAY_TOKEN || 'bmo-local-token';

let _wss = null;
let _clienteWA = null;
let _adminId = null;

export function iniciarGateway(clienteWA, adminId) {
    _clienteWA = clienteWA;
    _adminId = adminId;

    _wss = new WebSocketServer({ 
        host: '127.0.0.1', 
        port: GATEWAY_PORT,
        path: '/ws'
    });

    _wss.on('connection', (ws) => {
        console.log('[GATEWAY] Cliente conectado');
        let autenticado = false;

        // Challenge al conectar
        ws.send(JSON.stringify({
            type: 'event',
            event: 'connect.challenge',
            payload: { nonce: Date.now().toString(), ts: Date.now(), protocol: PROTOCOL_VERSION }
        }));

        ws.on('message', async (raw) => {
            let frame;
            try { frame = JSON.parse(raw); } catch(e) { return; }

            // Autenticación
            if (frame.type === 'connect.auth') {
                if (frame.token === GATEWAY_TOKEN || frame.token === 'local') {
                    autenticado = true;
                    ws.send(JSON.stringify({
                        type: 'event',
                        event: 'connect.ok',
                        payload: { protocol: PROTOCOL_VERSION, agent: 'BMO' }
                    }));
                    // Enviar snapshot inicial
                    ws.send(JSON.stringify({
                        type: 'event',
                        event: 'snapshot',
                        payload: await getSnapshot()
                    }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', code: 'AUTH_TOKEN_MISMATCH' }));
                    ws.close();
                }
                return;
            }

            if (!autenticado) {
                ws.send(JSON.stringify({ type: 'error', code: 'NOT_AUTHENTICATED' }));
                return;
            }

            // Manejar RPC requests
            await handleRPC(ws, frame);
        });

        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('close', () => console.log('[GATEWAY] Cliente desconectado'));
        ws.on('error', (e) => console.log('[GATEWAY] Error:', e.message));
    });

    _wss.on('listening', () => {
        console.log(`[GATEWAY] Escuchando en ws://127.0.0.1:${GATEWAY_PORT}/ws`);
    });
    // Heartbeat para detectar clientes zombie
    const heartbeatInterval = setInterval(() => {
        _wss.clients.forEach(ws => {
            if (ws.isAlive === false) { ws.terminate(); return; }
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);
    _wss.on('close', () => clearInterval(heartbeatInterval));


    // HTTP Webhook server en puerto 18791
    const webhookServer = http.createServer(async (req, res) => {
        if (req.method !== 'POST') {
            res.writeHead(405); res.end('Method Not Allowed');
            return;
        }

        // Verificar token
        const token = req.headers['x-bmo-token'] || req.headers['authorization']?.replace('Bearer ', '');
        if (token !== GATEWAY_TOKEN && token !== 'local') {
            res.writeHead(401); res.end('Unauthorized');
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const payload = JSON.parse(body);
                const { message, source = 'webhook', session = 'main' } = payload;

                if (!message) {
                    res.writeHead(400); res.end(JSON.stringify({ error: 'message requerido' }));
                    return;
                }

                console.log(`[WEBHOOK] ${source}: ${String(message).slice(0, 60)}`);

                // Ejecutar en background
                ejecutarAgente(message, _adminId, _clienteWA)
                    .then(resultado => {
                        broadcastEvento('webhook.result', { source, message, resultado });
                    })
                    .catch(e => console.error('[WEBHOOK] Error:', e.message));

                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'accepted', source, session }));
            } catch(e) {
                res.writeHead(400); res.end(JSON.stringify({ error: e.message }));
            }
        });
    });

    webhookServer.listen(18791, '0.0.0.0', () => {
        console.log('[WEBHOOK] HTTP server en http://0.0.0.0:18791');
    });

    _wss.on('error', (e) => {
        console.error('[GATEWAY] Error al iniciar:', e.message);
    });
}

async function handleRPC(ws, frame) {
    const { type, id, data } = frame;

    const safeSend = (obj) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(JSON.stringify(obj)); } catch(e) { console.error('[GATEWAY] safeSend error:', e.message); }
    };
    const respond = (payload) => safeSend({ type: 'response', id, payload });
    const error = (msg) => safeSend({ type: 'error', id, message: msg });

    try {
        switch(type) {
            // Enviar mensaje al agente
            case 'agent.send': {
                const { message, session = 'main' } = data || {};
                if (!message) return error('message requerido');
                console.log(`[GATEWAY] agent.send: ${message.slice(0,60)}`);
                const resultado = await ejecutarAgente(message, _adminId, _clienteWA);
                respond({ result: resultado, session });
                break;
            }

            // Estado del sistema
            case 'health':
                respond(await getSnapshot());
                break;

            // Listar tareas programadas
            case 'scheduler.list':
                respond({ tasks: listarTareas() });
                break;

            // Listar goals
            case 'goals.list':
                respond({ goals: getPendientes() });
                break;

            // Estado de colas
            case 'queue.status':
                respond(estadoColas());
                break;

            // Ping
            case 'ping':
                respond({ pong: true, ts: Date.now() });
                break;

            // Skills
            case 'skills.list':
                respond({ skills: listarSkills() });
                break;

            case 'skills.get': {
                const { nombre } = data || {};
                if (!nombre) return error('nombre requerido');
                const skill = getSkill(nombre);
                respond(skill ? { skill } : { skill: null, error: 'no encontrada' });
                break;
            }

            case 'skills.install': {
                const { objetivo } = data || {};
                if (!objetivo) return error('objetivo requerido');
                const encontrada = await buscarSkillEnHub(objetivo);
                respond(encontrada ? { instalada: true, skill: encontrada } : { instalada: false });
                break;
            }

            default:
                error(`Método desconocido: ${type}`);
        }
    } catch(e) {
        error(e.message);
    }
}

async function getSnapshot() {
    const [metricas, toolStats, errores] = await Promise.all([
        Promise.resolve(getMetricasResumen(24)),
        Promise.resolve(getToolStats(24)),
        Promise.resolve(getErroresRecientes(3))
    ]);
    return {
        agent: 'BMO',
        version: '1.0.0',
        protocol: PROTOCOL_VERSION,
        status: 'running',
        ts: Date.now(),
        queue: estadoColas(),
        cache: estadoCache(),
        goals: getPendientes().length,
        scheduler: listarTareas().length,
        skills: listarSkills().length,
        metricas24h: metricas,
        topTools: toolStats.slice(0, 5),
        erroresRecientes: errores.length
    };
}

// Broadcast evento a todos los clientes conectados
export function broadcastEvento(event, payload) {
    if (!_wss) return;
    const frame = JSON.stringify({ type: 'event', event, payload });
    _wss.clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    });
}

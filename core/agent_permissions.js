/**
 * AgentPermissions — sistema de permisos compatible con formato OpenClaw AGENTS.md
 * Controla qué tools puede usar cada agente
 */
import { readFileSync, existsSync } from 'fs';
import { ROOT_DIR } from '../config/bmo.config.js';

// Permisos por agente (puede ser sobreescrito por AGENTS.md)
const PERMISSIONS = {
    research_agent: {
        allow: ['buscar_web', 'buscar_web_exa', 'leer_web', 'buscar_precio', 'buscar_clima', 'enviar_mensaje'],
        deny: ['ejecutar_terminal', 'ejecutar_codigo', 'escribir_archivo', 'instalar_software']
    },
    memory_agent: {
        allow: ['memory_search', 'recall_tasks', 'gestionar_goals', 'enviar_mensaje'],
        deny: ['ejecutar_terminal', 'ejecutar_codigo']
    },
    reflection_agent: {
        allow: ['memory_search', 'generar_contenido', 'enviar_mensaje'],
        deny: ['ejecutar_terminal', 'ejecutar_codigo', 'escribir_archivo']
    },
    executor_agent: {
        allow: null, // todas
        deny: []
    },
    planner_agent: {
        allow: null, // todas
        deny: []
    }
};

// Paths denegados globalmente
const PATHS_DENY = [
    `${ROOT_DIR}/.env`,
    `${ROOT_DIR}/config/`,
    '/.ssh/',
    '/etc/passwd',
    '/etc/shadow'
];

/**
 * Verifica si un agente puede usar una tool específica
 */
export function puedeUsarTool(agenteName, toolName) {
    const perms = PERMISSIONS[agenteName];
    if (!perms) return true; // agente desconocido = permitir todo

    // deny gana siempre (como OpenClaw)
    if (perms.deny?.includes(toolName)) {
        console.log(`[PERMISSIONS] ${agenteName} no puede usar ${toolName} (denegado)`);
        return false;
    }

    // allow null = todas permitidas
    if (perms.allow === null) return true;

    return perms.allow.includes(toolName);
}

/**
 * Filtra un plan para que solo incluya tools permitidas para el agente
 */
export function filtrarPlanPorPermisos(plan, agenteName) {
    return plan.filter(paso => {
        const permitido = puedeUsarTool(agenteName, paso.accion);
        if (!permitido) {
            console.log(`[PERMISSIONS] Paso bloqueado: ${paso.accion} para ${agenteName}`);
        }
        return permitido;
    });
}

/**
 * Verifica si una ruta es segura para acceder
 */
export function rutaSegura(ruta) {
    return !PATHS_DENY.some(denied => ruta.includes(denied));
}

/**
 * Lista las tools permitidas para un agente
 */
export function toolsPermitidas(agenteName, todasLasTools) {
    const perms = PERMISSIONS[agenteName];
    if (!perms || perms.allow === null) return todasLasTools;
    return todasLasTools.filter(t => puedeUsarTool(agenteName, t));
}

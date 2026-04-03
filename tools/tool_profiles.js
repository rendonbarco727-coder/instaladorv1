/**
 * Tool Profiles — carga solo las tools relevantes por tipo de tarea (estilo OpenClaw)
 * Reduce tokens y evita confusión al modelo
 */

export const PROFILES = {
    // Búsqueda e información
    research: [
        'buscar_web', 'buscar_web_exa', 'leer_web', 'buscar_precio', 
        'buscar_clima', 'enviar_mensaje'
    ],
    
    // Sistema y terminal
    sistema: [
        'ejecutar_terminal', 'ejecutar_codigo', 'check_system_health',
        'estado_actual', 'manage_disk_storage', 'enviar_mensaje'
    ],
    
    // Código y desarrollo
    codigo: [
        'ejecutar_codigo', 'ejecutar_terminal', 'leer_archivo_proyecto',
        'escribir_archivo', 'code_agent', 'github_manager', 'commit_github',
        'web_project_builder', 'enviar_mensaje'
    ],
    
    // Documentos y archivos
    documentos: [
        'crear_documento_writer', 'crear_excel', 'crear_presentacion',
        'gestionar_documentos', 'leer_archivo', 'escribir_archivo',
        'gestionar_goals', 'enviar_mensaje'
    ],
    
    // Goals y memoria
    goals: [
        'gestionar_goals', 'memory_search', 'recall_tasks', 
        'estado_actual', 'enviar_mensaje'
    ],
    
    // Conversación general
    conversacion: [
        'generar_contenido', 'memory_search', 'buscar_web',
        'enviar_mensaje', 'gestionar_goals'
    ],
    
    // Perfil completo (para tareas complejas)
    completo: null // null = todas las tools
};

/**
 * Obtiene las tools para un perfil dado
 */
export function getToolsParaPerfil(perfil = 'completo', todasLasTools = []) {
    const lista = PROFILES[perfil];
    if (!lista) return todasLasTools; // completo = todas
    return todasLasTools.filter(t => lista.includes(t.nombre || t));
}

/**
 * Detecta el perfil más adecuado según la intención
 */
export function detectarPerfil(intencion) {
    const mapa = {
        'busqueda': 'research',
        'investigar': 'research',
        'sistema': 'sistema',
        'listar_sistema': 'sistema',
        'codigo': 'codigo',
        'proyecto_web': 'codigo',
        'documento': 'documentos',
        'gestionar_goals': 'goals',
        'conversacion': 'conversacion',
        'complex': 'completo'
    };
    return mapa[intencion] || 'completo';
}

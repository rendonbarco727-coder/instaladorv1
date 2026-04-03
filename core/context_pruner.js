/**
 * ContextPruner — recorta tool results antes de enviar al LLM (estilo OpenClaw)
 * Implementa: context_before_request + tool_result_transform hooks
 */

const MAX_TOOL_RESULT_CHARS = 1500;  // máximo por resultado de tool
const MAX_HISTORIAL_TOKENS = 8000;   // estimado de tokens máximo

/**
 * tool_result_transform hook — trunca resultados verbosos
 * Se llama después de ejecutar cada tool
 */
export function transformarResultadoTool(toolName, result) {
    if (!result || typeof result !== 'string') return result;

    // Tools que pueden generar output muy largo
    const toolsVerbosas = ['ejecutar_terminal', 'leer_web', 'buscar_web_exa', 
                           'buscar_web', 'leer_archivo', 'github_manager'];

    if (toolsVerbosas.includes(toolName) && result.length > MAX_TOOL_RESULT_CHARS) {
        const truncado = result.slice(0, MAX_TOOL_RESULT_CHARS);
        console.log(`[PRUNER] tool_result_transform: ${toolName} truncado ${result.length}→${MAX_TOOL_RESULT_CHARS} chars`);
        return truncado + `\n...[truncado, ${result.length - MAX_TOOL_RESULT_CHARS} chars más]`;
    }
    return result;
}

/**
 * context_before_request hook — limpia el historial antes de enviarlo al LLM
 * Elimina tool results redundantes y entradas muy viejas
 */
export function podarContexto(historial) {
    if (!historial || historial.length <= 6) return historial; // conservar últimos 6 siempre

    // Estimar tokens (aprox 4 chars = 1 token)
    const estimarTokens = (entries) => entries.reduce((sum, e) => sum + (e.content?.length || 0), 0) / 4;

    let podado = [...historial];
    const totalTokens = estimarTokens(podado);

    if (totalTokens <= MAX_HISTORIAL_TOKENS) return historial; // no necesita poda

    console.log(`[PRUNER] context_before_request: ${Math.round(totalTokens)} tokens estimados, podando...`);

    // Estrategia 1: Truncar contenido largo de mensajes viejos (excepto últimos 4)
    const limite = podado.length - 4;
    for (let i = 0; i < limite; i++) {
        if (podado[i].content && podado[i].content.length > 500) {
            podado[i] = { ...podado[i], content: podado[i].content.slice(0, 500) + '...[resumido]' };
        }
    }

    // Estrategia 2: Si sigue siendo muy largo, eliminar entradas antiguas
    while (estimarTokens(podado) > MAX_HISTORIAL_TOKENS && podado.length > 6) {
        podado.splice(0, 2); // eliminar las 2 más viejas
    }

    console.log(`[PRUNER] Contexto podado: ${historial.length}→${podado.length} entradas`);
    return podado;
}

/**
 * Reportar estado del contexto (como /context en OpenClaw)
 */
export function reportarContexto(historial, tools = []) {
    const chars = historial.reduce((sum, e) => sum + (e.content?.length || 0), 0);
    const tokensEstimados = Math.round(chars / 4);
    return {
        entradas: historial.length,
        charsTotal: chars,
        tokensEstimados,
        tools: tools.length,
        estado: tokensEstimados > MAX_HISTORIAL_TOKENS ? 'LLENO' : tokensEstimados > MAX_HISTORIAL_TOKENS * 0.7 ? 'ALTO' : 'OK'
    };
}

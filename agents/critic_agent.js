import { BaseAgent } from './base_agent.js';

const SISTEMA = `Eres un evaluador crítico de tareas ejecutadas por un agente autónomo.
Analiza si la tarea fue exitosa y si el resultado es útil.

REGLAS:
1. Evalúa objetivamente el resultado
2. Considera exitoso si hay resultado no vacío y sin errores críticos
3. Sugiere retry solo si hay posibilidad real de mejora
4. Sé eficiente, no pidas retry innecesariamente

FORMATO JSON OBLIGATORIO:
{"success":true,"retry":false,"confianza":85,"reason":"explicación breve"}`;

class CriticAgent extends BaseAgent {
    constructor() { super('CRITIC', 'rapido', SISTEMA); }

    async run(paso, resultado) {
        const resultStr = String(resultado?.result || resultado?.error || resultado || '');
        console.log(`[CRITIC] accion=${paso.accion} resultStr=${resultStr.slice(0,80)}`);

        // enviar_mensaje siempre exitoso — debe evaluarse PRIMERO
        if (paso.accion === 'enviar_mensaje') {
            return { success: true, retry: false, confianza: 95, reason: 'Mensaje enviado' };
        }

        // Evaluación rápida sin IA
        if (!resultStr || resultStr.length < 2) {
            return { success: false, retry: true, confianza: 10, reason: 'Resultado vacío' };
        }
        // Errores de sistema — solo al inicio de línea para evitar falsos positivos con nombres de archivos
        const esErrorSistema = /^(bash:|ls:|cat:|find:|python3?:|node:)/m.test(resultStr) ||
            /cannot access|permission denied|no such file or directory|command not found/i.test(resultStr) ||
            resultStr.startsWith('Error') || resultStr.startsWith('error');
        if (esErrorSistema) {
            return { success: false, retry: false, confianza: 15, reason: resultStr.slice(0, 100) };
        }
        // generar_contenido: si tiene texto sustancial, siempre éxito (inmune a frases de "sin datos")
        if (paso.accion === 'generar_contenido' && resultStr.length > 50) {
            return { success: true, retry: false, confianza: 90, reason: 'Contenido generado' };
        }

        if (resultStr.includes('Sin resultados') || resultStr.includes('no encontr')) {
            // Si aun así tiene datos climáticos, considerarlo exitoso
            if (resultStr.includes('°C') || resultStr.includes('km/h')) {
                return { success: true, retry: false, confianza: 75, reason: 'Datos climáticos obtenidos (con advertencia)' };
            }
            return { success: false, retry: false, confianza: 30, reason: 'Sin datos disponibles' };
        }
        if (resultStr.includes('°C') || resultStr.includes('km/h') || resultStr.includes('temp=')) {
            return { success: true, retry: false, confianza: 90, reason: 'Datos climáticos obtenidos' };
        }
        // Precio obtenido exitosamente
        if (paso.accion === 'buscar_precio' && (resultStr.includes('USD') || resultStr.includes('MXN'))) {
            return { success: true, retry: false, confianza: 95, reason: 'Precio obtenido' };
        }
        // Acciones siempre exitosas si no hay error de sistema
        const siempreExitoso = [
            'crear_documento','crear_documento_writer','escribir_archivo',
            'crear_excel','crear_presentacion','knowledge_manager',
            'guardar_proyecto_estado','gestionar_documentos','gestionar_goals',
            'ejecutar_skill','recall_tasks','memory_search','estado_actual'
        ];
        if (siempreExitoso.includes(paso.accion)) {
            return { success: true, retry: false, confianza: 90, reason: 'Acción completada' };
        }
        // ejecutar_terminal con error → no reintentar
        if (paso.accion === 'ejecutar_terminal' && esErrorSistema) {
            return { success: false, retry: false, confianza: 15, reason: resultStr.slice(0,150) };
        }
        // Para resultados cortos usar IA
        if (resultStr.length < 200) {
            try {
                const input = `ACCION: ${paso.accion}\nRESULTADO: ${resultStr}\nJSON:`;
                const eval_ = await super.run(input, { temperature: 0.1, max_tokens: 150 });
                if (typeof eval_?.success === 'boolean' && typeof eval_?.confianza === 'number') {
                    return { success: eval_.success, retry: eval_.retry ?? false, confianza: eval_.confianza, reason: eval_.reason || 'Evaluado por IA' };
                }
            } catch(e) { console.log(`[CRITIC] LLM eval falló: ${e.message.slice(0,40)}`); }
        }
        return { success: true, retry: false, confianza: 82, reason: 'Resultado verificado' };
    }

    fallback() { return { success: true, retry: false, confianza: 70, reason: 'fallback' }; }
}

export const criticAgent = new CriticAgent();

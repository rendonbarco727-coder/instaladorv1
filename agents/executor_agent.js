import { BaseAgent } from './base_agent.js';
import { puedeUsarTool, rutaSegura } from '../core/agent_permissions.js';
import { ejecutarTool } from '../tools/tool_registry.js';
import { ReinforcementLearning } from '../memory/reinforcement_learning.js';

const _rl = new ReinforcementLearning(); // singleton — evita abrir DB en cada tool call

const SISTEMA = `Eres un ejecutor de herramientas para BMO.
Tu trabajo es ejecutar acciones usando las herramientas disponibles.

REGLAS:
1. Ejecuta la herramienta correcta para cada paso
2. Maneja errores con try/catch
3. Devuelve resultado estructurado siempre

FORMATO:
{"tool":"...","status":"success|error","result":"...","error":null}`;

class ExecutorAgent extends BaseAgent {
    constructor() { super('EXECUTOR', 'rapido', SISTEMA); }

    async run(paso, ctx) {
        const t0 = Date.now();
        try {
            console.log(`[AGENT:EXECUTOR] ${paso.accion} | ${String(paso.input).slice(0, 60)}`);
            // Verificar permisos (compatible con OpenClaw AGENTS.md)
            if (!puedeUsarTool('executor_agent', paso.accion)) {
                return { tool: paso.accion, status: 'error', result: null, error: `Tool ${paso.accion} no permitida para este agente`, duracion: 0 };
            }
            const inputFinal = typeof paso.input === "object" && paso.input !== null ? JSON.stringify(paso.input) : String(paso.input || "");
            let result;
            try {
                result = await ejecutarTool(paso.accion, inputFinal, ctx);
            } catch(toolErr) {
                // Auto-instalar si el error es módulo no encontrado
                const missingPkg = toolErr.message?.match(/Cannot find (?:package|module) '([^']+)'/)?.[1];
                if (missingPkg && !['fs','path','util','child_process','os'].includes(missingPkg)) {
                    console.log(`[EXECUTOR] Auto-instalando dependencia faltante: ${missingPkg}`);
                    const { execSync } = await import('child_process');
                    try {
                        execSync(`cd /home/ruben/wa-ollama && npm install ${missingPkg} --save`, { timeout: 60000 });
                        console.log(`[EXECUTOR] ✅ ${missingPkg} instalado, reintentando...`);
                        result = await ejecutarTool(paso.accion, inputFinal, ctx);
                    } catch(installErr) {
                        throw new Error(`No se pudo instalar ${missingPkg}: ${installErr.message.slice(0,100)}`);
                    }
                } else {
                    throw toolErr;
                }
            }
            // Manejar respuestas especiales de crear_excel
            if (paso.accion === 'crear_excel') {
                if (result === 'NO_EXCEL_ACTIVO') {
                    result = 'No hay ningún Excel activo. ¿Quieres que cree uno nuevo?';
                } else if (String(result).startsWith('SELECCIONAR_EXCEL:')) {
                    const partes = result.replace('SELECCIONAR_EXCEL:','').split(':');
                    const lista = partes[partes.length-1];
                    result = `¿A cuál archivo quieres agregar los datos? \n${lista}\n0. Crear uno nuevo`;
                }
            }
            const duracion = Date.now() - t0;
            console.log(`[AGENT:EXECUTOR] OK en ${duracion}ms`);
            // Registrar éxito en RL
            try {
                _rl.recordSuccess(paso.accion, ctx || {});
            } catch(e) {}
            return { tool: paso.accion, status: 'success', result, error: null, duracion };
        } catch(e) {
            // Registrar fallo en RL
            try {
                _rl.recordFailure(paso.accion, ctx || {});
            } catch(e) {}
            return { tool: paso.accion, status: 'error', result: null, error: e.message, duracion: Date.now() - t0 };
        }
    }
}

export const executorAgent = new ExecutorAgent();

import { callModel } from '../core/model_router.js';

export class BaseAgent {
    constructor(nombre, modelo, promptSistema) {
        this.nombre = nombre;
        this.modelo = modelo;
        this.promptSistema = promptSistema;
    }

    async run(input, opciones = {}) {
        const prompt = `${this.promptSistema}\n\n${input}`;
        console.log(`[AGENT:${this.nombre}] Ejecutando...`);
        try {
            const resp = await callModel(this.modelo, prompt, {
                temperature: opciones.temperature ?? 0.1,
                max_tokens: opciones.max_tokens ?? 1000
            });
            return this.parsear(resp);
        } catch(e) {
            console.error(`[AGENT:${this.nombre}] Error:`, e.message);
            return this.fallback(input);
        }
    }

    parsear(resp) {
        const limpiarJson = (str) => {
            let limpio = str
                .replace(/:\s*RESULTADO_(\d+)/g, ':"RESULTADO_$1"')
                .replace(/,\s*}/g, '}')
                .replace(/,\s*]/g, ']')
                .replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (m) => m.replace(/\n/g, ' ').replace(/\r/g, ''));
            // Auto-cierre de JSON truncado
            const llaves = (limpio.match(/{/g) || []).length;
            const llavesCierre = (limpio.match(/}/g) || []).length;
            const corchetes = (limpio.match(/\[/g) || []).length;
            const corchetesCierre = (limpio.match(/\]/g) || []).length;
            limpio += ']'.repeat(Math.max(0, corchetes - corchetesCierre));
            limpio += '}'.repeat(Math.max(0, llaves - llavesCierre));
            return limpio;
        };

        try {
            const m = resp.match(/\{[\s\S]*/s);
            if (m) return JSON.parse(limpiarJson(m[0]));
        } catch(e) {
            console.log(`[AGENT:${this.nombre}] Intento de recuperacion de JSON...`);
            try {
                const m2 = resp.match(/```(?:json)?\s*([\s\S]*?)```/);
                const bloque = m2 ? m2[1] : resp.match(/\{[\s\S]*/s)?.[0];
                if (bloque) return JSON.parse(limpiarJson(bloque));
            } catch(e2) {
                console.log(`[AGENT:${this.nombre}] JSON parse error2:`, e2.message.slice(0,60));
            }
        }
        // Reparación inteligente: extraer pasos desde texto plano
        try {
            const lines = resp.split('\n');
            const pasos = [];
            let id = 1;
            const toolsKnown = ['buscar_web','buscar_web_exa','buscar_precio','buscar_clima','generar_contenido','crear_documento','crear_documento_writer','editar_documento','ejecutar_terminal','ejecutar_codigo','memory_search','knowledge_manager','check_system_health','manage_disk_storage','manage_dependencies','escribir_archivo','leer_archivo','leer_archivo_proyecto','enviar_mensaje','ejecutar_skill','code_agent','crear_excel','crear_presentacion','github_manager','gestionar_goals','gestionar_documentos','recall_tasks','estado_actual','web_project_builder','commit_github'];
            for (const line of lines) {
                const m = line.match(/["\s]?(accion|action|tool)["\s]*:\s*["\s]?([a-z_]+)/i);
                const inp = line.match(/["\s]?(input)["\s]*:\s*["\s]?([^"\n,}]+)/i);
                if (m && toolsKnown.includes(m[2])) {
                    pasos.push({ id: id++, accion: m[2], input: inp?.[2]?.trim() || '', descripcion: '' });
                }
            }
            if (pasos.length > 0) {
                const pasosValidos = pasos.filter(p => p.input && p.input.length > 3);
                if (pasosValidos.length > 0) {
                    console.log(`[AGENT:${this.nombre}] Reparación exitosa: ${pasosValidos.length} pasos válidos`);
                    return { pasos: pasosValidos };
                }
            }
        } catch(re) {}
        console.log(`[AGENT:${this.nombre}] Raw sin JSON:`, resp?.slice(0,100));
        return { texto: resp };
    }

    fallback(input) { return { error: 'fallback', input }; }
}

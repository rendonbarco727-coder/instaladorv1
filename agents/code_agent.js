import { BaseAgent } from './base_agent.js';
import { callModel } from '../core/model_router.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { ROOT_DIR } from '../config/bmo.config.js';

const SISTEMA = `Eres un experto programador de BMO. Puedes:
- Generar código en cualquier lenguaje (HTML, CSS, JS, Python, Node.js, Bash, etc)
- Depurar y corregir errores
- Explicar código existente
- Refactorizar y mejorar código
- Crear scripts para correr en Raspberry Pi

Responde SOLO JSON:
{
  "accion": "generar|depurar|explicar|refactorizar|ejecutar",
  "lenguaje": "python|javascript|bash|html|etc",
  "codigo": "código completo aquí",
  "explicacion": "explicación breve",
  "archivo": "nombre_archivo.ext",
  "ejecutar": false
}`;

class CodeAgent extends BaseAgent {
    constructor() { super('CODE', 'codigo', SISTEMA); }

    async procesar(objetivo, contexto = {}) {
        console.log('[CODE_AGENT] Procesando:', objetivo.slice(0, 80));

        // Detectar tipo de acción
        const esDepurar = /error|bug|falla|no funciona|arregla|corrige|fix/i.test(objetivo);
        const esExplicar = /explica|qué hace|cómo funciona|entiende|analiza/i.test(objetivo);
        const esRefactorizar = /refactoriza|mejora|optimiza|limpia|reescribe/i.test(objetivo);
        const esEjecutar = /ejecuta|corre|run|prueba|test/i.test(objetivo);
        const esPython = /python|\.py|pip/i.test(objetivo);
        const esNode = /node|javascript|\.js|npm/i.test(objetivo);
        const esBash = /bash|shell|terminal|comando|script/i.test(objetivo);

        let tipoAccion = 'generar';
        if (esDepurar) tipoAccion = 'depurar';
        else if (esExplicar) tipoAccion = 'explicar';
        else if (esRefactorizar) tipoAccion = 'refactorizar';
        else if (esEjecutar) tipoAccion = 'ejecutar';

        let lenguaje = 'javascript';
        if (esPython) lenguaje = 'python';
        else if (esBash) lenguaje = 'bash';
        // Detectar lenguaje desde el código en el objetivo
        if (/def |import |print\(|range\(|elif |\bfor\s+\w+\s+in\b/i.test(objetivo)) lenguaje = 'python';
        else if (/#!/.test(objetivo) || /\becho\b|\bgrep\b|\bawk\b/i.test(objetivo)) lenguaje = 'bash';

        // Extraer código del objetivo si viene con bloques ```
        const codigoEnObjetivo = objetivo.match(/```(?:\w+)?\n([\s\S]*?)```/s);
        if (codigoEnObjetivo && !contexto.codigo_actual) {
            contexto.codigo_actual = codigoEnObjetivo[1].trim();
        }

        const codigoContexto = contexto.codigo_actual 
            ? `\nCÓDIGO ACTUAL:\n\`\`\`\n${contexto.codigo_actual}\n\`\`\`` 
            : '';

        const errorContexto = contexto.error 
            ? `\nERROR:\n${contexto.error}` 
            : '';

        const prompt = tipoAccion === 'explicar'
            ? `Explica en español de forma clara y concisa qué hace este código:
${codigoContexto || objetivo}

- Explica línea por línea si es corto
- Menciona el propósito general
- Usa lenguaje simple sin tecnicismos innecesarios
- Responde en texto directo, sin código`
            : `Eres un experto programador. Tu tarea es: ${tipoAccion}.
LENGUAJE: ${lenguaje}
TAREA: ${objetivo}${codigoContexto}${errorContexto}

INSTRUCCIONES ESTRICTAS:
- Responde SOLO con el código ${lenguaje} completo y funcional
- NO incluyas JSON, explicaciones, ni texto adicional
- NO uses bloques de código markdown
- SOLO el código puro listo para ejecutar`;

        try {
            const resultado = await callModel('codigo', prompt, { 
                max_tokens: 4000, 
                temperature: 0.2 
            });

            // Parsear respuesta
            let datos = {};
            try {
                // Intentar parsear como JSON
                const limpio = resultado.replace(/```json|```/g, '').trim();
                const match = limpio.match(/\{[\s\S]*\}/s);
                if (match) {
                    const parsed = JSON.parse(match[0]);
                    datos = parsed;
                    // Si codigo es string con JSON, extraer solo el código
                    if (typeof datos.codigo === 'string') {
                        // Limpiar el código de cualquier envoltorio JSON
                        datos.codigo = datos.codigo.trim();
                    }
                }
            } catch(e) {
                // JSON inválido — extraer campo codigo con regex
                const codigoMatch = resultado.match(/"codigo":\s*"([\s\S]*?)(?:(?<!\\)",|(?<!\\)"\s*\})/);
                if (codigoMatch) {
                    datos = {
                        accion: tipoAccion,
                        lenguaje,
                        codigo: codigoMatch[1].replace(/\\n/g,'\n').replace(/\\"/g,'"').trim(),
                        explicacion: 'Código generado',
                        archivo: `codigo.${lenguaje === 'python' ? 'py' : lenguaje === 'bash' ? 'sh' : 'js'}`,
                        ejecutar: esEjecutar
                    };
                }
            }
            
            // Si el codigo es un objeto anidado, extraerlo
            if (datos.codigo && typeof datos.codigo === 'object') {
                // Buscar el primer string en el objeto
                const encontrar = (obj) => {
                    for (const v of Object.values(obj)) {
                        if (typeof v === 'string' && v.includes('\n')) return v;
                        if (typeof v === 'object' && v) { const r = encontrar(v); if (r) return r; }
                    }
                    return null;
                };
                datos.codigo = encontrar(datos.codigo) || JSON.stringify(datos.codigo);
            }

            // Si no se parseó bien o no tiene código, extraer directamente
            if (!datos.codigo) {
                // Extraer código de bloques ```
                const bloqueMatch = resultado.match(/```(?:\w+)?\n([\s\S]*?)```/);
                if (bloqueMatch) {
                    datos = {
                        accion: tipoAccion,
                        lenguaje,
                        codigo: bloqueMatch[1].trim(),
                        explicacion: 'Código generado',
                        archivo: `codigo.${lenguaje === 'python' ? 'py' : lenguaje === 'bash' ? 'sh' : 'js'}`,
                        ejecutar: esEjecutar
                    };
                } else {
                    datos = {
                        accion: tipoAccion,
                        lenguaje,
                        codigo: resultado.replace(/```[\w]*\n?/g, '').trim(),
                        explicacion: 'Código generado',
                        archivo: `codigo.${lenguaje === 'python' ? 'py' : lenguaje === 'bash' ? 'sh' : 'js'}`,
                        ejecutar: esEjecutar
                    };
                }
            }
            
            // Si es tarea de ejecutar, marcar para ejecución
            if ((esEjecutar || /crea y ejecuta|escribe y ejecuta|corre este/i.test(objetivo)) && datos.codigo) {
                datos.ejecutar = true;
            }

            return datos;
        } catch(e) {
            console.error('[CODE_AGENT] Error:', e.message);
            return { error: e.message, accion: tipoAccion };
        }
    }

    async ejecutarCodigo(codigo, lenguaje, archivo) {
        const tmpPath = `/tmp/${archivo || 'bmo_code_' + Date.now()}`;
        try {
            writeFileSync(tmpPath, codigo, 'utf8');
            
            let cmd = '';
            if (lenguaje === 'python') cmd = `python3 ${tmpPath}`;
            else if (lenguaje === 'javascript' || lenguaje === 'node') cmd = `node ${tmpPath}`;
            else if (lenguaje === 'bash') { cmd = `bash ${tmpPath}`; }
            else cmd = `node ${tmpPath}`;

            try {
                const output = execSync(cmd, { encoding: 'utf8', timeout: 30000, cwd: `${ROOT_DIR}` });
                return { ok: true, output: output.slice(0, 2000) };
            } catch(execErr) {
                const pyModule = execErr.message?.match(/ModuleNotFoundError: No module named '([^']+)'/)?.[1];
                if (pyModule) {
                    console.log(`[CODE_AGENT SELF-HEAL] Instalando ${pyModule}...`);
                    execSync(`pip3 install ${pyModule} --break-system-packages`, { timeout: 120000 });
                    const output2 = execSync(cmd, { encoding: 'utf8', timeout: 30000, cwd: `${ROOT_DIR}` });
                    return { ok: true, output: `[Auto-instalé ${pyModule}]\n` + output2.slice(0, 2000) };
                }
                const nodeModule = execErr.message?.match(/Cannot find (?:package|module) '([^']+)'/)?.[1];
                if (nodeModule && !['fs','path','util','os'].includes(nodeModule)) {
                    console.log(`[CODE_AGENT SELF-HEAL] Instalando npm ${nodeModule}...`);
                    execSync(`cd /home/ruben/wa-ollama && npm install ${nodeModule} --save`, { timeout: 60000 });
                    const output2 = execSync(cmd, { encoding: 'utf8', timeout: 30000, cwd: `${ROOT_DIR}` });
                    return { ok: true, output: `[Auto-instalé ${nodeModule}]\n` + output2.slice(0, 2000) };
                }
                throw execErr;
            }
        } catch(e) {
            return { ok: false, error: e.message.slice(0, 500), stderr: e.stderr?.slice(0, 300) };
        }
    }

    formatearRespuesta(datos, ejecutado = null) {
        if (datos.error) return `❌ Error: ${datos.error}`;

        const emojis = { generar: '⚡', depurar: '🐛', explicar: '📖', refactorizar: '♻️', ejecutar: '🚀' };
        let msg = `${emojis[datos.accion] || '💻'} *${(datos.accion||'código').toUpperCase()}* — ${datos.lenguaje || ''}\n\n`;


        if (datos.explicacion && datos.accion === 'explicar') {
            msg += `${datos.explicacion}\n`;
        }

        if (datos.codigo) {
            let codigoLimpio = datos.codigo;
            if (codigoLimpio.includes('"codigo"') || codigoLimpio.startsWith('{')) {
                const m = codigoLimpio.match(/"codigo":\s*"([\s\S]*?)(?:(?<!\\)",|(?<!\\)"\s*[,}])/);
                if (m) codigoLimpio = m[1].replace(/\\n/g,'\n').replace(/\\"/g,'"').trim();
            }
            // Para explicaciones, mostrar como texto plano
            if (datos.accion === 'explicar') {
                msg += `${codigoLimpio.slice(0, 2000)}\n`;
            } else {
                msg += `\`\`\`${datos.lenguaje || ''}\n${codigoLimpio.slice(0, 2000)}\n\`\`\`\n`;
            }
        }

        if (ejecutado) {
            if (ejecutado.ok && ejecutado.output) {
                msg += `\n✅ *Resultado:*\n\`\`\`\n${ejecutado.output.trim()}\n\`\`\``;
            } else if (!ejecutado.ok) {
                msg += `\n❌ *Error:*\n\`\`\`\n${ejecutado.error}\n\`\`\``;
            }
        }

        return msg;
    }
}

export const codeAgent = new CodeAgent();

import { ROOT_DIR } from '../config/bmo.config.js';
import { BaseAgent } from './base_agent.js';
import { getMemoryContext } from '../memory/memory_manager.js';
import { obtenerContextoRelevante } from '../knowledge/vector_store.js';
import { listarTools, ejecutarTool } from '../tools/tool_registry.js';
import { detectarPerfil, getToolsParaPerfil } from '../tools/tool_profiles.js';
import { readFileSync, existsSync } from 'fs';

// Cargar SOUL.md si existe — personalidad editable sin tocar código
function cargarSoul() {
    const soulPath = `${ROOT_DIR}/SOUL.md`
    if (existsSync(soulPath)) {
        return readFileSync(soulPath, 'utf8');
    }
    return '';
}
const SOUL = cargarSoul();
import { clasificarIntencion } from './intent_classifier.js';

const SISTEMA = `${SOUL}

Eres BMO, un agente autónomo avanzado ejecutándose en una Raspberry Pi 4 en Marzo de 2026.
TIENES ACCESO A INTERNET EN TIEMPO REAL. 

REGLAS DE IDENTIDAD Y ACTUALIDAD:
- NUNCA digas que tu base de conocimientos está limitada a 2021 o 2023. 
- Si te preguntan algo de 2024, 2025 o 2026, o sobre PRECIOS y COMPARATIVAS, tu primer paso DEBE ser buscar_web.
- NUNCA generes una tabla o reporte de datos factuales sin haber usado buscar_web o buscar_precio primero.
- Eres el asistente personal de Ruben y tu objetivo es ser útil, no dar excusas sobre fechas de corte.

CAMPO THOUGHT OBLIGATORIO:
- Cada paso del plan DEBE incluir un campo "thought" con el razonamiento breve (max 15 palabras).
- Ejemplo: { "id":1, "accion":"buscar_web", "input":"precio iPhone", "thought":"Necesito datos actuales de internet", "descripcion":"Buscar" }

Eres un planificador experto de tareas para BMO.
Tu trabajo es convertir un objetivo en un plan estructurado de pasos claros y ejecutables.

REGLAS:
1. Divide el objetivo en tareas pequeñas y concretas
2. Selecciona la herramienta adecuada para cada paso
3. CADENA DE DATOS: Si un paso necesita el resultado de otro, usa RESULTADO_N (donde N es el id del paso anterior). Ejemplo: si paso 1 ejecuta un script, el paso 2 puede usar "RESULTADO_1" como input.
4. MULTI-OBJETIVO: Si el usuario pide varias cosas en un mensaje (crear + ejecutar + marcar), genera UN plan con todos los pasos encadenados en orden lógico. NO ignores ningún sub-objetivo.
5. MÁXIMO 6 pasos por plan. Si necesitas más, prioriza los más importantes.
- Para precios de crypto (bitcoin, ethereum, etc) o divisas (dólar, euro): usa buscar_precio
- Para clima o temperatura: usa buscar_clima
- Para información general o noticias: usa buscar_web
- IMPORTANTE: Para precio del dólar en México (USD/MXN) usa buscar_precio con input "dolar" — NO uses buscar_web
- Si el resultado de buscar_precio o buscar_clima ya contiene la respuesta completa, el siguiente paso debe ser enviar_mensaje directamente, sin generar_contenido
- MEMORIA es una base de datos interna, NUNCA es un archivo. Para buscar información previa usa memory_search, NUNCA leer_archivo con input "MEMORIA" o similar
- Para preguntas sobre estado del sistema, salud, temperatura, RAM, CPU: usa check_system_health
- Para preguntas sobre qué está haciendo BMO, en qué paso va, cuánto falta, "qué estás haciendo", "cómo vas", "en qué andas": usa estado_actual
- Para ejecutar código Python o JavaScript en el Pi y ver el resultado: usa ejecutar_codigo
- IMPORTANTE: ejecutar_codigo es para EJECUTAR y ver resultado. code_agent es SOLO para explicar, refactorizar o mostrar código sin ejecutarlo. Para tareas de sistema (limpiar, calcular, promediar archivos) SIEMPRE usa ejecutar_codigo
- Para leer el contenido de un archivo del proyecto antes de modificarlo: usa leer_archivo_proyecto
- Para hacer commit y push a GitHub de cambios en el dashboard u otros repos: usa commit_github con "mensaje|ruta_repo"
- Para listar repos del usuario: usa github_manager con "repos"
- Para ver archivos de un repo o carpeta: usa github_manager con "files|nombre_repo|carpeta(opcional)"
- Para leer el contenido de un archivo en GitHub: usa github_manager con "read|repo|archivo"
- Para editar o crear un archivo en GitHub: usa github_manager con "edit|repo|archivo|contenido"
- Para borrar un archivo de GitHub: usa github_manager con "delete|repo|archivo"
- Para ver commits de un repo: usa github_manager con "commits|repo"
- Para ver páginas publicadas de un repo: usa github_manager con "pages|repo"
- Para crear un repo nuevo en GitHub: usa github_manager con "crear_repo|nombre|descripcion|publico"
- Para publicar cualquier archivo en un repo específico: usa github_manager con "publicar|repo|archivo|contenido_o_ruta"
- Para listar, buscar, enviar, eliminar o gestionar documentos guardados: usa gestionar_documentos
- Para crear, listar, eliminar o completar goals/objetivos: usa gestionar_goals con formato "accion|id" (ej: "eliminar|95", "listar", "completar|95")
- Para crear hojas de cálculo, Excel, tablas de datos o archivos xlsx: usa crear_excel
- Para crear presentaciones, diapositivas o PowerPoint: usa crear_presentacion
- Para crear documentos de texto con LibreOffice Writer: usa crear_documento_writer
- Para limpiar archivos temporales, logs o espacio en disco: usa manage_disk_storage con input "clean_tmp", "clean_logs", "clean_all" o "report". NUNCA uses ejecutar_terminal para borrar archivos
- Para comandos git/gh que requieren un directorio: usa ejecutar_terminal con formato "cwd:/ruta|comando"
- gh auth login NUNCA usa redirección "<". Usa siempre: ejecutar_terminal "echo TOKEN | gh auth login --with-token"
- pm2 start de un proceso que ya existe falla. Usa: ejecutar_terminal "pm2 restart bmo-telemetry || pm2 start /home/ruben/wa-ollama/telemetry.js --name bmo-telemetry"
- DEPLOY/GIT es SIEMPRE secuencial, NUNCA paralelo. Para crear repos GitHub usa este orden EXACTO paso a paso: (1) ejecutar_terminal "cwd:/home/ruben|mkdir -p dashboard && cd dashboard && git init && git checkout -b main" (2) ejecutar_terminal "cwd:/home/ruben|git config --global user.email ruben@bmo.ai && git config --global user.name Ruben-BMO" (3) escribir_archivo "/home/ruben/dashboard/index.html|CONTENIDO_HTML" (4) ejecutar_terminal "cwd:/home/ruben/dashboard|git add . && git commit -m init" (5) ejecutar_terminal "cwd:/home/ruben/dashboard|gh repo create bmo-jarvis-hub --public --source=. --remote=origin --push || git push -u origin main --force" (6) ejecutar_terminal "cwd:/home/ruben/dashboard|gh api repos/rendonbarco727-coder/bmo-jarvis-hub/pages --method POST -f source[branch]=main -f source[path]=/" (7) enviar_mensaje "✅ Dashboard online: https://rendonbarco727-coder.github.io/bmo-jarvis-hub" (2) ejecutar_terminal "cwd:/home/ruben/dashboard|git init && git checkout -b main" (3) escribir_archivo para index.html en /home/ruben/dashboard/index.html (4) ejecutar_terminal "cwd:/home/ruben/dashboard|git add . && git commit -m init" (5) ejecutar_terminal "cwd:/home/ruben/dashboard|gh repo create bmo-jarvis-hub --public --source=. --push" (6) ejecutar_terminal "cwd:/home/ruben/dashboard|gh repo edit --enable-pages --branch main --path /"
- Si una tarea requiere una librería npm que puede no estar instalada (pdf-lib, moment, axios, etc): usa manage_dependencies con input "install:nombre_paquete" ANTES de ejecutar la tarea
- Si el usuario pregunta "qué dice el documento X", "qué sabes sobre Y", "apréndete este archivo" o envía una ruta de archivo: usa knowledge_manager con "ingest|ruta" para aprender o "query|pregunta" para consultar
- Si el usuario comparte información personal ("me llamo X", "soy tu creador", "trabajo en Y"): usa knowledge_manager con "ingest_text|información" para guardarla, NUNCA uses ingest con texto directo
- NUNCA uses leer_archivo con palabras como: MEMORIA, memoria, context, historial, base_datos
3. Evita pasos innecesarios
4. Máximo 8 pasos, mínimo 2
5. Usa RESULTADO_N para referenciar pasos anteriores
6. Último paso SIEMPRE es enviar_mensaje
7. Responde SOLO JSON válido sin texto extra
8. Para preguntas sobre el pasado, historial o actividades recientes: usa memory_search como primer paso
9. Para preguntas sobre tu origen, creador, identidad o datos que el usuario pidió recordar: usa knowledge_manager con "query|pregunta" — NO uses memory_search para esto
10. TU IDENTIDAD ESTÁ EN EL KNOWLEDGE_MANAGER. Cuando pregunten "quién eres", "quién te creó", "cómo te llamas": el PRIMER paso SIEMPRE es knowledge_manager con "query|identidad bmo" antes de generar cualquier respuesta
9. Si hay DOCUMENTO ACTIVO en el contexto: usa editar_documento, NUNCA crear_documento

FORMATO:
{"objetivo":"...","pasos":[{"id":1,"accion":"tool","input":"param","descripcion":""}]}

EJEMPLOS:
Usuario: "quién te creó" → {"objetivo":"responder sobre creador","pasos":[{"id":1,"accion":"knowledge_manager","input":"query|creador origen","descripcion":""},{"id":2,"accion":"generar_contenido","input":"Responde naturalmente basándote en: RESULTADO_1","descripcion":""},{"id":3,"accion":"enviar_mensaje","input":"RESULTADO_2","descripcion":""}]}
Usuario: "qué hicimos ayer" → {"objetivo":"recordar actividades","pasos":[{"id":1,"accion":"memory_search","input":"actividades recientes","descripcion":""},{"id":2,"accion":"enviar_mensaje","input":"RESULTADO_1","descripcion":""}],"estrategia":""}
Usuario: "agrega una conclusión" (con doc activo) → {"objetivo":"editar doc","pasos":[{"id":1,"accion":"generar_contenido","input":"conclusión del documento","descripcion":""},{"id":2,"accion":"editar_documento","input":"RUTA_DOC|RESULTADO_1","descripcion":""},{"id":3,"accion":"enviar_mensaje","input":"Listo ✅","descripcion":""}],"estrategia":""}`;

class PlannerAgent extends BaseAgent {
    constructor() { super('PLANNER', 'razonamiento', SISTEMA); }

    async run(objetivo, userId, ctx = {}) {
        // Inyectar skills disponibles en el sistema prompt dinámicamente
        let sistemaConSkills = this.sistema;
        try {
            const { listarSkills, autoDescubrirSkills } = await import('../skills/skill_registry.js');
            autoDescubrirSkills();
            const skills = listarSkills();
            if (skills.length > 0) {
                const listaSkills = skills.map(s => `- ${s.nombre}: ${s.descripcion}`).join('\n');
                sistemaConSkills = this.sistema + `\n\nSKILLS INSTALADAS (usa ejecutar_skill para activarlas):\n${listaSkills}\n- Para usar una skill: {"accion":"ejecutar_skill","input":"nombre_skill|mensaje_usuario"}\n- Usa ejecutar_skill cuando el objetivo coincida con la descripción de alguna skill instalada`;
            }
        } catch(e) { console.log('[PLANNER] Skills no disponibles:', e.message); }

        // Inyectar MEMORY.md y diario de hoy en el contexto
        try {
            const { leerMemoryMd, leerDiarioHoy } = await import('../core/context_compaction.js');
            const memMd = ctx.memory_md || leerMemoryMd();
            const diario = leerDiarioHoy();
            if (memMd && memMd.length > 20) {
                sistemaConSkills += `\n\n## MEMORIA DURABLE (MEMORY.md)\n${memMd.slice(-2000)}`;
            }
            if (diario && diario.length > 20) {
                sistemaConSkills += `\n\n## DIARIO DE HOY\n${diario.slice(-1000)}`;
            }
        } catch(e) { console.log('[PLANNER] Memory.md no disponible:', e.message); }

        // Intercepción directa por skills registradas (antes del LLM)
        try {
            const { listarSkills, buscarSkillEnHub } = await import('../skills/skill_registry.js');
            const skills = listarSkills();
            for (const skill of skills) {
                const palabras = skill.descripcion
                    .toLowerCase()
                    .replace(/[^a-záéíóúñü\s]/gi, ' ')
                    .split(/\s+/)
                    .filter(p => p.length > 4)
                    .slice(0, 6);
                const regex = new RegExp(palabras.join('|'), 'i');
                if (regex.test(objetivo)) {
                    console.log(`[PLANNER] Skill match directo: ${skill.nombre}`);
                    return [
                        { id: 1, accion: 'ejecutar_skill', input: `${skill.nombre}|${objetivo}`, descripcion: `Skill: ${skill.nombre}`, thought: `Usando skill ${skill.nombre}` },
                        { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar resultado' }
                    ];
                }
            }
            // Auto-discovery: buscar en Hub si no hay skill local
            console.log('[PLANNER] Sin skill local, buscando en Hub...');
            const skillNueva = await buscarSkillEnHub(objetivo);
            if (skillNueva) {
                console.log(`[PLANNER] Skill auto-instalada: ${skillNueva.slug}`);
                return [
                    { id: 1, accion: 'ejecutar_skill', input: `${skillNueva.nombre}|${objetivo}`, descripcion: `Skill Hub: ${skillNueva.slug}`, thought: `Auto-instalé skill ${skillNueva.slug} desde Hub` },
                    { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar resultado' }
                ];
            }
            // Sin skill disponible — usar fallback inteligente con detección de tipo de tarea
            console.log('[PLANNER] No hay skill disponible en Hub para este objetivo');
            const fallbackResult = await this.fallback(objetivo, ctx);
            if (fallbackResult?.pasos) return fallbackResult.pasos;
            return [
                { id: 1, accion: 'buscar_web', input: objetivo, descripcion: 'Investigar alternativa', thought: 'Sin skill local, busco en internet' },
                { id: 2, accion: 'generar_contenido', input: `Basado en RESULTADO_1, responde al usuario: "${objetivo}". Si la info no es suficiente, indícalo.`, descripcion: 'Respuesta con contexto web', thought: 'Sintetizo resultado de búsqueda' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar respuesta' }
            ];
        } catch(e) { console.log('[PLANNER] Auto-discovery error:', e.message.slice(0,60)); }

        // Inyectar contexto de conversación reciente
        try {
            const { getShortTerm, getLongTerm } = await import('../memory/memory_manager.js');
            const historial = getShortTerm(userId, 6);
            const docs = getLongTerm(userId, 3).filter(m => m.tipo === 'active_document');
            if (docs.length && !ctx.active_document) {
                const { existsSync } = await import('fs');
                if (existsSync(docs[0].contenido)) ctx.active_document = docs[0].contenido;
            }
            if (historial.length > 0) {
                const resumen = historial.slice(-4).map(h => `${h.role}: ${String(h.content).slice(0,80)}`).join(' | ');
                objetivo = `[Contexto: ${resumen}] ${objetivo}`;
            }
        } catch(e) {}

        // Inyectar contexto del World Model
        try {
            const { getHechos, getEntidad, getRelaciones } = await import('../world_model/world_model.js');
            const hechos = getHechos(8);
            const entidadUsuario = getEntidad(String(userId));
            const partes = [];
            if (hechos.length > 0) {
                const hechosFiltrados = hechos
                    .filter(h => h.confianza >= 0.5)
                    .map(h => h.hecho)
                    .slice(0, 5);
                if (hechosFiltrados.length > 0)
                    partes.push(`Hechos conocidos: ${hechosFiltrados.join('; ')}`);
            }
            if (entidadUsuario?.atributos) {
                const attrs = Object.entries(entidadUsuario.atributos)
                    .filter(([k]) => k !== 'ultima_actividad')
                    .map(([k,v]) => `${k}=${v}`)
                    .slice(0, 3)
                    .join(', ');
                if (attrs) partes.push(`Perfil usuario: ${attrs}`);
            }
            if (partes.length > 0) {
                objetivo = `[WorldModel: ${partes.join(' | ')}] ${objetivo}`;
                console.log('[PLANNER] World model inyectado en contexto');
            }
        } catch(e) { console.log('[PLANNER] World model no disponible:', e.message?.slice(0,60)); }

        // Interceptar preguntas de estado/progreso
        const esEstado = /^(qu[eé]\s+est[aá]s\s+haciendo|qu[eé]\s+est[aá]s\s+trabajando|c[oó]mo\s+vas|en\s+qu[eé]\s+andas|cu[aá]nto\s+falta|qu[eé]\s+est[aá]s\s+haciendo\s+ahora)/i.test(objetivo.trim());
        if (esEstado) {
            console.log('[PLANNER] Interceptado estado — usando estado_actual');
            return [
                { id: 1, accion: 'estado_actual', input: objetivo, descripcion: 'Ver estado actual' },
                { id: 2, accion: 'generar_contenido', input: 'Responde de forma natural y conversacional: RESULTADO_1', descripcion: 'Respuesta natural' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar' }
            ];
        }
        // Interceptar frases ambiguas con contexto conversacional
        const esAmbiguo = /^(eso|lo mismo|otra vez|como antes|el de ayer|ese archivo|lo que te pedí|sigue|continua|repite|hazlo de nuevo)$/i.test(objetivo.trim());
        if (esAmbiguo && ctx.historial?.length) {
            console.log(`[PLANNER] Frase ambigua detectada, usando contexto`);
            return [
                { id: 1, accion: 'recall_tasks', input: 'última tarea', descripcion: 'Recordar contexto' },
                { id: 2, accion: 'generar_contenido', input: `El usuario dijo "${objetivo}". Basado en el historial: ${JSON.stringify(ctx.historial.slice(-2))}. Responde apropiadamente.`, descripcion: 'Generar respuesta contextual' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Responder' }
            ];
        }
        
        // Interceptar preguntas de memoria/contexto antes del LLM
        const esMemoriaDirecto = /\b(qu[eé]\s+(hicimos|hiciste|hice)|qu[eé]\s+estuvimos|qu[eé]\s+trabajamos|retoma\s+ese|edita\s+ese|ese\s+documento|ese\s+archivo)\b/i.test(objetivo);
        // NO interceptar memoria si hay documento activo y es edición
        const esEdicionDoc = /agrega|añade|pon|incluye|quita|modifica|editar_documento/i.test(objetivo);
        if (esMemoriaDirecto && !(esEdicionDoc && ctx.active_document)) {
            console.log('[PLANNER] Interceptado memoria — plan natural');
            return [
                { id: 1, accion: 'recall_tasks', input: objetivo, descripcion: 'Buscar tareas recientes' },
                { id: 2, accion: 'generar_contenido', input: 'Responde de forma natural y amigable en español: RESULTADO_1', descripcion: 'Respuesta natural' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar respuesta' }
            ];
        }
        // Interceptar preguntas sobre capacidades (testear objetivo limpio, sin contexto inyectado)
        // Limpiar contexto inyectado — el objetivo real está después del ]
        const objetivoLimpio = (() => {
            // Si hay [Contexto: ... ] al inicio, extraer solo lo que viene después
            const m = objetivo.match(/\[Contexto:[\s\S]*?\]\s*(.*)/s);
            if (m) return m[1].trim();
            // Si no hay contexto, usar el objetivo completo
            return objetivo.trim();
        })();

        // Interceptar "recuerda que / guarda que / me llamo" — guardar en knowledge
        const esGuardarDato = /^(recuerda que|guarda que|anota que|aprende que|no olvides que|me llamo|mi nombre es|soy tu creador|trabajo en|tengo un|mi auto es|mi carro es|mi mascota es|vivo en)/i.test(objetivoLimpio.trim());
        if (esGuardarDato) {
            console.log('[PLANNER] Interceptado: guardar dato personal en knowledge');
            return [
                { id: 1, accion: 'knowledge_manager', input: `save|${objetivoLimpio}|personal|3`, descripcion: 'Guardar dato personal', thought: 'El usuario quiere que recuerde este dato' },
                { id: 2, accion: 'enviar_mensaje', input: '✅ Anotado. Lo recordaré para futuras conversaciones.', descripcion: 'Confirmar al usuario' }
            ];
        }

        // Interceptar cancelar — cierra cualquier proceso activo
        if (/^(cancelar|cancel|cancelar todo|salir|exit|stop|parar|olvidemos|olvida|olvídalo|no importa|déjalo|dejalo|no gracias)$/i.test(objetivoLimpio.trim())) {
            console.log('[PLANNER] Cancelar detectado');
            try {
                // Emitir señal de cancelación para detener el loop activo
                const { setCancelSignal } = await import('../core/cancel_signal.js');
                setCancelSignal(userId);
                // Limpiar estado de proyecto
                const _fs_cancel = await import('fs');
                const _cancelPath = `/tmp/bmo-proyecto-${userId}.json`;
                if (_fs_cancel.default.existsSync(_cancelPath)) _fs_cancel.default.unlinkSync(_cancelPath);
            } catch(e) {}
            return [
                { id: 1, accion: 'enviar_mensaje', input: '❌ Proceso cancelado. ¿En qué más te puedo ayudar?', descripcion: 'Confirmar cancelación' }
            ];
        }

        // Leer estado de proyecto activo — tiene prioridad sobre TODOS los interceptores
        const _fs_pre = await import('fs');
        const _estadoPath = `/tmp/bmo-proyecto-${userId}.json`;
        const _estadoActivo = (() => {
            try {
                if (_fs_pre.default.existsSync(_estadoPath)) {
                    const raw = _fs_pre.default.readFileSync(_estadoPath, 'utf8');
                    const e = JSON.parse(raw);
                    if (Date.now() - e.timestamp < 30 * 60 * 1000) return e;
                    _fs_pre.default.unlinkSync(_estadoPath);
                }
            } catch(e) {}
            return null;
        })();

        // Declarar esGoalAutomatico antes de cualquier uso
        const esGoalAutomatico = /^\[AUTO\]/i.test(objetivoLimpio) || /^BMO investiga/i.test(objetivoLimpio);
        const esMultiPaso = /luego|después|y después|y luego|también|además/i.test(objetivoLimpio);
        const esListarArchivos = !esMultiPaso && /lista.*archivos|qu[eé].*archivos|qu[eé].*carpeta|revisa.*carpeta|ver.*carpeta/i.test(objetivoLimpio);

        // Si viene con contexto de error — extraer el error y cambiar estrategia
        const errorPrevio = objetivoLimpio.match(/\(corrigiendo:\s*(.+?)\)/i)?.[1];
        if (errorPrevio) {
            const esPermiso = /permission denied|cannot open/i.test(errorPrevio);
            const esRutaMala = /no such file|cannot access/i.test(errorPrevio);
            if (esPermiso) {
                return [{ id:1, accion:'enviar_mensaje', input:`❌ No tengo permisos para acceder a esa ruta.`, descripcion:'Reportar error de permisos' }];
            }
            if (esRutaMala) {
                const rutaOriginal = objetivoLimpio.match(/\/home\/[\w\/.\-]+/)?.[0] || '';
                const carpeta = rutaOriginal.split('/').pop();
                return [
                    { id:1, accion:'ejecutar_terminal', input:`find /home/ruben/wa-ollama -maxdepth 3 -name "${carpeta}" -type d 2>/dev/null`, descripcion:'Buscar ruta correcta' },
                    { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Mostrar ruta encontrada' }
                ];
            }
        }

        // Si hay proyecto en modo edición → interceptar AQUÍ
        if (_estadoActivo?.fase === 'editando' && !esGoalAutomatico) {
            const esTerminar = /^(no|listo|terminar|cancelar|ya\s*est[aá])$/i.test(objetivoLimpio.trim());
            // También terminar si es nueva solicitud de proyecto
            const esNuevoProyecto = /^(hazme|crea|genera|diseña).{0,50}(juego|landing|dashboard|portafolio|app|página|tetris|snake|pong)/i.test(objetivoLimpio);
            if (esTerminar || esNuevoProyecto) {
                try { _fs_pre.default.unlinkSync(_estadoPath); } catch(e) {}
                if (esTerminar) {
                    return [
                        { id: 1, accion: 'enviar_mensaje', input: `✅ ¡Listo! Proyecto publicado. ¿En qué más te ayudo?`, descripcion: 'Cerrar edición' }
                    ];
                }
                // Si es nuevo proyecto, continuar al clasificador
            } else {
            console.log(`[PLANNER] Editando proyecto: ${_estadoActivo.repo}`);
            return [
                { id: 1, accion: 'web_project_builder', input: `editar||${_estadoActivo.repo}||index.html||${objetivoLimpio}`, descripcion: 'Editar proyecto' },
                { id: 2, accion: 'guardar_proyecto_estado', input: JSON.stringify({ ..._estadoActivo, fase: 'editando', timestamp: Date.now() }), descripcion: 'Mantener estado edición' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Confirmar edición' }
            ];
            } // fin else
        }

        // Si hay proyecto esperando repo → interceptar AQUÍ antes que cualquier otro
        console.log(`[DEBUG] estadoActivo=${_estadoActivo?.fase || 'null'} objetivo="${objetivoLimpio.slice(0,60)}"`);

        // ── EARLY INTERCEPTS DE ESTADO DE PROYECTO ───────────────────────
        if (_estadoActivo?.fase === 'esperando_respuestas' && !esGoalAutomatico) {
            // Si el mensaje parece una nueva solicitud de proyecto, ignorar estado anterior
            const esNuevaSolicitud = /^(hazme|crea|genera|diseña|construye|hacer).{0,50}(juego|landing|dashboard|portafolio|app|página|sitio|animacion)/i.test(objetivoLimpio);
            if (esNuevaSolicitud) {
                console.log('[PLANNER] Nueva solicitud detectada — limpiando estado anterior');
                try { _fs_pre.default.unlinkSync(_estadoPath); } catch(e) {}
                // Continuar al clasificador — no interceptar
            } else {
            console.log('[PLANNER] Respuestas recibidas → generando proyecto');
            const ctxProyecto = {
                tipo: _estadoActivo.tipo || 'web_profesional',
                descripcion: _estadoActivo.descripcion || '',
                colores: _estadoActivo.info_extraida?.colores || 'moderno',
                datos: objetivoLimpio,
                imagenes: []
            };
            _fs_pre.default.writeFileSync(_estadoPath, JSON.stringify({ ..._estadoActivo, fase: 'generando', timestamp: Date.now() }), 'utf8');
            return [
                { id: 1, accion: 'enviar_mensaje', input: `⚙️ Generando proyecto con tus especificaciones...\n_Esto puede tardar unos segundos_ ⏳`, descripcion: 'Avisar' },
                { id: 2, accion: 'web_project_builder', input: `generar||${JSON.stringify(ctxProyecto)}`, descripcion: 'Generar' },
                { id: 3, accion: 'guardar_proyecto_estado', input: 'GUARDAR_TMPDIR:RESULTADO_2', descripcion: 'Guardar tmpDir' },
                { id: 4, accion: 'github_manager', input: 'repos_lista', descripcion: 'Obtener lista de repos' },
                { id: 5, accion: 'guardar_proyecto_estado', input: 'GUARDAR_REPOS:RESULTADO_4', descripcion: 'Guardar repos' },
                { id: 6, accion: 'enviar_mensaje', input: `MENU_REPOS:${_estadoActivo.nombre_sugerido || 'mi-proyecto'}:RESULTADO_4`, descripcion: 'Preguntar repo' }
            ];
            } // fin else esNuevaSolicitud
        }

        if (_estadoActivo?.fase === 'esperando_repo' && !esGoalAutomatico) {
            const trimmed = objetivoLimpio.trim();
            const esNuevo = /^(0|nuevo|crear|crea|new)$/i.test(trimmed);
            const numElegido = trimmed.match(/^([1-9])$/);
            const esNombreRepo = /^[a-zA-Z0-9][a-zA-Z0-9-]{2,}$/.test(trimmed);
            let repoElegido = null;
            if (esNuevo) {
                repoElegido = _estadoActivo.nombre_sugerido || _estadoActivo.titulo || 'mi-proyecto';
            } else if (numElegido && _estadoActivo.repos_lista?.length > 0) {
                // El menú muestra 1️⃣ para índice 0, 2️⃣ para índice 1, etc.
                const idx = parseInt(numElegido[1]) - 1;
                repoElegido = _estadoActivo.repos_lista[idx] || trimmed;
                console.log(`[PLANNER] Repo elegido: ${numElegido[1]} → idx ${idx} → ${repoElegido}`);
            } else if (esNombreRepo) {
                repoElegido = trimmed;
            } else {
                repoElegido = _estadoActivo.nombre_sugerido || 'mi-proyecto';
            }
            console.log(`[PLANNER] Publicando proyecto en: ${repoElegido}`);
            _fs_pre.default.unlinkSync(_estadoPath);
            return [
                { id: 1, accion: 'web_project_builder', input: `publicar||${_estadoActivo.tmpDir}||${repoElegido}||${esNuevo ? 'nuevo' : 'existente'}`, descripcion: `Publicar` },
                { id: 2, accion: 'guardar_proyecto_estado', input: 'RESULTADO_1', descripcion: 'Activar edición' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar URL' }
            ];
        }

        // ── CONTEXTO DEL WORLD MODEL ─────────────────────────────────────
        let wmContexto = '';
        try {
            const { getHechos, getEntidad, getRelaciones } = await import('../world_model/world_model.js');
            // Hechos recientes de alta confianza
            const hechos = getHechos(5);
            // Entidad del usuario — herramientas favoritas
            const relUsuario = getRelaciones(userId);
            const herramientas = relUsuario
                .filter(r => r.relacion === 'uso' && r.entidad_a === userId)
                .slice(0, 4)
                .map(r => r.entidad_b);
            // Entidad mencionada en el objetivo (primera palabra significativa)
            const palabras = objetivoLimpio.split(/\s+/).filter(p => p.length > 4);
            let entidadMencionada = null;
            for (const p of palabras) {
                const e = getEntidad(p.toLowerCase());
                if (e) { entidadMencionada = e; break; }
            }
            const partes = [];
            if (hechos.length) partes.push(`Hechos recientes: ${hechos.map(h => h.hecho).join('; ')}`);
            if (herramientas.length) partes.push(`Herramientas frecuentes del usuario: ${herramientas.join(', ')}`);
            if (entidadMencionada) partes.push(`Entidad conocida: ${entidadMencionada.nombre} (${entidadMencionada.tipo})`);
            if (partes.length) wmContexto = '[WM:' + partes.join(' | ') + ']';
        } catch(e) {
            console.log('[PLANNER] World model no disponible:', e.message);
        }
        if (wmContexto) {
            objetivo = `${wmContexto} ${objetivo}`;
            console.log('[PLANNER] World model inyectado:', wmContexto.slice(0, 120));
        }

        // ── CLASIFICADOR DE INTENCIÓN (Groq 70b) ──────────────────────────
        let intent = { intencion: 'conversacion', confianza: 50 };
        if (!esGoalAutomatico) {
            try {
                intent = await clasificarIntencion(objetivoLimpio);
            } catch(e) {
                console.log('[PLANNER] Clasificador falló, usando fallback');
            }
        }
        console.log(`[PLANNER] Intent: ${intent.intencion} (${intent.confianza}%)`);

        // ── ROUTING POR INTENCIÓN ──────────────────────────────────────────

        // Override: si el mensaje claramente pide proyecto web, forzar proyecto_web
        const esProyectoWebForzado = /^(hazme|crea|genera|diseña|construye|hacer).{0,50}(juego|snake|tetris|pong|landing|dashboard|portafolio|app web|página web|sitio web|animacion)/i.test(objetivoLimpio);
        if (esProyectoWebForzado && intent.intencion !== 'proyecto_web') {
            console.log(`[PLANNER] Override: forzando proyecto_web desde ${intent.intencion}`);
            intent.intencion = 'proyecto_web';
        }

        if (intent.intencion === 'codigo' && !esGoalAutomatico && !esListarArchivos) {
            const pideEjecucion = /ejecuta|corre|run|instala|configura|haz.*script|haz.*programa|calcula.*con|genera.*y.*ejecuta/i.test(objetivoLimpio);
            if (pideEjecucion) {
                return [
                    { id:1, accion:'ejecutar_codigo', input:objetivoLimpio, descripcion:'Ejecutar en el Pi' },
                    { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Enviar resultado' }
                ];
            }
            return [
                { id: 1, accion: 'code_agent', input: `${objetivoLimpio}`, descripcion: 'Procesar código' },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar resultado' }
            ];
        }

        if (intent.intencion === 'proyecto_web' && !esGoalAutomatico) {
            // Reusar lógica existente de web_project_builder
            const promptDetallado2 = objetivoLimpio.split(/[,\.\n]/).length >= 3 ||
                /control|flechas|swipe|velocidad|colores|botón|diseño|neón|estilo|puntuación/i.test(objetivoLimpio);
            const analisisRaw2 = await (async () => {
                try {
                    return await ejecutarTool('web_project_builder', `analizar||${objetivoLimpio}`, { userId });
                } catch(e) { return '{}'; }
            })();
            let analisisObj2 = {};
            try { analisisObj2 = JSON.parse(analisisRaw2); } catch(e) {}
            const estadoInicial2 = {
                fase: 'esperando_respuestas',
                tipo: analisisObj2.tipo || 'web_profesional',
                descripcion: analisisObj2.descripcion_corta || objetivoLimpio,
                nombre_sugerido: analisisObj2.nombre_sugerido || 'mi-proyecto',
                necesita_imagenes: analisisObj2.necesita_imagenes || false,
                info_extraida: analisisObj2.info_extraida || {},
                prompt_original: objetivoLimpio,
                timestamp: Date.now()
            };
            _fs_pre.default.writeFileSync(_estadoPath, JSON.stringify(estadoInicial2), 'utf8');
            const preguntas2 = analisisObj2.preguntas || [];
            const sinPreguntas2 = preguntas2.length === 0 || objetivoLimpio.split(/[,\.\n]/).length >= 3;
            if (sinPreguntas2) {
                const ctxDirecto2 = { tipo: analisisObj2.tipo || 'web_profesional', descripcion: analisisObj2.descripcion_corta || objetivoLimpio, colores: analisisObj2.info_extraida?.colores || 'moderno y oscuro', datos: objetivoLimpio, imagenes: [] };
                estadoInicial2.fase = 'generando';
                _fs_pre.default.writeFileSync(_estadoPath, JSON.stringify(estadoInicial2), 'utf8');
                return [
                    { id: 1, accion: 'enviar_mensaje', input: `⚙️ Generando *${analisisObj2.nombre_sugerido || 'proyecto'}*...\n_Esto puede tardar unos segundos_ ⏳`, descripcion: 'Avisar' },
                    { id: 2, accion: 'web_project_builder', input: `generar||${JSON.stringify(ctxDirecto2)}`, descripcion: 'Generar' },
                    { id: 3, accion: 'guardar_proyecto_estado', input: 'GUARDAR_TMPDIR:RESULTADO_2', descripcion: 'Guardar tmpDir' },
                    { id: 4, accion: 'github_manager', input: 'repos_lista', descripcion: 'Obtener lista de repos' },
                    { id: 5, accion: 'guardar_proyecto_estado', input: 'GUARDAR_REPOS:RESULTADO_4', descripcion: 'Guardar repos' },
                    { id: 6, accion: 'enviar_mensaje', input: `MENU_REPOS:${analisisObj2.nombre_sugerido || 'mi-proyecto'}:RESULTADO_4`, descripcion: 'Preguntar repo' }
                ];
            }
            const preguntasTexto2 = preguntas2.slice(0,2).map((p,i) => `${['1️⃣','2️⃣'][i]} ${p}`).join('\n');
            return [{ id: 1, accion: 'enviar_mensaje', input: `Confirmo: *${analisisObj2.descripcion_corta}* 🎮\n\n${preguntasTexto2}\n\nResponde todo junto 😊`, descripcion: 'Preguntar' }];
        }

        if (intent.intencion === 'github') {
            // Traducir lenguaje natural a operación de github_manager
            let gitOp = 'repos';
            if (/archivos|qu[eé] hay|contenido|archivos de/i.test(objetivoLimpio)) {
                const repoM = objetivoLimpio.match(/\b([\w-]{4,})\b/g)?.find(w => !['archivos','hay','contenido','repo','que','hay','en','el','la'].includes(w.toLowerCase()));
                gitOp = `files|${repoM || 'bmo-jarvis-hub'}`;
            } else if (/commits|historial/i.test(objetivoLimpio)) {
                gitOp = 'commits|bmo-jarvis-hub';
            } else if (/páginas|paginas|html publicado/i.test(objetivoLimpio)) {
                gitOp = 'pages|bmo-jarvis-hub';
            } else if (/crea.*repo|nuevo repo/i.test(objetivoLimpio)) {
                const nombre = objetivoLimpio.match(/llamado\s+([\w-]+)/i)?.[1] || 'nuevo-repo';
                gitOp = `crear_repo|${nombre}|Creado por BMO|publico`;
            } else if (/borra|elimina/i.test(objetivoLimpio)) {
                const archivo = objetivoLimpio.match(/([\w.-]+\.[\w]+)/)?.[1];
                gitOp = archivo ? `delete|bmo-jarvis-hub|${archivo}` : 'repos';
            }
            return [
                { id: 1, accion: 'github_manager', input: gitOp, descripcion: 'GitHub' },
                { id: 2, accion: 'generar_contenido', input: 'Eres BMO. Presenta esta info de GitHub de forma amigable y directa en español, sin tecnicismos: RESULTADO_1', descripcion: 'Respuesta natural' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar' }
            ];
        }

        if (intent.intencion === 'clima') {
            // Extraer ciudad limpiamente
            const ciudad = (() => {
                const m = objetivoLimpio.match(/(?:en|de|para)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*)/);
                if (m) return m[1];
                return objetivoLimpio.replace(/\b(clima|temperatura|tiempo|cómo|está|el|la|hoy|del|de|en|para|pronóstico|pronostico|lluvia|calor|frío|frio)\b/gi,'').replace(/\s+/g,' ').trim() || 'Monterrey';
            })();
            return [
                { id: 1, accion: 'buscar_clima', input: ciudad, descripcion: `Clima en ${ciudad}` },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar' }
            ];
        }

        if (intent.intencion === 'precio') {
            return [
                { id: 1, accion: 'buscar_precio', input: objetivoLimpio, descripcion: 'Buscar precio' },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar' }
            ];
        }

        // Listar archivos del Pi
        if (!esGoalAutomatico && /lista.*archivos|qu[eé].*archivos|qu[eé].*carpeta|revisa.*carpeta|ver.*carpeta/i.test(objetivoLimpio)) {
            const rutaMatch = objetivoLimpio.match(/['"]([^'"]+)['"]|carpeta\s+(\S+)|de\s+(\/[\w\/]+)|\/home\/[\w\/]+/);
            const rutaDirecta = objetivoLimpio.match(/\/home\/[\w\/.]+/)?.[0];
            const ruta = rutaDirecta || (rutaMatch ? (rutaMatch[1]||rutaMatch[2]||rutaMatch[3]) : 'wa-ollama');
            const rutaFull = ruta.startsWith('/') ? ruta : `/home/ruben/wa-ollama/${ruta}`;
            return [
                { id:1, accion:'ejecutar_terminal', input:`ls -lh ${rutaFull}`, descripcion:'Listar archivos' },
                { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Mostrar archivos' }
            ];
        }

        // No interceptar si es mensaje multi-objetivo complejo
        const esMultiObjetivoPlanner = /luego|después|y después|y luego|también|además/i.test(objetivoLimpio);
        // Detección determinista: precio dólar/divisas → buscar_precio
        if (/precio.*d[oó]lar|d[oó]lar.*hoy|tipo de cambio|usd.*mxn|mxn.*usd|cotizaci[oó]n.*d[oó]lar|busca.*d[oó]lar|d[oó]lar.*precio|cu[aá]nto.*d[oó]lar|d[oó]lar.*est[aá]|valor.*d[oó]lar/i.test(objetivoLimpio)) {
            return [
                { id:1, accion:'buscar_precio', input:'dolar', descripcion:'Precio del dólar' },
                { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Enviar precio' }
            ];
        }

        if (intent.intencion === 'listar_sistema' && !esMultiObjetivoPlanner) {
            const rutaAbsoluta = objetivoLimpio.match(/(?:\/home\/|\/tmp|\/var\/|\/etc\/)[\w\/.\-]*/)?.[0]?.replace(/[,;\s].*$/, '');
            const nombreCarpeta = objetivoLimpio.match(/carpeta\s+['"]?([\w\-.]+)['"]?/i)?.[1] ||
                                  objetivoLimpio.match(/(?:en|de)\s+(?:la\s+carpeta\s+)?['"]?([\w\-.]+)['"]?/i)?.[1];
            const ruta = rutaAbsoluta || (nombreCarpeta ? `/home/ruben/wa-ollama/${nombreCarpeta}` : `${ROOT_DIR}`);
            return [
                { id:1, accion:'ejecutar_terminal', input:`ls -lh ${ruta} 2>&1`, descripcion:'Listar archivos del Pi' },
                { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Mostrar resultado' }
            ];
        }

        if (intent.intencion === 'sistema') {
            return [
                { id: 1, accion: 'check_system_health', input: '', descripcion: 'Estado del sistema' },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar' }
            ];
        }

        if (intent.intencion === 'busqueda') {
            return [
                { id: 1, accion: 'buscar_web', input: objetivoLimpio, descripcion: 'Buscar info' },
                { id: 2, accion: 'generar_contenido', input: `Utiliza EXCLUSIVAMENTE la información de RESULTADO_1 para responder a "${objetivoLimpio}". No añadas datos externos.`, descripcion: 'Sintetizar búsqueda' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar' }
            ];
        }

        if (intent.intencion === 'capacidades') {
            return [
                { id: 1, accion: 'generar_contenido', input: `Tienes estas herramientas: ${listarTools().join(', ')}. Explica en español amigable qué puedes hacer, agrupado por categoría.`, descripcion: 'Capacidades' },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar' }
            ];
        }

        if (intent.intencion === 'memoria') {
            return [
                { id: 1, accion: 'memory_search', input: objetivoLimpio, descripcion: 'Buscar en memoria' },
                { id: 2, accion: 'generar_contenido', input: 'Responde naturalmente en español: RESULTADO_1', descripcion: 'Respuesta natural' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar' }
            ];
        }

        if (intent.intencion === 'identidad') {
            return [
                { id: 1, accion: 'knowledge_manager', input: 'query|identidad bmo nombre creador', descripcion: 'Buscar identidad' },
                { id: 2, accion: 'generar_contenido', input: 'Responde naturalmente: RESULTADO_1', descripcion: 'Respuesta' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar' }
            ];
        }

        // Cédula SPF
        if (/cedula|cédula/i.test(objetivoLimpio) && /spf|identificacion|identificación/i.test(objetivoLimpio)) {
            return [
                { id:1, accion:'crear_documento_writer', input:JSON.stringify({tipo:'cedula_spf', titulo:'CEDULA DE IDENTIFICACION'}), descripcion:'Generar cedula SPF' },
                { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Enviar' }
            ];
        }

        if (intent.intencion === 'documento') {
            const esExcel = /excel|xlsx/i.test(objetivoLimpio);
            const esPPT = /presentacion|powerpoint|pptx/i.test(objetivoLimpio);
            const necesitaBusqueda = /202[4-6]|precio|costo|comparativa|más baratos|mejores|actual|hoy|mercado/i.test(objetivoLimpio);
            if (esExcel && !necesitaBusqueda) return [{ id:1, accion:'crear_excel', input:objetivoLimpio, descripcion:'Excel' }, { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Enviar' }];
            if (esPPT && !necesitaBusqueda) return [{ id:1, accion:'crear_presentacion', input:objetivoLimpio, descripcion:'PPT' }, { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Enviar' }];
            if (necesitaBusqueda) {
                // Buscar primero, luego crear documento con datos reales
                const tipoDoc = esExcel ? 'crear_excel' : esPPT ? 'crear_presentacion' : 'crear_documento_writer';
                return [
                    { id:1, accion:'buscar_web_exa', input:objetivoLimpio, descripcion:'Buscar datos actuales' },
                    { id:2, accion:'generar_contenido', input:`Con estos datos reales: RESULTADO_1

Crea el contenido solicitado: ${objetivoLimpio}`, descripcion:'Generar con datos reales' },
                    { id:3, accion:tipoDoc, input:'RESULTADO_2', descripcion:'Crear documento' },
                    { id:4, accion:'enviar_mensaje', input:'RESULTADO_3', descripcion:'Enviar' }
                ];
            }
            return [
                { id:1, accion:'generar_contenido', input:objetivoLimpio, descripcion:'Generar contenido' },
                { id:2, accion:'crear_documento_writer', input:'RESULTADO_1', descripcion:'Crear doc' },
                { id:3, accion:'enviar_mensaje', input:'RESULTADO_2', descripcion:'Enviar' }
            ];
        }

        // Listar archivos del Pi — ANTES del clasificador
        if (esListarArchivos) {
            const rutaDirecta = objetivoLimpio.match(/\/home\/[\w\/.]+/)?.[0];
            const rutaMatch = objetivoLimpio.match(/['"]([^'"]+)['"]|carpeta\s+(\S+)/);
            const ruta = rutaDirecta || (rutaMatch ? (rutaMatch[1]||rutaMatch[2]) : null);
            const rutaFull = ruta ? (ruta.startsWith('/') ? ruta : `/home/ruben/wa-ollama/${ruta}`) : `${ROOT_DIR}`;
            return [
                { id:1, accion:'ejecutar_terminal', input:`ls -lh ${rutaFull}`, descripcion:'Listar archivos del Pi' },
                { id:2, accion:'enviar_mensaje', input:'RESULTADO_1', descripcion:'Mostrar resultado' }
            ];
        }

        // conversacion y cualquier otro → LLM directo
        if (intent.intencion === 'conversacion') {
            return [
                { id: 1, accion: 'generar_contenido', input: `Eres BMO, asistente amigable de Ruben. Responde naturalmente en español: ${objetivoLimpio}`, descripcion: 'Respuesta conversacional' },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar' }
            ];
        }

        // Context Pruning — solo tools relevantes para esta intención
        let toolsPrompt = '';
        try {
            const perfil = detectarPerfil(intent.intencion);
            const toolsFiltradas = getToolsParaPerfil(perfil);
            if (toolsFiltradas && toolsFiltradas.length > 0) {
                toolsPrompt = `\nHERRAMIENTAS DISPONIBLES (usa solo estas): ${toolsFiltradas.join(', ')}\n`;
                console.log(`[PLANNER] Context Pruning: perfil=${perfil} tools=${toolsFiltradas.length}`);
            }
        } catch(e) {}
        
        const objetivoConTools = toolsPrompt ? objetivo + toolsPrompt : objetivo;
        const promptOriginal = this.promptSistema;
        this.promptSistema = sistemaConSkills;
        const resultado = await super.run(objetivoConTools, { temperature: 0.1, max_tokens: 1200 });
        this.promptSistema = promptOriginal;
        let pasos = resultado.pasos || resultado.plan || [];
        
        // Control de calidad: forzar búsqueda si pide datos de 2024-2026 o precios
        const necesitaBusqueda = /202[4-6]|precio|costo|comparativa|cuánto vale|más baratos|mejores/i.test(objetivo);
        const tieneBusqueda = pasos.some(p => p.accion && (p.accion.includes('buscar') || p.accion.includes('research')));
        
        if (necesitaBusqueda && !tieneBusqueda && pasos.length > 0) {
            console.log("[PLANNER] Forzando búsqueda omitida por el LLM");
            pasos.unshift({ 
                id: 0, 
                accion: 'buscar_web_exa', 
                input: objetivo,
                descripcion: 'Investigar datos actuales',
                thought: 'El usuario pide datos actuales; necesito investigar primero.'
            });
            pasos = pasos.map((p, i) => ({ ...p, id: i + 1 }));
        }
        // Si no hay pasos válidos, usar fallback
        if (!pasos.length) {
            console.log('[AGENT:PLANNER] Sin pasos válidos, usando fallback');
            const fb = await this.fallback(objetivo, ctx);
            pasos = fb.pasos || [];
        }
        console.log(`[AGENT:PLANNER] ${pasos.length} pasos - ${resultado.estrategia || ''}`);
        return pasos;
    }

    async fallback(input, ctx = {}) {
        const esExcel = /excel|xlsx|hoja.*calculo|calculo|spreadsheet|tabla.*datos/i.test(input);
        const esPPT = /presentacion|diapositiva|powerpoint|pptx|slides/i.test(input);
        const esDoc = /word|docx|documento|reporte|informe|excel|xlsx|presentacion|pptx/i.test(input);
        const esClima = /clima|temperatura|tiempo en/i.test(input);
        const esEdicion = /agr[eé]g|edita|a[nñ]ade|ponle|quita|secci[oó]n|tabla|conclusi[oó]n|res[uú]me/i.test(input);
        const docActivo = ctx.active_document || null;

        // Si hay documento activo y es edición → editar_documento
        if (docActivo && (esEdicion || esDoc)) {
            return { pasos: [
                { id: 1, accion: 'generar_contenido', input, descripcion: 'Generar contenido nuevo' },
                { id: 2, accion: 'editar_documento', input: docActivo + '|RESULTADO_1', descripcion: 'Agregar al documento existente' },
                { id: 3, accion: 'enviar_mensaje', input: 'Documento actualizado ✅', descripcion: 'Notificar al usuario' }
            ]};
        }
        // Excel directo con datos del usuario — NO pasar por generar_contenido
        if (esExcel && !esClima) {
            return { pasos: [
                { id: 1, accion: 'crear_excel', input: input, descripcion: 'Crear Excel con los datos originales' },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar archivo xlsx al usuario' }
            ]};
        }
        // Presentación directa
        if (esPPT && !esClima) {
            return { pasos: [
                { id: 1, accion: 'generar_contenido', input: input, descripcion: 'Generar contenido' },
                { id: 2, accion: 'crear_presentacion', input: 'RESULTADO_1', descripcion: 'Crear presentación' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar archivo' }
            ]};
        }
        if (esDoc && esClima) {
            const ciudad = input.replace(/.*(?:clima|temperatura|tiempo)\s+(?:de|en)\s+/i,'').replace(/\s*(y\s+)?(crea|genera|hace|elabora).*/i,'').trim() || 'Monterrey';
            return { pasos: [
                { id: 1, accion: 'buscar_clima', input: ciudad, descripcion: 'Obtener clima actual' },
                { id: 2, accion: 'generar_contenido', input: 'Genera un pronóstico detallado del tiempo para ' + ciudad + ' en español. Fecha actual: ' + new Date().toLocaleDateString('es-MX', {weekday:'long',year:'numeric',month:'long',day:'numeric'}) + '. Usa EXCLUSIVAMENTE estos datos reales: RESULTADO_1. No inventes datos adicionales.', descripcion: 'Generar contenido con grounding' },
                { id: 3, accion: 'crear_docx', input: ciudad + ' Pronóstico del Tiempo|RESULTADO_2', descripcion: 'Crear documento Word' },
                { id: 4, accion: 'enviar_mensaje', input: 'RESULTADO_3', descripcion: 'Enviar archivo al usuario' }
            ]};
        }
        if (esDoc) {
            return { pasos: [
                { id: 1, accion: 'generar_contenido', input, descripcion: 'Generar contenido' },
                { id: 2, accion: 'crear_docx', input: 'documento|RESULTADO_1', descripcion: 'Crear documento Word' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar archivo al usuario' }
            ]};
        }
        // Pregunta de identidad/creador → consultar vault primero
        const esIdentidad = /quien.*cre[oó]|tu.*creador|quien.*hizo|de donde|tu.*origen|quien.*eres|quien.*fabric|como.*llamas|tu.*nombre|eres.*bmo|que.*eres/i.test(input);
        if (esIdentidad) {
            return { pasos: [
                { id: 1, accion: 'knowledge_manager', input: 'query|identidad bmo nombre creador', descripcion: 'Buscar identidad en vault' },
                { id: 2, accion: 'generar_contenido', input: 'Responde naturalmente: RESULTADO_1', descripcion: 'Generar respuesta natural' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar respuesta' }
            ]};
        }
        // Pregunta conversacional/memoria → buscar en memoria primero
        // Skills instaladas — cumpleaños
        const esCumple = /cumplea[ñn]os|aniversario|fecha.*recuerda|recuerda.*fecha/i.test(input);
        if (esCumple) {
            return { pasos: [
                { id: 1, accion: 'ejecutar_skill', input: `birthday-reminder|${input}`, descripcion: 'Gestionar cumpleaños con skill' },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Confirmar al usuario' }
            ]};
        }

        const esMemoria = /hicimos|hice|trabajamos|ayer|antes|recuerdas|sabes|aprendiste|qué fue|qué pasó|última vez|historial|hiciste|acabas/i.test(input);
        if (esMemoria) {
            return { pasos: [
                { id: 1, accion: 'recall_tasks', input: input, descripcion: 'Buscar tareas recientes' },
                { id: 2, accion: 'generar_contenido', input: 'Responde de forma natural y amigable basándote en esto: RESULTADO_1', descripcion: 'Generar respuesta natural' },
                { id: 3, accion: 'enviar_mensaje', input: 'RESULTADO_2', descripcion: 'Enviar respuesta' }
            ]};
        }
        // Buscar skill dinámica en registry local
        const { listarSkills: _listarSkills } = await import('../skills/skill_registry.js');
        const skillsDisponibles = _listarSkills();
        const inputLower = input.toLowerCase();
        const skillLocal = skillsDisponibles.find(s => {
            const palabras = s.nombre.replace(/-/g,' ').split(' ');
            return palabras.some(p => p.length > 3 && inputLower.includes(p));
        });

        if (skillLocal) {
            console.log(`[PLANNER] Skill local encontrada: ${skillLocal.nombre}`);
            return { pasos: [
                { id: 1, accion: 'ejecutar_skill', input: `${skillLocal.nombre}|${input}`, descripcion: `Ejecutar skill: ${skillLocal.nombre}` },
                { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar resultado' }
            ]};
        }

        // Buscar skill en Hub si no hay local (async, best-effort)
        try {
            const skillHub = await buscarSkillEnHub(input);
            if (skillHub) {
                console.log(`[PLANNER] Skill instalada desde Hub: ${skillHub.nombre}`);
                return { pasos: [
                    { id: 1, accion: 'ejecutar_skill', input: `${skillHub.nombre}|${input}`, descripcion: `Ejecutar skill Hub: ${skillHub.nombre}` },
                    { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar resultado' }
                ]};
            }
        } catch(e) { /* Hub no crítico */ }

        return { pasos: [
            { id: 1, accion: 'generar_contenido', input, descripcion: 'Generar respuesta' },
            { id: 2, accion: 'enviar_mensaje', input: 'RESULTADO_1', descripcion: 'Enviar al usuario' }
        ]};
    }
}

// Exportación con fallback para concurrencia
let _plannerInstance = null;
export function getPlannerAgent() {
    if (!_plannerInstance) {
        _plannerInstance = new PlannerAgent();
    }
    return _plannerInstance;
}
export const plannerAgent = getPlannerAgent();

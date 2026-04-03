import { ROOT_DIR } from '../config/bmo.config.js';
import { generarHerramienta } from './code_generator.js';
import { probarModulo } from './module_tester.js';
import { registrarSkill } from '../skills/skill_registry.js';
import { guardarConocimiento } from '../knowledge/vector_store.js';
import fs from 'fs';

const TOOLS_PATH = `${ROOT_DIR}/tools`
const SKILLS_PATH = `${ROOT_DIR}/skills`

export async function aprenderHerramienta(nombre, descripcion) {
    // Sanitizar nombre — solo letras, números y guiones bajos
    nombre = String(nombre).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40);
    if (!nombre || nombre.length < 3) return { ok: false, error: 'Nombre inválido' };
    console.log(`[TOOL_LEARNER] Aprendiendo herramienta: ${nombre}`);

    // Generar código
    const codigo = await generarHerramienta(nombre, descripcion);
    if (!codigo || codigo.length < 50) return { ok: false, error: 'Código generado muy corto' };

    // Código completo del módulo
    const moduloCodigo = `import { exec } from 'child_process';
import { promisify } from 'util';
import { ROOT_DIR } from '../config/bmo.config.js';
const execAsync = promisify(exec);

export async function ${nombre}(input, ctx = {}) {
${codigo}
}
`;
    // Probar
    const prueba = await probarModulo(moduloCodigo);
    if (!prueba.aprobado) {
        console.log(`[TOOL_LEARNER] Falló prueba: ${prueba.sintaxis?.error?.slice(0,80)}`);
        return { ok: false, error: prueba.sintaxis?.error };
    }

    // Guardar como skill
    const rutaSkill = `${SKILLS_PATH}/${nombre}.js`;
    fs.writeFileSync(rutaSkill, moduloCodigo, 'utf8');
    registrarSkill(nombre, descripcion, rutaSkill, [nombre]);

    // Guardar en knowledge
    await guardarConocimiento('skill_aprendido', `Herramienta ${nombre}: ${descripcion}`, { nombre, ruta: rutaSkill }, 'global', 2);

    console.log(`[TOOL_LEARNER] ✓ Herramienta ${nombre} aprendida y guardada`);
    return { ok: true, ruta: rutaSkill };
}

// Detectar si se necesita herramienta nueva y aprenderla
export async function detectarYAprender(accionFallida, descripcion) {
    const herramientasExistentes = ['leer_web','buscar_web_exa','buscar_web','buscar_precio','buscar_clima','ejecutar_terminal','generar_contenido','escribir_archivo','leer_archivo','estado_sistema','instalar_software','controlar_servicio','crear_documento','editar_documento','github_manager','generar_html','publicar_github','enviar_mensaje','gestionar_goals','recall_tasks','knowledge_manager','crear_presentacion','crear_documento_writer','crear_excel','manage_dependencies','manage_disk_storage','ejecutar_codigo','leer_archivo_proyecto','commit_github','gestionar_documentos','estado_actual','check_system_health','recall_episodic','analizar_causa','rl_stats','memory_search','code_agent','guardar_proyecto_estado','web_project_builder','ejecutar_skill','crear_documento_interactivo','controlar_casa','crear_docx'];
    if (herramientasExistentes.includes(accionFallida)) return null;
    return await aprenderHerramienta(accionFallida, descripcion);
}

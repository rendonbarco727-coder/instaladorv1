import { ROOT_DIR } from '../../config/bmo.config.js';

export async function manejarEstadoSistema(userMessage, id, client) {
    const trigger = /^bmo,?\s*(estado del sistema|status|observabilidad|métricas|metricas)/i;
    if (!trigger.test(userMessage)) return false;
    try {
        const { generarReporteAdmin } = await import('../../observability/usage_tracker.js');
        const reporte = await generarReporteAdmin();
        await client.sendMessage(id, reporte);
    } catch(e) {
        await client.sendMessage(id, `Error generando reporte: ${e.message}`);
    }
    return true;
}

// Comando manual de self-improvement
export async function manejarSelfImprovement(msg, userId) {
    const texto = msg.body.toLowerCase();
    if (texto.startsWith('bmo, mejora ') || texto.startsWith('bmo, genera herramienta ')) {
        const { generarModulo, guardarModulo } = await import('../../self_improvement/code_generator.js');
        const { probarModulo } = await import('../../self_improvement/module_tester.js');
        const descripcion = msg.body.replace(/bmo,?\s+(mejora|genera herramienta)\s+/i, '').trim();
        await msg.reply('Generando mejora con IA...');
        const codigo = await generarModulo('mejora_' + Date.now(), descripcion);
        const prueba = await probarModulo(codigo);
        if (prueba.aprobado) {
            const ruta = `${ROOT_DIR}/evoluciones/mejora_${Date.now()}.js`;
            try {
                guardarModulo(ruta, codigo);
                await msg.reply(`✅ Módulo generado y aprobado:\n${ruta}`);
            } catch(e) {
                await msg.reply(`❌ Módulo aprobado pero no se pudo guardar: ${e.message}`);
            }
        } else {
            await msg.reply(`⚠️ Módulo generado pero no aprobó pruebas:\n${prueba.sintaxis?.error?.slice(0,200) || 'error desconocido'}`);
        }
        return true;
    }
    if (texto.startsWith('bmo, parchea ') || texto.startsWith('bmo, patchea ')) {
        const { patchearArchivo, mejorarArchivo } = await import('../../self_improvement/patcher.js');
        const partes = msg.body.replace(/bmo,?\s+(parchea|patchea)\s+/i, '').trim().split(' con error ');
        const ruta = partes[0]?.trim();
        const error = partes[1]?.trim() || 'mejorar código';
        if (!ruta) { await msg.reply('Formato: BMO, parchea ruta/archivo.js con error descripción'); return true; }
        await msg.reply(`Aplicando patch a ${ruta}...`);
        const resultado = await mejorarArchivo(ruta, error);
        await msg.reply(resultado.ok ? `✅ Patch aplicado en ${ruta}` : `❌ No se pudo parchear: ${resultado.error}`);
        return true;
    }
    return false;
}

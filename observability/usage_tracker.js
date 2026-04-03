import { exec } from 'child_process';
import { promisify } from 'util';
import { getMetricasResumen, getToolStats } from './metrics.js';
import { getErroresRecientes, getErroresPorTipo } from './errors.js';

const execAsync = promisify(exec);

async function getSistema() {
    try {
        const { stdout } = await execAsync(
            `echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}')%" && ` +
            `free -h | awk '/Mem/{print "RAM: "$3"/"$2}' && ` +
            `df -h / | awk 'NR==2{print "Disco: "$3"/"$2" ("$5")"}' && ` +
            `(vcgencmd measure_temp 2>/dev/null || echo "Temp: N/A")`
        );
        return stdout.trim();
    } catch(e) {
        return 'Sistema: no disponible';
    }
}

export async function generarReporteAdmin() {
    const [sistema, metricas, toolStats, erroresRecientes, erroresTipo] = await Promise.all([
        getSistema(),
        getMetricasResumen(24),
        getToolStats(24),
        getErroresRecientes(3),
        getErroresPorTipo(24)
    ]);

    const ahora = new Date().toLocaleString('es-MX', { timeZone: 'America/Monterrey' });
    
    let reporte = `*🤖 Estado de BMO*\n${ahora}\n\n`;

    // Sistema
    reporte += `*💻 Sistema*\n${sistema}\n\n`;

    // Actividad 24h
    const tasaExito = metricas.tareasTotal > 0 ? Math.round(metricas.tareasExito / metricas.tareasTotal * 100) : 0;
    reporte += `*📊 Actividad (24h)*\n`;
    reporte += `Tareas: ${metricas.tareasTotal} (${tasaExito}% éxito)\n`;
    reporte += `Usuarios activos: ${metricas.usuariosActivos}\n`;
    reporte += `Errores: ${metricas.errores}\n`;
    reporte += `Tool más usada: ${metricas.toolMasUsada}\n\n`;

    // Top tools
    if (toolStats.length > 0) {
        reporte += `*🔧 Herramientas*\n`;
        toolStats.slice(0, 5).forEach(t => {
            const pct = t.usos > 0 ? Math.round(t.exitosos / t.usos * 100) : 0;
            reporte += `${t.tool}: ${t.usos} usos (${pct}% OK)\n`;
        });
        reporte += '\n';
    }

    // Errores recientes
    if (erroresRecientes.length > 0) {
        reporte += `*⚠️ Errores recientes*\n`;
        erroresRecientes.forEach(e => {
            const tiempo = new Date(e.timestamp).toLocaleTimeString('es-MX');
            reporte += `[${tiempo}] ${e.tipo}: ${e.mensaje.slice(0, 60)}\n`;
        });
    } else {
        reporte += `*⚠️ Errores recientes*\nSin errores recientes ✅\n`;
    }

    return reporte;
}

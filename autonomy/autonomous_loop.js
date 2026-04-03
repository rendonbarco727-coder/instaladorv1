import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';

// Leer HEARTBEAT.md — checklist configurable sin tocar código
function leerHeartbeat() {
    const path = `${ROOT_DIR}/HEARTBEAT.md`
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf8');
    // Extraer checks activos (líneas con - [ ])
    const checks = content.match(/^- \[ \] .+/gm)?.map(l => l.replace('- [ ] ', '').trim()) || [];
    console.log(`[HEARTBEAT] ${checks.length} checks cargados desde HEARTBEAT.md`);
    return checks;
}
import { detectarTemasFrecuentes, detectarHuecosConocimiento } from './curiosity_engine.js';
import { crearGoalsAutomaticos } from './goal_generator.js';
import { getPendientes } from '../goals/goal_manager.js';
import { ejecutarGoal } from '../goals/goal_executor.js';
import { ejecutarTool } from '../tools/tool_registry.js';
import { listarSkills } from '../skills/skill_registry.js';
import { ROOT_DIR } from '../config/bmo.config.js';

const execAsync = promisify(exec);
const INTERVALO_MS = 30 * 60 * 1000; // 30 min
const ADMIN_ID = '100365164921028@lid';

let _intervalo = null;
let _clienteWA = null;
let _corriendo = false;
let _ultimaAlertaTs = 0;

async function getRecursos() {
    try {
        const { stdout: cpuOut } = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d. -f1");
        const { stdout: ramOut } = await execAsync("free | grep Mem | awk '{print int($3/$2*100)}'");
        return {
            cpu: parseInt(cpuOut.trim()) || 0,
            ram: parseInt(ramOut.trim()) || 0
        };
    } catch(e) { return { cpu: 0, ram: 0 }; }
}

async function cicloAutonomo() {
    if (_corriendo) return;
    _corriendo = true;

    console.log('[AUTONOMY] Iniciando ciclo autónomo...');
    // Leer checklist de HEARTBEAT.md
    const heartbeatChecks = leerHeartbeat();
    
    // Check de conectividad si está en el heartbeat
    if (heartbeatChecks?.some(c => /conectividad|internet|ping/i.test(c))) {
        try {
            await execAsync('ping -c 1 -W 3 8.8.8.8');
            console.log('[HEARTBEAT] ✅ Internet OK');
        } catch(e) {
            console.log('[HEARTBEAT] ❌ Sin internet');
            if (_clienteWA) await _clienteWA.sendMessage(ADMIN_ID, '⚠️ BMO: Sin conexión a internet').catch(() => {});
        }
    }

    // Limpiar /tmp si está en el heartbeat
    if (heartbeatChecks?.some(c => /limpiar.*tmp|tmp.*500/i.test(c))) {
        try {
            const { stdout } = await execAsync("du -sm /tmp 2>/dev/null | cut -f1");
            const mb = parseInt(stdout.trim());
            if (mb > 500) {
                await execAsync('find /tmp -name "bmo_*" -mmin +60 -delete 2>/dev/null');
                console.log(`[HEARTBEAT] 🗑️ /tmp limpiado (era ${mb}MB)`);
            }
        } catch(e) {}
    }

    try {
        // REFLEJO DE SUPERVIVENCIA: verificar salud del hardware
        try {
            const health = await ejecutarTool('check_system_health', '', {});
            // Ignorar alerta de reinicios si son < 500 (normal en desarrollo)
            const reinicios = parseInt(health.match(/PM2 reinicios.*?: (\d+)/)?.[1] || '0');
            const alertaReal = health.includes('🌡️ Temperatura crítica') || 
                               health.includes('⚠️ RAM alta') ||
                               (reinicios > 500);
            // Cooldown: no enviar más de 1 alerta cada 2 horas
            const ahora = Date.now();
            const ultimaAlerta = _ultimaAlertaTs || 0;
            if (alertaReal && _clienteWA && (ahora - ultimaAlerta) > 2 * 60 * 60 * 1000) {
                _ultimaAlertaTs = ahora;
                await _clienteWA.sendMessage(ADMIN_ID,
                    `🚨 *BMO ALERTA DE SISTEMA* 🚨\n${health}`
                ).catch(() => {});
                console.log('[AUTONOMY] ⚠️ Alerta de salud enviada al admin');
            }
            // Si temperatura crítica > 75°C, saltar ciclo para ahorrar CPU
            const tempMatch = health.match(/Temperatura: ([\d.]+)/);
            if (tempMatch && parseFloat(tempMatch[1]) > 75) {
                console.log('[AUTONOMY] 🌡️ Temperatura crítica, omitiendo ciclo');
                return;
            }
            // Si muchos reinicios, hacer pm2 flush
            if (/Muchos reinicios/i.test(health)) {
                await execAsync('pm2 flush').catch(() => {});
                console.log('[AUTONOMY] 🔧 pm2 flush ejecutado por reinicios excesivos');
            }
        } catch(he) {
            console.log('[AUTONOMY] Health check falló:', he.message);
        }

        // Verificar recursos
        const { cpu, ram } = await getRecursos();
        if (cpu > 70 || ram > 80) {
            console.log(`[AUTONOMY] Recursos altos (CPU ${cpu}% RAM ${ram}%), omitiendo ciclo`);
            return;
        }

        // 1. Escanear memoria
        console.log('[AUTONOMY] Escaneando memoria...');
        const temas = detectarTemasFrecuentes(8);
        const huecos = detectarHuecosConocimiento();

        if (temas.length) {
            console.log(`[AUTONOMY] Temas frecuentes: ${temas.slice(0,5).join(', ')}`);
        }
        if (huecos.length) {
            console.log(`[AUTONOMY] Huecos detectados: ${huecos.slice(0,3).join(', ')}`);
        }

        // 2. Enriquecer temas con skills disponibles
        const skillsActivas = listarSkills();
        if (skillsActivas.length > 0) {
            const nombresSkills = skillsActivas.map(s => s.nombre.replace(/-/g,' '));
            // Agregar skills como temas si no están ya cubiertos
            for (const sk of nombresSkills) {
                const yaEsta = temas.some(t => t.includes(sk) || sk.includes(t));
                if (!yaEsta) temas.push(sk);
            }
            console.log(`[AUTONOMY] ${skillsActivas.length} skill(s) incluidas en generación de goals`);
        }

        // Delay para no saturar Groq en ciclos autónomos
        await new Promise(r => setTimeout(r, 1000));
        if (temas.length >= 3 || huecos.length >= 1) {
            const nuevos = await crearGoalsAutomaticos(temas, huecos, ADMIN_ID);
            if (nuevos.length && _clienteWA) {
                const lista = nuevos.map((g,i) => `${i+1}. ${g.objetivo.replace('[AUTO] ','').slice(0,70)}`).join('\n');
                await _clienteWA.sendMessage(ADMIN_ID,
                    `🤖 *BMO generó ${nuevos.length} objetivo(s) automático(s):*\n${lista}`
                ).catch(() => {});
            }
        }

        // 3. El goal_scheduler es quien ejecuta los goals — no ejecutar aquí
        const pendientes = getPendientes().filter(g => g.objetivo.startsWith('[AUTO]'));
        if (pendientes.length) {
            console.log(`[AUTONOMY] ${pendientes.length} goal(s) pendiente(s) — esperando goal_scheduler`);
        }

        console.log('[AUTONOMY] Ciclo completado');
    } catch(e) {
        console.error('[AUTONOMY] Error en ciclo:', e.message);
    } finally {
        _corriendo = false;
    }
}

export function iniciarAutonomousLoop(clienteWA) {
    _clienteWA = clienteWA;
    if (_intervalo) return;
    // Primera ejecución con delay de 5 min para no chocar con arranque
    setTimeout(() => {
        cicloAutonomo();
        _intervalo = setInterval(cicloAutonomo, INTERVALO_MS);
    }, 5 * 60 * 1000);
    console.log('[AUTONOMY] Loop autónomo iniciado (primer ciclo en 5min, luego cada 30min)');
}

export function detenerAutonomousLoop() {
    if (_intervalo) { clearInterval(_intervalo); _intervalo = null; }
    console.log('[AUTONOMY] Loop detenido');
}

export async function forzarCiclo() {
    console.log('[AUTONOMY] Ciclo forzado manualmente');
    await cicloAutonomo();
}

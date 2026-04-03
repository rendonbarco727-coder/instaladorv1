// Heartbeat — ciclo proactivo de BMO inspirado en OpenClaw
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config/bmo.config.js';

const COOLDOWN_FILE = `${ROOT_DIR}/memory/heartbeat_cooldown.json`
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 horas

function leerCooldown() {
    try {
        if (!fs.existsSync(COOLDOWN_FILE)) return 0;
        const data = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
        return data.ultimaAlertaTs || 0;
    } catch(e) { return 0; }
}

function guardarCooldown(ts) {
    try {
        fs.writeFileSync(COOLDOWN_FILE, JSON.stringify({ ultimaAlertaTs: ts }), 'utf8');
    } catch(e) { console.log('[HEARTBEAT] Error guardando cooldown:', e.message); }
}

const HEARTBEAT_INTERVAL = 30 * 60 * 1000; // 30 min
const ALERT_TEMP = 75;
const ALERT_RAM = 90;
const ALERT_DISK = 85;

let _clienteWA = null;
let _userId = null;

export function initHeartbeat(clienteWA, userId) {
    _clienteWA = clienteWA;
    _userId = userId;
    console.log('[HEARTBEAT] Iniciado');
    setInterval(runHeartbeat, HEARTBEAT_INTERVAL);
    // Primera ejecución después de 5 min
    setTimeout(runHeartbeat, 5 * 60 * 1000);
}

async function runHeartbeat() {
    console.log('[HEARTBEAT] Ejecutando checklist...');
    const alertas = [];

    try {
        // Temperatura
        const temp = parseFloat(execSync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0').toString()) / 1000;
        if (temp > ALERT_TEMP) alertas.push(`🌡️ Temperatura alta: ${temp.toFixed(1)}°C`);

        // RAM
        const memInfo = execSync('free | grep Mem').toString().split(/\s+/);
        const ramPct = Math.round((parseInt(memInfo[2]) / parseInt(memInfo[1])) * 100);
        if (ramPct > ALERT_RAM) alertas.push(`💾 RAM al ${ramPct}%`);

        // Disco
        const diskInfo = execSync("df / | tail -1").toString().split(/\s+/);
        const diskPct = parseInt(diskInfo[4]);
        if (diskPct > ALERT_DISK) alertas.push(`💿 Disco al ${diskPct}%`);

        // PM2 reinicios
        const pm2Info = execSync('pm2 jlist 2>/dev/null').toString();
        const pm2Data = JSON.parse(pm2Info);
        const bmo = pm2Data.find(p => p.name === 'bmo');
        if (bmo && bmo.pm2_env.restart_time > 150) alertas.push(`🔄 BMO se reinició ${bmo.pm2_env.restart_time} veces`);

        // Limpiar /tmp archivos viejos (+24h)
        execSync('find /tmp -name "*.docx" -mmin +1440 -delete 2>/dev/null; find /tmp -name "*.xlsx" -mmin +1440 -delete 2>/dev/null; find /tmp -name "bmo-project-*" -mtime +1 -exec rm -rf {} + 2>/dev/null || true');

    } catch(e) {
        console.log('[HEARTBEAT] Error en checklist:', e.message);
    }

    // Enviar alertas si hay — con cooldown persistido (2h)
    if (alertas.length > 0 && _clienteWA && _userId) {
        const ahora = Date.now();
        const ultimaAlerta = leerCooldown();
        if ((ahora - ultimaAlerta) > COOLDOWN_MS) {
            guardarCooldown(ahora);
            const msg = `⚠️ *BMO Heartbeat Alert*\n\n${alertas.join('\n')}\n\n_${new Date().toLocaleString('es-MX')}_`;
            try { await _clienteWA.sendMessage(_userId, msg); } catch(e) {}
            console.log('[HEARTBEAT] ⚠️ Alerta enviada, próxima en 2h');
        } else {
            const minRestantes = Math.round((COOLDOWN_MS - (ahora - ultimaAlerta)) / 60000);
            console.log(`[HEARTBEAT] 🔇 Alerta suprimida por cooldown (${minRestantes} min restantes)`);
        }
    }
}

export { runHeartbeat };

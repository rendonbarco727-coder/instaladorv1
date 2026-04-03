import { exec, spawn } from 'child_process';
import pkg from 'whatsapp-web.js';
const { MessageMedia } = pkg;
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Usuarios de confianza (además del admin principal) ──────────────────────
const USUARIOS_CONFIANZA = (process.env.ADMIN_NUMBERS || '').split(',').map(n => n.trim());

// ── Registro de tareas programadas ──────────────────────────────────────────
const TAREAS_FILE = path.join(__dirname, '..', 'tareas_programadas.json');
const tareasActivas = new Map(); // id -> intervalId/timeoutId

const cargarTareas = () => {
    try {
        if (fs.existsSync(TAREAS_FILE)) {
            return JSON.parse(fs.readFileSync(TAREAS_FILE, 'utf8'));
        }
    } catch(e) {}
    return [];
};

const guardarTareas = (tareas) => {
    try {
        fs.writeFileSync(TAREAS_FILE, JSON.stringify(tareas, null, 2));
    } catch(e) {}
};

// ── Ejecutar comando de terminal ─────────────────────────────────────────────
export async function ejecutarTerminal(comando, timeoutMs = 30000) {
    try {
        // Sanitizar solo caracteres realmente peligrosos para el proceso
        const { stdout, stderr } = await execAsync(comando, {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024, // 1MB output max
            shell: '/bin/bash'
        });
        const salida = (stdout + (stderr ? `\n[stderr]: ${stderr}` : '')).trim();
        return { success: true, data: salida || '(Sin salida)' };
    } catch(e) {
        return { success: false, error: e.message.slice(0, 500) };
    }
}

// ── Instalar software ────────────────────────────────────────────────────────
export async function instalarSoftware(paquete, gestor = 'auto') {
    try {
        let cmd;
        if (gestor === 'auto') {
            // Detectar gestor disponible
            if (paquete.includes('.py') || gestor === 'pip') {
                cmd = `pip install ${paquete} --break-system-packages -q 2>&1`;
            } else if (paquete.includes('/') || gestor === 'npm') {
                cmd = `npm install -g ${paquete} 2>&1`;
            } else {
                cmd = `sudo apt-get install -y ${paquete} 2>&1`;
            }
        } else if (gestor === 'pip') {
            cmd = `pip install ${paquete} --break-system-packages -q 2>&1`;
        } else if (gestor === 'npm') {
            cmd = `npm install -g ${paquete} 2>&1`;
        } else {
            cmd = `sudo apt-get install -y ${paquete} 2>&1`;
        }

        const { stdout } = await execAsync(cmd, { timeout: 120000 });
        const exito = !stdout.includes('Error') && !stdout.includes('error:');
        return { 
            success: exito, 
            data: exito ? `✅ ${paquete} instalado correctamente` : stdout.slice(0, 300)
        };
    } catch(e) {
        return { success: false, error: e.message.slice(0, 300) };
    }
}

// ── Controlar servicios systemd ──────────────────────────────────────────────
export async function controlarServicio(nombre, accion) {
    const accionesValidas = ['start', 'stop', 'restart', 'status', 'enable', 'disable', 'reload'];
    if (!accionesValidas.includes(accion)) {
        return { success: false, error: `Acción no válida. Usa: ${accionesValidas.join(', ')}` };
    }
    try {
        if (accion === 'status') {
            const { stdout } = await execAsync(`systemctl status ${nombre} --no-pager -l 2>&1`, { timeout: 10000 });
            return { success: true, data: stdout.slice(0, 800) };
        }
        const { stdout } = await execAsync(`sudo systemctl ${accion} ${nombre} 2>&1`, { timeout: 30000 });
        return { success: true, data: `Servicio ${nombre}: ${accion} ejecutado.\n${stdout}`.trim() };
    } catch(e) {
        return { success: false, error: e.message.slice(0, 300) };
    }
}

// ── Gestión de archivos ──────────────────────────────────────────────────────
export async function gestionArchivos(accion, rutaOrigen, rutaDestino = '', contenido = '') {
    try {
        switch(accion) {
            case 'leer': {
                if (!fs.existsSync(rutaOrigen)) return { success: false, error: 'Archivo no encontrado' };
                const data = fs.readFileSync(rutaOrigen, 'utf8');
                return { success: true, data: data.slice(0, 3000) + (data.length > 3000 ? '\n...(truncado)' : '') };
            }
            case 'escribir': {
                fs.mkdirSync(path.dirname(rutaOrigen), { recursive: true });
                fs.writeFileSync(rutaOrigen, contenido);
                return { success: true, data: `Archivo escrito: ${rutaOrigen}` };
            }
            case 'copiar': {
                fs.copyFileSync(rutaOrigen, rutaDestino);
                return { success: true, data: `Copiado: ${rutaOrigen} → ${rutaDestino}` };
            }
            case 'mover': {
                fs.renameSync(rutaOrigen, rutaDestino);
                return { success: true, data: `Movido: ${rutaOrigen} → ${rutaDestino}` };
            }
            case 'eliminar': {
                if (fs.statSync(rutaOrigen).isDirectory()) {
                    fs.rmSync(rutaOrigen, { recursive: true });
                } else {
                    fs.unlinkSync(rutaOrigen);
                }
                return { success: true, data: `Eliminado: ${rutaOrigen}` };
            }
            case 'listar': {
                const archivos = fs.readdirSync(rutaOrigen).map(f => {
                    const stats = fs.statSync(path.join(rutaOrigen, f));
                    return `${stats.isDirectory() ? '📁' : '📄'} ${f} (${(stats.size/1024).toFixed(1)}KB)`;
                });
                return { success: true, data: archivos.join('\n') || '(Carpeta vacía)' };
            }
            default:
                return { success: false, error: 'Acción no válida. Usa: leer, escribir, copiar, mover, eliminar, listar' };
        }
    } catch(e) {
        return { success: false, error: e.message.slice(0, 300) };
    }
}

// ── Programar tareas automáticas ─────────────────────────────────────────────
export async function programarTarea(nombre, comando, tipo, valor, clienteWA = null, userId = null) {
    try {
        const tareas = cargarTareas();
        const id = `tarea_${Date.now()}`;

        // Cancelar tarea existente con mismo nombre
        const existente = tareas.find(t => t.nombre === nombre);
        if (existente && tareasActivas.has(existente.id)) {
            clearInterval(tareasActivas.get(existente.id));
            clearTimeout(tareasActivas.get(existente.id));
            tareasActivas.delete(existente.id);
        }

        const nuevaTarea = { id, nombre, comando, tipo, valor, creadaEn: new Date().toISOString(), activa: true };

        const ejecutar = async () => {
            const resultado = await ejecutarTerminal(comando, 60000);
            console.log(`[AGENTE] Tarea "${nombre}" ejecutada:`, resultado.data || resultado.error);
            if (clienteWA && userId) {
                const msg = `🤖 *Tarea automática: ${nombre}*\n\`\`\`\n${(resultado.data || resultado.error).slice(0, 500)}\n\`\`\``;
                await clienteWA.sendMessage(userId, msg).catch(() => {});
            }
        };

        if (tipo === 'intervalo') {
            // valor en minutos
            const ms = parseInt(valor) * 60 * 1000;
            const timerId = setInterval(ejecutar, ms);
            tareasActivas.set(id, timerId);
            nuevaTarea.descripcion = `Cada ${valor} minutos`;
        } else if (tipo === 'hora') {
            // valor en formato "HH:MM"
            const [hh, mm] = valor.split(':').map(Number);
            const programarSiguiente = () => {
                const ahora = new Date();
                const objetivo = new Date();
                objetivo.setHours(hh, mm, 0, 0);
                if (objetivo <= ahora) objetivo.setDate(objetivo.getDate() + 1);
                const msHasta = objetivo - ahora;
                const timerId = setTimeout(async () => {
                    await ejecutar();
                    programarSiguiente(); // Reprogramar para mañana
                }, msHasta);
                tareasActivas.set(id, timerId);
            };
            programarSiguiente();
            nuevaTarea.descripcion = `Diariamente a las ${valor}`;
        } else if (tipo === 'una_vez') {
            // valor en minutos desde ahora
            const ms = parseInt(valor) * 60 * 1000;
            const timerId = setTimeout(async () => {
                await ejecutar();
                // Marcar como completada
                const ts = cargarTareas();
                const idx = ts.findIndex(t => t.id === id);
                if (idx >= 0) { ts[idx].activa = false; guardarTareas(ts); }
                tareasActivas.delete(id);
            }, ms);
            tareasActivas.set(id, timerId);
            nuevaTarea.descripcion = `Una vez en ${valor} minutos`;
        } else {
            return { success: false, error: 'Tipo inválido. Usa: intervalo, hora, una_vez' };
        }

        // Guardar en archivo (sin las referencias a cliente WA)
        const tareasActualizadas = tareas.filter(t => t.nombre !== nombre);
        tareasActualizadas.push(nuevaTarea);
        guardarTareas(tareasActualizadas);

        return { success: true, data: `✅ Tarea "${nombre}" programada: ${nuevaTarea.descripcion}\nComando: ${comando}` };
    } catch(e) {
        return { success: false, error: e.message.slice(0, 300) };
    }
}

// ── Listar/cancelar tareas ───────────────────────────────────────────────────
export async function listarTareas() {
    const tareas = cargarTareas().filter(t => t.activa);
    if (tareas.length === 0) return { success: true, data: 'No hay tareas programadas activas.' };
    const lista = tareas.map(t => `• *${t.nombre}* — ${t.descripcion}\n  Cmd: \`${t.comando}\``).join('\n');
    return { success: true, data: `📋 *Tareas activas (${tareas.length}):*\n${lista}` };
}

export async function cancelarTarea(nombre) {
    const tareas = cargarTareas();
    const tarea = tareas.find(t => t.nombre === nombre);
    if (!tarea) return { success: false, error: `Tarea "${nombre}" no encontrada` };
    if (tareasActivas.has(tarea.id)) {
        clearInterval(tareasActivas.get(tarea.id));
        clearTimeout(tareasActivas.get(tarea.id));
        tareasActivas.delete(tarea.id);
    }
    tarea.activa = false;
    guardarTareas(tareas);
    return { success: true, data: `✅ Tarea "${nombre}" cancelada` };
}

// ── Estado del sistema ───────────────────────────────────────────────────────
export async function estadoSistema() {
    try {
        const [cpu, mem, disco, temp, uptime] = await Promise.all([
            execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'").then(r => r.stdout.trim()).catch(() => '?'),
            execAsync("free -h | awk '/^Mem:/{print $3\"/\"$2}'").then(r => r.stdout.trim()).catch(() => '?'),
            execAsync("df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\" usado)\"}'").then(r => r.stdout.trim()).catch(() => '?'),
            execAsync("vcgencmd measure_temp 2>/dev/null || cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null | awk '{printf \"%.1f°C\", $1/1000}'").then(r => r.stdout.trim()).catch(() => '?'),
            execAsync("uptime -p").then(r => r.stdout.trim()).catch(() => '?')
        ]);
        return {
            success: true,
            data: `🖥️ *Estado del sistema:*\n🔥 CPU: ${cpu}%\n💾 RAM: ${mem}\n💿 Disco: ${disco}\n🌡️ Temp: ${temp}\n⏱️ Uptime: ${uptime}`
        };
    } catch(e) {
        return { success: false, error: e.message };
    }
}

// ── Verificar si usuario tiene acceso ───────────────────────────────────────
export function tieneAcceso(userId) {
    const numero = userId.replace('@c.us', '').replace('@lid', '');
    return USUARIOS_CONFIANZA.some(u => u === numero || userId.includes(u));
}

// ── Handler principal para el bot ────────────────────────────────────────────
export async function manejarComandoAgente(mensaje, userId, clienteWA) {
    if (!tieneAcceso(userId)) {
        return '🔒 No tienes permiso para usar el agente autónomo.';
    }

    const msg = mensaje.trim().toLowerCase();

    // Lenguaje natural para GUI
    if (/toma.*captura|captura.*pantalla|screenshot|screenshoot/i.test(mensaje)) {
        const ts = Date.now();
        const res = await ejecutarTerminal(`DISPLAY=:99 scrot /tmp/cap_${ts}.png && echo /tmp/cap_${ts}.png`, 15000);
        if (res.success) {
            const imgPath = `/tmp/cap_${ts}.png`;
            if (fs.existsSync(imgPath)) {
                const imgData = fs.readFileSync(imgPath);
                const media = new MessageMedia('image/png', imgData.toString('base64'), 'captura.png');
                await clienteWA.sendMessage(userId, media, { caption: '📸 Captura de pantalla' });
                return null;
            }
        }
        return '❌ No pude tomar la captura';
    }

    if (/abre?|lanza|ejecuta|inicia/i.test(mensaje) && !/agente/i.test(mensaje)) {
        const programas = {
            'calculadora': 'galculator',
            'calculator': 'galculator', 
            'editor': 'mousepad',
            'terminal': 'xterm',
            'navegador': 'chromium',
            'chrome': 'chromium',
            'firefox': 'firefox',
            'libreoffice': 'libreoffice',
            'writer': 'libreoffice --writer',
            'calc': 'libreoffice --calc',
            'impress': 'libreoffice --impress',
            'documento': 'libreoffice --writer',
            'hoja de calculo': 'libreoffice --calc',
            'presentacion': 'libreoffice --impress',
        };
        const nombre = Object.keys(programas).find(k => mensaje.toLowerCase().includes(k));
        if (nombre) {
            const prog = programas[nombre];
            const ts = Date.now();
            const res = await ejecutarTerminal(`DISPLAY=:99 ${prog} & sleep 3 && DISPLAY=:99 scrot /tmp/prog_${ts}.png && echo /tmp/prog_${ts}.png`, 15000);
            if (res.success) {
                const imgPath = `/tmp/prog_${ts}.png`;
                if (fs.existsSync(imgPath)) {
                    const imgData = fs.readFileSync(imgPath);
                    const media = new MessageMedia('image/png', imgData.toString('base64'), 'programa.png');
                    await clienteWA.sendMessage(userId, media, { caption: `✅ Abrí ${nombre}` });
                    return null;
                }
            }
        }
    }

    // Crear documentos con lenguaje natural
    if (/\b(crea|genera|haz|hazme|make|construye|arma|prepara|necesito|quiero|dame)\b.{0,30}\b(documento|doc|word|hoja|excel|xlsx|calculo|presentaci[oó]n|ppt|reporte|informe|tabla|archivo|spreadsheet)\b/i.test(mensaje) || /\b(excel|xlsx|hoja de calculo)\b.{0,20}\b(con|de|para|estos|mis|los)\b/i.test(mensaje)) {
        // Detectar flags antes de llamar
        const quiereTabla = /tablas?/i.test(mensaje);
        const quiereGrafica = /gr[aá]ficas?|charts?|diagramas?/i.test(mensaje);
        return await crearDocumento(mensaje, userId, clienteWA, null, quiereTabla, quiereGrafica);
    }

    // Comando: ejecutar terminal
    // Formato: "agente terminal: <comando>"
    if (msg.startsWith('agente terminal:')) {
        const cmd = mensaje.slice(16).trim();
        const res = await ejecutarTerminal(cmd, 60000);
        if (res.success) {
          // Detectar si el resultado es una ruta de imagen
          const imgMatch = res.data.match(/(\/[^\s]+\.(?:png|jpg|jpeg|gif))/i);
          if (imgMatch) {
            const imgPath = imgMatch[1].trim();
            
            if (fs.existsSync(imgPath)) {
              const imgData = fs.readFileSync(imgPath);
              
              const media = new MessageMedia('image/png', imgData.toString('base64'), 'captura.png');
              await clienteWA.sendMessage(userId, media, { caption: '📸 Captura de pantalla' });
              return null;
            }
          }
          return `\`\`\`\n${res.data.slice(0, 3000)}\n\`\`\``;
        }
        return `❌ Error: ${res.error}`;
    }

    // Comando: instalar software
    // Formato: "agente instalar: <paquete> [con pip|npm|apt]"
    if (msg.startsWith('agente instalar:')) {
        const partes = mensaje.slice(16).trim().split(' con ');
        const paquete = partes[0].trim();
        const gestor = partes[1]?.trim() || 'auto';
        const res = await instalarSoftware(paquete, gestor);
        return res.success ? res.data : `❌ Error: ${res.error}`;
    }

    // Comando: controlar servicio
    // Formato: "agente servicio <nombre> <accion>"
    if (msg.startsWith('agente servicio')) {
        const partes = mensaje.trim().split(' ');
        const nombre = partes[2];
        const accion = partes[3];
        if (!nombre || !accion) return '❌ Formato: agente servicio <nombre> <start|stop|restart|status>';
        const res = await controlarServicio(nombre, accion);
        return res.success ? res.data : `❌ Error: ${res.error}`;
    }

    // Comando: archivos
    // Formato: "agente archivo <accion> <ruta>"
    if (msg.startsWith('agente archivo')) {
        const partes = mensaje.trim().split(' ');
        const accion = partes[2];
        const ruta = partes[3];
        const ruta2 = partes[4] || '';
        if (!accion || !ruta) return '❌ Formato: agente archivo <leer|listar|eliminar> <ruta>';
        const res = await gestionArchivos(accion, ruta, ruta2);
        return res.success ? res.data : `❌ Error: ${res.error}`;
    }

    // Comando: programar tarea
    // Formato: "agente programar <nombre> cada <N> minutos: <comando>"
    // Formato: "agente programar <nombre> a las <HH:MM>: <comando>"
    // Formato: "agente programar <nombre> en <N> minutos: <comando>"
    if (msg.startsWith('agente programar')) {
        const matchIntervalo = mensaje.match(/agente programar (.+?) cada (\d+) minutos?:\s*(.+)/i);
        const matchHora = mensaje.match(/agente programar (.+?) a las (\d{1,2}:\d{2}):\s*(.+)/i);
        const matchUnaVez = mensaje.match(/agente programar (.+?) en (\d+) minutos?:\s*(.+)/i);

        let res;
        if (matchIntervalo) {
            res = await programarTarea(matchIntervalo[1].trim(), matchIntervalo[3].trim(), 'intervalo', matchIntervalo[2], clienteWA, userId);
        } else if (matchHora) {
            res = await programarTarea(matchHora[1].trim(), matchHora[3].trim(), 'hora', matchHora[2], clienteWA, userId);
        } else if (matchUnaVez) {
            res = await programarTarea(matchUnaVez[1].trim(), matchUnaVez[3].trim(), 'una_vez', matchUnaVez[2], clienteWA, userId);
        } else {
            return '❌ Formato:\n• `agente programar <nombre> cada <N> minutos: <cmd>`\n• `agente programar <nombre> a las <HH:MM>: <cmd>`\n• `agente programar <nombre> en <N> minutos: <cmd>`';
        }
        return res.success ? res.data : `❌ Error: ${res.error}`;
    }

    // Comando: listar tareas
    if (msg === 'agente tareas') {
        const res = await listarTareas();
        return res.data;
    }

    // Comando: cancelar tarea
    if (msg.startsWith('agente cancelar')) {
        const nombre = mensaje.trim().slice(15).trim();
        if (!nombre) return '❌ Formato: agente cancelar <nombre>';
        const res = await cancelarTarea(nombre);
        return res.success ? res.data : `❌ Error: ${res.error}`;
    }

    // Comando: estado del sistema
    if (msg === 'agente estado') {
        const res = await estadoSistema();
        return res.success ? res.data : `❌ Error: ${res.error}`;
    }

    // Ayuda
    if (msg === 'agente' || msg === 'agente ayuda') {
        return `🤖 *Agente Autónomo BMO - Comandos:*

🖥️ *Terminal:*
\`agente terminal: <comando>\`

📦 *Instalar software:*
\`agente instalar: <paquete>\`
\`agente instalar: <paquete> con pip\`

⚙️ *Servicios:*
\`agente servicio <nombre> status\`
\`agente servicio <nombre> restart\`

📁 *Archivos:*
\`agente archivo leer <ruta>\`
\`agente archivo listar <ruta>\`
\`agente archivo eliminar <ruta>\`

⏰ *Tareas programadas:*
\`agente programar <nombre> cada 30 minutos: <cmd>\`
\`agente programar <nombre> a las 08:00: <cmd>\`
\`agente programar <nombre> en 5 minutos: <cmd>\`
\`agente tareas\`
\`agente cancelar <nombre>\`

📊 *Sistema:*
\`agente estado\``;
    }

    return null; // No era un comando de agente
}

// ── Interacción GUI ──────────────────────────────────────────────────────────
export async function escribirEnPantalla(texto) {
    return ejecutarTerminal(`DISPLAY=:99 xdotool type --clearmodifiers --delay 50 "${texto}"`, 10000);
}

export async function presionarTecla(tecla) {
    return ejecutarTerminal(`DISPLAY=:99 xdotool key ${tecla}`, 5000);
}

export async function clickEnPantalla(x, y) {
    return ejecutarTerminal(`DISPLAY=:99 xdotool mousemove ${x} ${y} click 1`, 5000);
}

// ── LibreOffice / Documentos ─────────────────────────────────────────────────
export async function crearDocumento(instruccion, userId, clienteWA, rutaExistente=null, quiereTabla=false, quiereGrafica=false, silencioso=false) {
    // Pedir a Gemini que estructure el documento
    const prompt = `Convierte esta instruccion en JSON para crear un documento Word profesional. Responde SOLO JSON valido sin texto ni backticks.
Instruccion: "${instruccion}"

Si la instruccion menciona tabla, grafica, ventas, datos numericos por periodo, excel o calculo, usa formato calc:
{"tipo":"calc","titulo":"titulo aqui","encabezados":["Mes","Ventas"],"filas":[["Enero",150000],["Febrero",180000]]}

Si menciona presentacion, diapositivas o ppt:
{"tipo":"impress","titulo":"...","diapositivas":[{"titulo":"...","contenido":["punto1","punto2"]}]}

Para texto, carta, reporte, o cualquier otro documento:
{"tipo":"writer","titulo":"titulo descriptivo del documento","contenido":[{"tipo":"titulo","texto":"subtitulo de sección"},{"tipo":"parrafo","texto":"párrafo con el contenido completo"},{"tipo":"lista","texto":"item de lista"}]}

REGLAS IMPORTANTES:
1. El titulo del documento debe ser descriptivo (ej: "Reporte del Clima en Monterrey", NO "Temperatura actual")
2. Incluye TODOS los datos de la instruccion organizados en secciones con subtitulos
3. NO incluyas URLs ni links en el contenido
4. Si hay contenido existente y contenido nuevo, ponlos en secciones separadas con sus propios titulos
5. El contenido debe ser texto limpio y profesional
6. Responde SOLO el JSON, nada mas.`;

    const MISTRAL_KEY3 = process.env.MISTRAL_API_KEY || '';
    const bodyDoc = { model: 'mistral-small-latest', messages: [{ role: 'user', content: prompt }], max_tokens: 1500, temperature: 0.1 };
    const tmpDoc = '/tmp/bmo_doc_prompt_' + Date.now() + '.json';
    fs.writeFileSync(tmpDoc, JSON.stringify(bodyDoc));
    const mResult = await execAsync('curl -s --max-time 30 "https://api.mistral.ai/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer ' + MISTRAL_KEY3 + '" -d @' + tmpDoc, { timeout: 35000 });
    const mRaw = mResult.stdout;
    try { fs.unlinkSync(tmpDoc); } catch(e) {}
    const mData = JSON.parse(mRaw);
    let raw = mData.choices?.[0]?.message?.content || '{}';
    console.log('[CREADOC] Gemini raw:', raw.slice(0,200));
    raw = raw.replace(/```json|```/g, '').trim();
    // Limpiar caracteres extra
    raw = raw.replace(/^[^{]*/,'').replace(/[^}]*$/,'');
    const jsonStart = raw.indexOf('{'); const jsonEnd = raw.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) raw = raw.substring(jsonStart, jsonEnd + 1);
    let datos;
    try { datos = JSON.parse(raw); } 
    catch(e) { datos = { tipo: 'writer', titulo: instruccion.slice(0,60).replace(/[*#]/g,'').trim() || 'Documento BMO', contenido: instruccion.split('\n').filter(l=>l.trim()).map(l=>({tipo:'parrafo',texto:l.replace(/[*#]/g,'').trim()})) }; }
    
    // Fallbacks
    if (!datos.titulo) datos.titulo = 'Documento BMO';
    if (!datos.contenido) datos.contenido = [];
    // Solo sobrescribir tipo si Mistral no lo definió
    if (!datos.tipo) {
        if (/presentacion|diapositiva|ppt/i.test(instruccion)) datos.tipo = 'impress';
        else if (/\bexcel\b|\bxlsx\b/i.test(instruccion)) datos.tipo = 'calc';
        else datos.tipo = 'writer';
    }
    datos.con_tabla = quiereTabla;
    datos.con_grafica = quiereGrafica;
    
    const ts = Date.now();
    const ext = datos.tipo === 'calc' ? 'xlsx' : datos.tipo === 'impress' ? 'pptx' : 'docx';
    datos.ruta = (rutaExistente && typeof rutaExistente === 'string' && rutaExistente.startsWith('/tmp/')) ? rutaExistente : `/tmp/bmo_doc_${ts}.${ext}`;
    
    const tmpFile = `/tmp/bmo_input_${Date.now()}.json`;
    fs.writeFileSync(tmpFile, JSON.stringify(datos));
    const result = await ejecutarTerminal(
        `python3 /home/ruben/wa-ollama/evoluciones/libreoffice_bmo.py ${tmpFile}`,
        120000
    );
    
    console.log('[CREADOC] result:', JSON.stringify(result).slice(0,200));
    if (!result.success) return '❌ Error creando documento: ' + result.error;
    
    let respJson;
    try { respJson = JSON.parse(result.data); } 
    catch(e) { return '❌ Error procesando respuesta'; }
    
    if (!respJson.ok) return '❌ ' + respJson.error;
    
    const ruta = respJson.ruta;
    if (fs.existsSync(ruta)) {
        if (!silencioso) {
            const fileData = fs.readFileSync(ruta);
            const mimeTypes = {docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
            const mime = mimeTypes[ext] || 'application/octet-stream';
            const media = new MessageMedia(mime, fileData.toString('base64'), `${datos.titulo}.${ext}`);
            await clienteWA.sendMessage(userId, media, { caption: `📄 ${datos.titulo}` });
        }
        return ruta;
    }
    return '❌ No se pudo generar el archivo';
}

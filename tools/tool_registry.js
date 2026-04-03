import { activeDocuments } from "../core/document_state.js";
import { exec } from 'child_process';
import { buscarWebExa } from './buscar_web_exa.js';
import { leerWeb } from './leer_web.js';
import { promisify } from 'util';
import fs from 'fs';
import { callModel } from '../core/model_router.js';
import { registrarToolUsage } from '../observability/metrics.js';
import { logError } from '../observability/errors.js';

const execAsync = promisify(exec);

const COMANDOS_PROHIBIDOS = [
    // Destructivos del sistema
    'rm -rf /', 'rm -rf ~', 'rm -rf /home', 'rm -rf /etc', 'rm -rf /var',
    'mkfs', 'dd if=/dev/zero', 'dd if=/dev/urandom', ':(){:|:&};:',
    'chmod -R 777 /', 'chown -R', 'sudo rm -rf',
    // Red y exfiltración
    'curl.*|.*bash', 'wget.*|.*bash', 'curl.*|.*sh', 'wget.*|.*sh',
    'nc -e', 'ncat -e', 'bash -i', 'python.*-c.*socket',
    // Procesos críticos
    'kill -9 1', 'killall node', 'pm2 delete all', 'pm2 kill',
    'systemctl stop', 'shutdown', 'reboot', 'halt',
    // Crypto mining
    'xmrig', 'minerd', 'cpuminer',
    // Originales
    'rm -rf /', 'mkfs', 'dd if=', ':(){:|:&};:', 'chmod 777 /'
];

const TOOLS = {

    leer_web: async (input) => {
        const url = String(input).trim();
        console.log(`[TOOL] leer_web | ${url.slice(0, 80)}`);
        return await leerWeb(url);
    },

    buscar_web_exa: async (input, ctx) => {
        // Usar sesionId específico para no compartir contador entre tareas paralelas
        const sesionId = ctx?.sesionId || `exa_${ctx?.userId || 'global'}_${Date.now()}`;
        console.log(`[TOOL] buscar_web_exa | ${String(input).slice(0, 80)}`);
        const resultado = await buscarWebExa(String(input), sesionId);
        if (resultado) return resultado;
        return 'Sin resultados en EXA para: ' + String(input).slice(0, 60);
    },

    buscar_web: async (input) => {
        // Detectar consultas de noticias — intentar RSS primero
        const esNoticias = /noticia|noticias|ultimas|acontecer|hoy en|qué pasó/i.test(input);
        const esMexico = /m[eé]xico|mexicano|cdmx|monterrey|guadalajara/i.test(input);
        if (esNoticias) {
            const fuentes = esMexico ? [
                'https://feeds.bbci.co.uk/mundo/mexico/rss.xml',
                'https://www.eluniversal.com.mx/arc/outboundfeeds/rss/'
            ] : [
                'https://feeds.bbci.co.uk/mundo/rss.xml'
            ];
            for (const fuente of fuentes) {
                try {
                    const tmpRss = `/tmp/rss_${Date.now()}.sh`;
                    const fs2 = await import('fs');
                    fs2.default.writeFileSync(tmpRss, `curl -s --max-time 8 "${fuente}" | grep -o '<title>[^<]*</title>' | head -6 | sed 's/<[^>]*>//g'`);
                    const { stdout } = await execAsync(`bash ${tmpRss}`);
                    fs2.default.unlinkSync(tmpRss);
                    const titulos = stdout.trim().split('\n').filter(t => t.length > 10 && !t.includes('RSS') && !t.includes('BBC Mundo')).slice(0,5);
                    if (titulos.length >= 2) return '📰 Noticias de México:\n' + titulos.join('\n');
                } catch(e) {}
            }
        }

                // Circuit breaker: si falló 3 veces en los últimos 60s, no reintentar
        const ahora = Date.now();
        if (!global._webCircuit) global._webCircuit = { fallos: 0, ultimoFallo: 0 };
        const cb = global._webCircuit;
        if (cb.fallos >= 5 && (ahora - cb.ultimoFallo) < 30000) {
            console.log('[CIRCUIT_BREAKER] buscar_web bloqueado por fallos recientes');
            return `Sin resultados (circuit breaker activo por ${Math.round((60000-(ahora-cb.ultimoFallo))/1000)}s)`;
        }

        const query = encodeURIComponent(input);
        try {
            // Intentar DuckDuckGo instant answers
            const { stdout } = await execAsync(`curl -s --max-time 10 "https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1"`);
            const data = JSON.parse(stdout);
            const abstract = data.AbstractText || '';
            const answer = data.Answer || '';
            const related = (data.RelatedTopics || []).slice(0, 3).map(t => t.Text || '').filter(t => t.length > 20).join('. ');
            const resultado = answer || abstract || related;
            if (resultado && resultado.length > 15) {
                if (global._webCircuit) global._webCircuit.fallos = 0;
                return resultado.slice(0, 800);
            }
        } catch(e) {}
        try {
            // Fallback: DuckDuckGo HTML search scraping ligero
            const { stdout } = await execAsync(`curl -s --max-time 12 -A "Mozilla/5.0" "https://html.duckduckgo.com/html/?q=${query}" | grep -o '<a class="result__snippet">[^<]*</a>' | head -3 | sed 's/<[^>]*>//g'`);
            const texto = stdout.trim();
            if (texto && texto.length > 15) return texto.slice(0, 800);
        } catch(e) {}
        try {
            // Fallback 2: Wikipedia en español
            const termino = encodeURIComponent(input.replace(/hoy|precio|actual|cotizacion/gi,'').trim());
            const { stdout } = await execAsync(`curl -s --max-time 10 "https://es.wikipedia.org/api/rest_v1/page/summary/${termino}"`);
            const wiki = JSON.parse(stdout);
            if (wiki.extract && wiki.extract.length > 30) return wiki.extract.slice(0, 600);
        } catch(e) {}
        // Registrar fallo en circuit breaker
        if (!global._webCircuit) global._webCircuit = { fallos: 0, ultimoFallo: 0 };
        global._webCircuit.fallos++;
        global._webCircuit.ultimoFallo = Date.now();
        setTimeout(() => { if (global._webCircuit) { global._webCircuit.fallos = 0; global._webCircuit.ultimoFallo = 0; } }, 60000);
        return `No encontré información sobre: ${input}`;
    },

    buscar_precio: async (input) => {
        const inputLower = input.toLowerCase();
        // Crypto
        const cryptoMap = { bitcoin:'bitcoin', btc:'bitcoin', ethereum:'ethereum', eth:'ethereum', solana:'solana', sol:'solana', doge:'dogecoin', xrp:'ripple', bnb:'binancecoin', ada:'cardano' };
        const cryptoKey = Object.keys(cryptoMap).find(k => inputLower.includes(k));
        if (cryptoKey) {
            try {
                const id = cryptoMap[cryptoKey];
                const { stdout } = await execAsync(`curl -s --max-time 10 "https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd,mxn"`);
                const data = JSON.parse(stdout);
                const info = data[id];
                if (info) return `${id.charAt(0).toUpperCase()+id.slice(1)}: $${info.usd} USD / $${info.mxn} MXN`;
            } catch(e) {}
        }
        // Divisas
        if (/d[oó]lar|usd|euro|eur|libra|gbp|divisa|tipo de cambio|cambio/i.test(input)) {
            try {
                const par = inputLower.includes('euro') ? 'EUR' : inputLower.includes('libra') ? 'GBP' : 'USD';
                const { stdout } = await execAsync(`curl -s --max-time 10 "https://open.er-api.com/v6/latest/${par}"`);
                const fx = JSON.parse(stdout);
                if (fx.result === 'success' && fx.rates) {
                    const mxn = fx.rates.MXN ? `MXN: ${fx.rates.MXN.toFixed(4)}` : '';
                    const eur = fx.rates.EUR ? `EUR: ${fx.rates.EUR.toFixed(4)}` : '';
                    const usd = par !== 'USD' && fx.rates.USD ? `USD: ${fx.rates.USD.toFixed(4)}` : '';
                    const rates = [mxn, eur, usd].filter(Boolean).join(' | ');
                    return `Tipo de cambio ${par}: ${rates} (${new Date(fx.time_last_update_utc).toLocaleDateString('es-MX')})`;
                }
            } catch(e) {}
        }
        return `No encontré precio para: ${input}`;
    },

    buscar_clima: async (input) => {
        // Limpiar input — extraer solo nombre de ciudad (quitar datos previos inyectados)
        let ciudad = input
            .replace(/Ciudad no encontrada:\s*/gi, '')
            .replace(/\d+\.?\d*°C.*/g, '')
            .replace(/viento.*/gi, '')
            .replace(/hace \d+ días?/gi, '')
            .replace(/clima en|el clima de|tiempo en/gi, '')
            .trim()
            .split('\n')[0]
            .split(':')[0]
            .trim();
        if (!ciudad || ciudad.length < 2) ciudad = input.split(':')[0].trim();
        // Quitar sufijos de país como ", MX" ", Mexico" ", NL" que confunden al geocoder
        ciudad = ciudad.replace(/,?\s*(MX|Mexico|México|NL|Nuevo León|NL|BC|CDMX)$/gi, '').trim();
        const city = encodeURIComponent(ciudad);
        const geo = JSON.parse((await execAsync(`curl -s --max-time 8 "https://geocoding-api.open-meteo.com/v1/search?name=${city}&count=1"`)).stdout);
        const loc = geo.results?.[0];
        if (!loc) return `Ciudad no encontrada: ${ciudad}`;
        const w = JSON.parse((await execAsync(`curl -s --max-time 8 "https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current_weather=true&hourly=relativehumidity_2m"`)).stdout);
        const cw = w.current_weather;
        const humedad = w.hourly?.relativehumidity_2m?.[0] || 'N/A';
        return `${loc.name}, ${loc.country_code}: ${cw.temperature}°C, viento ${cw.windspeed} km/h, humedad ${humedad}%`;
    },

    ejecutar_terminal: async (input) => {
        // SANITIZACION: bloquear solo inyeccion real
        const cmdCheck = input.startsWith('cwd:') ? input.split('|').slice(1).join('|') : input;
        const tieneInyeccion = (
            cmdCheck.includes('`') ||
            cmdCheck.includes('$(') ||
            /;\s*(rm|curl|wget|bash|sh|python|nc|ncat|chmod)/.test(cmdCheck)
        );
        if (tieneInyeccion) {
            console.log('[SEGURIDAD] Bloqueado: ' + input.slice(0,50));
            return 'Comando bloqueado por seguridad';
        }
        if (COMANDOS_PROHIBIDOS.some(cmd => input.includes(cmd))) return 'Comando prohibido';
        // Soporte para cwd: "cwd:/ruta|comando"
        let cwd = '/home/ruben/wa-ollama';
        let cmd = input;
        if (input.startsWith('cwd:')) {
            const sep = input.indexOf('|');
            if (sep !== -1) {
                cwd = input.slice(4, sep).trim();
                cmd = input.slice(sep + 1).trim();
            }
        }
        // Filtrar comandos que son texto plano (no ejecutables)
        // Extraer comando real si el input fue sobreescrito por el Critic con mensaje de error
        const cmdMatch = cmd.match(/INSTRUCCIÓN ORIGINAL:\s*(.+)/s);
        if (cmdMatch) cmd = cmdMatch[1].trim();
        if (/^[A-ZÁÉÍÓÚ]/.test(cmd) && !cmd.startsWith('/') && !cmd.includes('&&') && !cmd.includes('git') && !cmd.includes('gh') && !cmd.includes('npm') && !/^(ls|cat|echo|find|grep|ps|df|free|pwd|whoami|uname)/.test(cmd)) {
            return 'Error: input no es un comando válido';
        }
        try {
            const { stdout, stderr } = await execAsync(cmd, { 
                timeout: 60000, 
                cwd,
                maxBuffer: 1024 * 1024 * 2, // 2MB máximo output
            });
            return (stdout || stderr || 'OK').slice(0, 2000);
        } catch(e) {
            const errMsg = e.message || '';
            // Self-healing: módulo Python faltante
            const pyModule = errMsg.match(/ModuleNotFoundError: No module named '([^']+)'/)?.[1];
            if (pyModule) {
                console.log(`[SELF-HEAL] Instalando módulo Python: ${pyModule}`);
                try {
                    await execAsync(`pip3 install ${pyModule} --break-system-packages`, { timeout: 120000 });
                    console.log(`[SELF-HEAL] ✅ ${pyModule} instalado, reintentando...`);
                    const { stdout, stderr } = await execAsync(cmd, { 
                timeout: 60000, 
                cwd,
                maxBuffer: 1024 * 1024 * 2, // 2MB máximo output
            });
                    return (stdout || stderr || 'OK').slice(0, 2000);
                } catch(installErr) {
                    return `Error: No se pudo instalar ${pyModule}: ${installErr.message.slice(0, 200)}`;
                }
            }
            // Self-healing: comando no encontrado
            const missingCmd = errMsg.match(/(?:bash|sh): ([\w-]+): command not found/)?.[1];
            if (missingCmd) {
                console.log(`[SELF-HEAL] Comando no encontrado: ${missingCmd}`);
                try {
                    await execAsync(`sudo apt-get install -y ${missingCmd} 2>/dev/null || npm install -g ${missingCmd} 2>/dev/null`, { timeout: 120000 });
                    console.log(`[SELF-HEAL] ✅ ${missingCmd} instalado, reintentando...`);
                    const { stdout, stderr } = await execAsync(cmd, { 
                timeout: 60000, 
                cwd,
                maxBuffer: 1024 * 1024 * 2, // 2MB máximo output
            });
                    return (stdout || stderr || 'OK').slice(0, 2000);
                } catch(installErr) {
                    return `Error: Comando '${missingCmd}' no disponible en el sistema.`;
                }
            }
            return `Error en ejecutar_terminal: ${e.message.slice(0, 500)}`;
        }
    },

    generar_contenido: async (input, ctx) => {
        // Si hay documento activo, agregar contexto conversacional
        const docActivo = ctx?.active_document;
        if (docActivo && !input.includes('RESULTADO_')) {
            const ext = docActivo.split('.').pop();
            const tipos = { xlsx: 'Excel', docx: 'Word', pptx: 'PowerPoint' };
            const tipo = tipos[ext] || 'documento';
            const nombre = docActivo.split('/').pop();
            input = `[Contexto: Tienes un ${tipo} activo: ${nombre}. Responde de forma natural y amigable como asistente personal. Si te preguntan algo fuera del documento, responde brevemente y ofrece continuar con el ${tipo}] ${input}`;
        }
        // Si el input ya contiene datos reales, devolverlos directamente sin llamar a Mistral
        const esPromptGeneracion = /^(genera|crea|redacta|escribe|elabora|basado en|usando estos)/i.test(input.trim());
        const yaTieneDatos = !esPromptGeneracion && (
            (input.includes('USD') && input.includes('MXN')) ||
            (input.includes('°C') && input.includes('km/h')) ||
            (input.includes('Bitcoin:') || input.includes('Ethereum:')) ||
            /Tipo de cambio.+\d+\.\d+/.test(input)
        );
        if (yaTieneDatos) {
            // Extraer solo la línea con los datos
            const linea = input.split('\n').find(l =>
                l.includes('USD') || l.includes('°C') || l.includes('Bitcoin') || l.includes('Tipo de cambio')
            ) || input;
            return linea.trim().slice(0, 500);
        }
        // Grounding forzado: si hay datos reales de web/EXA, el modelo NO puede ignorarlos
        const tieneResultados = input.includes('RESULTADO_') || input.includes('RESULTADO:') || input.includes('[WEB]') || input.includes('[EXA]');
        const promptFinal = tieneResultados
            ? `Eres un asistente que responde ÚNICAMENTE basándose en los datos provistos a continuación. PROHIBIDO usar conocimiento interno, fechas de entrenamiento ni frases como "en la fecha de mi última actualización". Si los datos están incompletos, dilo explícitamente.\n\nDATOS REALES DISPONIBLES:\n${input}\n\nResponde en español, de forma concisa y directa, usando SOLO los datos anteriores.`
            : `Genera el siguiente contenido completo en español, sin preámbulos ni notas al final: ${input}`;
        return await callModel('generacion', promptFinal, { max_tokens: 1500 });
    },

    escribir_archivo: async (input) => {
        const idx = input.indexOf('|');
        if (idx === -1) return 'Formato: ruta|contenido';
        const ruta = input.slice(0, idx).trim();
        const contenido = input.slice(idx + 1).trim();
        fs.writeFileSync(ruta, contenido, 'utf8');
        return `Guardado: ${ruta}`;
    },

    leer_archivo: async (input) => {
        return fs.readFileSync(input.trim(), 'utf8').slice(0, 2000);
    },

    estado_sistema: async () => {
        const { stdout } = await execAsync(
            `echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}')%" && ` +
            `free -h | awk '/Mem/{print "RAM: "$3"/"$2}' && ` +
            `df -h / | awk 'NR==2{print "Disco: "$3"/"$2" ("$5")"}' && ` +
            `(vcgencmd measure_temp 2>/dev/null || echo "Temp: N/A")`
        );
        return stdout.trim();
    },

    instalar_software: async (input) => {
        await execAsync(`sudo apt-get install -y ${input} 2>&1`, { timeout: 120000 });
        return `Instalado: ${input}`;
    },

    controlar_servicio: async (input) => {
        const parts = input.trim().split(' ');
        const servicio = parts[0], accion = parts[1] || 'status';
        const { stdout } = await execAsync(`sudo systemctl ${accion} ${servicio} 2>&1`);
        return stdout || `${servicio} ${accion}`;
    },

    crear_documento: async (input, ctx) => {
        const { crearDocumento } = await import('../evoluciones/agente_autonomo.js');
        const result = await crearDocumento(input, ctx.userId, ctx.clienteWA);
        // result ahora es la ruta directamente (string) o null si falló
        if (result && typeof result === 'string' && result.startsWith('/tmp/')) {
            ctx.active_document = result;
            if (ctx.userId) activeDocuments.set(ctx.userId, result);
            console.log(`[TOOL] crear_documento → active_document=${result}`);
            return result;
        }
        return 'Documento creado y enviado';
    },

    editar_documento: async (input, ctx) => {
        const fsEd = await import('fs');
        const { exec: execEd } = await import('child_process');
        const { promisify: promisifyEd } = await import('util');
        const execAsyncEd = promisifyEd(execEd);

        // input formato: "ruta|instruccion" o solo instruccion si ctx.active_document existe
        let ruta = ctx?.active_document || '';
        let instruccion = String(input);
        // Formato especial desde CONTINUITY: "editar_documento|ruta|instruccion"
        const partsInput = String(input).split('|');
        if (partsInput.length >= 2) {
            const posibleRuta = partsInput[0].trim();
            if (posibleRuta.startsWith('/tmp/') && posibleRuta.endsWith('.docx')) {
                ruta = posibleRuta;
                instruccion = partsInput.slice(1).join('|').trim();
            } else if (partsInput.length >= 2) {
                ruta = partsInput[0].trim() || ruta;
                instruccion = partsInput.slice(1).join('|').trim();
            }
        }

        if (!ruta || !fsEd.default.existsSync(ruta)) {
            // Si no hay documento activo, crear uno nuevo
            const { crearDocumento } = await import('../evoluciones/agente_autonomo.js');
            await crearDocumento(instruccion, ctx.userId, ctx.clienteWA);
            return 'Documento creado y enviado (no había documento activo para editar)';
        }

        // Leer contenido actual del docx con python
        const tmpScript = `/tmp/read_doc_${Date.now()}.py`;
        const tmpOut = `/tmp/doc_content_${Date.now()}.txt`;
        fsEd.default.writeFileSync(tmpScript, `
from docx import Document
import sys
doc = Document('${ruta}')
text = '\n'.join([p.text for p in doc.paragraphs if p.text.strip()])
with open('${tmpOut}', 'w') as f:
    f.write(text[:3000])
`);
        const { promisify } = await import('util');
        const { exec } = await import('child_process');
        

        try { await execAsyncEd(`python3 ${tmpScript}`); } catch(e) {}
        let contenidoActual = '';
        try { contenidoActual = fsEd.default.readFileSync(tmpOut, 'utf8'); } catch(e) {}
        try { fsEd.default.unlinkSync(tmpScript); fsEd.default.unlinkSync(tmpOut); } catch(e) {}

        // Pasar a crearDocumento con el contenido actual + instrucción de edición
        const instruccionCompleta = contenidoActual
            ? `Edita y mejora este documento existente:\n${contenidoActual}\n\nInstrucción de edición: ${instruccion}`
            : instruccion;

        // Appendar contenido nuevo via Python leyendo JSON (evita problemas de escape)
        const { execSync: execSyncEd2 } = await import('child_process');
        const tsApp = Date.now();
        const tmpJsonApp = `/tmp/bmo_app_${tsApp}.json`;
        const tmpPyApp   = `/tmp/bmo_app_${tsApp}.py`;
        fsEd.default.writeFileSync(tmpJsonApp, JSON.stringify({ ruta, contenido: instruccion }));
        const pyScript = `import json
from docx import Document
from docx.shared import Pt, RGBColor

with open('${tmpJsonApp}', encoding='utf-8') as f:
    data = json.load(f)

doc = Document(data['ruta'])
doc.add_paragraph()

for linea in data['contenido'].split('\\n'):
    linea = linea.strip().lstrip('*#|-: ').strip()
    if not linea or linea.startswith('http') or linea.startswith('🔗'):
        continue
    if linea.startswith('**') and linea.endswith('**'):
        p = doc.add_paragraph()
        run = p.add_run(linea.strip('*'))
        run.bold = True
        run.font.size = Pt(12)
        run.font.color.rgb = RGBColor(0x1F, 0x49, 0x7D)
    elif linea.startswith('###') or linea.startswith('##'):
        p = doc.add_paragraph()
        run = p.add_run(linea.lstrip('#').strip())
        run.bold = True
        run.font.size = Pt(11)
        run.font.color.rgb = RGBColor(0x1F, 0x49, 0x7D)
    else:
        doc.add_paragraph(linea)

doc.save(data['ruta'])
print('OK')
`;
        fsEd.default.writeFileSync(tmpPyApp, pyScript);
        let appendOk = false;
        try {
            execSyncEd2(`python3 ${tmpPyApp}`);
            appendOk = true;
            console.log('[TOOL] append OK via JSON');
        } catch(e) {
            console.log('[TOOL] append falló:', e.message.slice(0, 100));
        }
        try { fsEd.default.unlinkSync(tmpPyApp); fsEd.default.unlinkSync(tmpJsonApp); } catch(e) {}

        if (!appendOk) {
            const { crearDocumento } = await import('../evoluciones/agente_autonomo.js');
            await crearDocumento(instruccionCompleta, ctx.userId, ctx.clienteWA, ruta, false, false, true);
        }

        // Enviar archivo actualizado
        if (fsEd.default.existsSync(ruta)) {
            const wwjs = await import('whatsapp-web.js');
            const MM = wwjs.MessageMedia || wwjs.default?.MessageMedia;
            const fileData = fsEd.default.readFileSync(ruta);
            const media = new MM('application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileData.toString('base64'), 'documento.docx');
            await ctx.clienteWA.sendMessage(ctx.userId, media, { caption: '📄 Documento actualizado' });
        }
        return `ok`;
    },

    github_manager: async (input, ctx) => {
        // Operaciones: repos, files, read, edit, delete, commits, pages, crear_repo, publicar
        const parts = String(input).split('|');
        const operacion = parts[0]?.trim().toLowerCase();
        const param1 = parts[1]?.trim() || '';
        const param2 = parts[2]?.trim() || '';
        const param3 = parts[3]?.trim() || '';

        let token = process.env.GITHUB_TOKEN || '';
        if (!token) {
            // Fallback: leer directo del .env
            try {
                const fs_env = await import('fs');
                const path_env = await import('path');
                const envPath = path_env.default.resolve('/home/ruben/wa-ollama/.env');
                const envContent = fs_env.default.readFileSync(envPath, 'utf8');
                const match = envContent.match(/^GITHUB_TOKEN=(.+)$/m);
                if (match) token = match[1].trim();
            } catch(e) {}
        }
        if (!token) return 'GitHub no configurado. Falta GITHUB_TOKEN en .env';

        const { execSync: execS } = await import('child_process');
        const fs3 = await import('fs');

        const gh = (url, method='GET', body=null) => {
            const bodyFlag = body ? `--data '${JSON.stringify(body).replace(/'/g, "\x27")}'` : '';
            const r = execS(`curl -s --max-time 15 -X ${method} -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" ${bodyFlag} "https://api.github.com/${url}"`, {encoding:'utf8'});
            try { return JSON.parse(r); } catch(e) { return { message: r.slice(0,200) }; }
        };

        const getUser = () => {
            try { return gh('user').login; } catch(e) { return 'rendonbarco727-coder'; }
        };

        try {
            if (operacion === 'repos_lista') {
                const repos = gh('user/repos?sort=updated&per_page=20');
                if (!Array.isArray(repos)) return '';
                // El nombre sugerido viene como param1 para filtrarlo
                const nombreExcluir = param1 || '';
                return repos.map(r => r.name)
                    .filter(n => n.toLowerCase() !== nombreExcluir.toLowerCase())
                    .join(',');
            }

            if (operacion === 'repos' || operacion === 'list_repos') {
                const repos = gh('user/repos?sort=updated&per_page=20');
                if (!Array.isArray(repos)) return 'Error al listar repos: ' + (repos.message||'');
                return '📦 *Tus repositorios:*\n' + repos.map((r,i) =>
                    `${i+1}. *${r.name}* (${r.private?'🔒privado':'🌐publico'}) — ${r.updated_at?.slice(0,10)}${r.description?' — '+r.description:''}`
                ).join('\n');
            }

            if (operacion === 'files' || operacion === 'list_files') {
                const repo = param1 || 'bmo-jarvis-hub';
                const path2 = param2 || '';
                const user = getUser();
                const files = gh(`repos/${user}/${repo}/contents/${path2}`);
                if (!Array.isArray(files)) return `No se pudo listar ${repo}/${path2}: ` + (files.message||'');
                const dirs = files.filter(f => f.type==='dir');
                const archs = files.filter(f => f.type!=='dir');
                let resp = `📁 *${repo}${path2?'/'+path2:''}*\n`;
                if (dirs.length) resp += '\n*Carpetas:*\n' + dirs.map(f => `  📁 ${f.name}`).join('\n');
                if (archs.length) resp += '\n*Archivos:*\n' + archs.map(f => `  📄 ${f.name}${f.size?' ('+Math.round(f.size/1024)+'kb)':''}`).join('\n');
                return resp;
            }

            if (operacion === 'read' || operacion === 'leer') {
                const repo = param1 || 'bmo-jarvis-hub';
                const archivo = param2;
                if (!archivo) return 'Formato: read|repo|archivo.html';
                const user = getUser();
                const fileInfo = gh(`repos/${user}/${repo}/contents/${archivo}`);
                if (fileInfo.message) return 'Archivo no encontrado: ' + fileInfo.message;
                const contenido = Buffer.from(fileInfo.content, 'base64').toString('utf8');
                return `📄 *${archivo}* en *${repo}*:\n\n${contenido.slice(0,1500)}${contenido.length>1500?'\n...(truncado)':''}`;
            }

            if (operacion === 'edit' || operacion === 'editar') {
                const repo = param1 || 'bmo-jarvis-hub';
                const archivo = param2;
                const contenido = param3;
                if (!archivo || !contenido) return 'Formato: edit|repo|archivo|contenido';
                const user = getUser();
                const contentB64 = Buffer.from(contenido).toString('base64');
                let sha = null;
                try { const ex = gh(`repos/${user}/${repo}/contents/${archivo}`); if (ex.sha) sha = ex.sha; } catch(e) {}
                const body = { message: `BMO: actualizado ${archivo}`, content: contentB64 };
                if (sha) body.sha = sha;
                const result = gh(`repos/${user}/${repo}/contents/${archivo}`, 'PUT', body);
                if (result.content) return `✅ *${archivo}* ${sha?'actualizado':'creado'} en *${repo}*`;
                return 'Error al editar: ' + (result.message||JSON.stringify(result).slice(0,150));
            }

            if (operacion === 'delete' || operacion === 'borrar') {
                const repo = param1;
                const archivo = param2;
                if (!repo || !archivo) return 'Formato: delete|repo|archivo';
                const user = getUser();
                const fileInfo = gh(`repos/${user}/${repo}/contents/${archivo}`);
                if (fileInfo.message) return 'Archivo no encontrado: ' + fileInfo.message;
                gh(`repos/${user}/${repo}/contents/${archivo}`, 'DELETE', { message: `BMO: eliminado ${archivo}`, sha: fileInfo.sha });
                return `🗑️ *${archivo}* eliminado de *${repo}*`;
            }

            // Borrar todos los archivos con cierta extensión
            if (operacion === 'delete_ext' || operacion === 'borrar_ext') {
                const repo = param1 || 'bmo-jarvis-hub';
                const ext = param2?.replace(/^\./, '') || '';
                if (!ext) return 'Formato: delete_ext|repo|extension (ej: delete_ext|bmo-jarvis-hub|docx)';
                const user = getUser();
                const files = gh(`repos/${user}/${repo}/contents/`);
                if (!Array.isArray(files)) return 'Error listando repo: ' + (files.message||'');
                const targets = files.filter(f => f.name.endsWith('.' + ext));
                if (!targets.length) return `No hay archivos .${ext} en *${repo}*`;
                const borrados = [];
                const errores = [];
                for (const f of targets) {
                    try {
                        gh(`repos/${user}/${repo}/contents/${f.name}`, 'DELETE', { message: `BMO: eliminado ${f.name}`, sha: f.sha });
                        borrados.push(f.name);
                    } catch(e) {
                        errores.push(f.name);
                    }
                }
                let resp = `🗑️ Borrados ${borrados.length} archivos .${ext} de *${repo}*:\n` + borrados.map(n => `  • ${n}`).join('\n');
                if (errores.length) resp += `\n⚠️ Fallaron: ${errores.join(', ')}`;
                return resp;
            }

            if (operacion === 'commits') {
                const repo = param1 || 'bmo-jarvis-hub';
                const user = getUser();
                const commits = gh(`repos/${user}/${repo}/commits?per_page=8`);
                if (!Array.isArray(commits)) return 'Error: ' + (commits.message||'');
                return `📋 *Commits en ${repo}:*\n` + commits.map((c,i) =>
                    `${i+1}. ${c.commit?.message?.slice(0,60)} (${c.commit?.author?.date?.slice(0,10)})`
                ).join('\n');
            }

            if (operacion === 'pages' || operacion === 'paginas') {
                const repo = param1 || 'bmo-jarvis-hub';
                const user = getUser();
                const files = gh(`repos/${user}/${repo}/contents/`);
                if (!Array.isArray(files)) return 'Error: ' + (files.message||'');
                const htmlFiles = files.filter(f => f.name.endsWith('.html'));
                if (!htmlFiles.length) return `No hay páginas HTML en ${repo}`;
                return `🌐 *Páginas en ${repo}:*\n` + htmlFiles.map((f,i) =>
                    `${i+1}. ${f.name}\n   https://${user}.github.io/${repo}/${f.name}`
                ).join('\n');
            }

            if (operacion === 'crear_repo' || operacion === 'new_repo') {
                const nombre = param1;
                const descripcion = param2 || 'Creado por BMO';
                const esPrivado = param3 === 'privado';
                if (!nombre) return 'Formato: crear_repo|nombre|descripcion|publico_o_privado';
                const result = gh('user/repos', 'POST', { name: nombre, description: descripcion, private: esPrivado, auto_init: true });
                if (result.html_url) {
                    if (!esPrivado) {
                        try {
                            const user = getUser();
                            execS(`gh api repos/${user}/${nombre}/pages --method POST -f 'source[branch]=main' -f 'source[path]=/'`, {encoding:'utf8'});
                        } catch(e) {}
                    }
                    return `✅ Repo *${nombre}* creado:\n🔗 ${result.html_url}${!esPrivado?'\n🌐 Pages: https://'+result.owner?.login+'.github.io/'+nombre:''}`;
                }
                if (result.message?.includes('already exists')) return `El repo *${nombre}* ya existe.`;
                return 'Error creando repo: ' + (result.message||JSON.stringify(result).slice(0,150));
            }

            if (operacion === 'publicar') {
                const repo = param1 || 'bmo-jarvis-hub';
                const archivo = param2;
                const contenidoORuta = param3;
                if (!archivo) return 'Formato: publicar|repo|nombre_archivo|contenido_o_ruta';
                const user = getUser();
                let contenido = contenidoORuta;
                if (contenidoORuta && fs3.default.existsSync(contenidoORuta)) {
                    contenido = fs3.default.readFileSync(contenidoORuta, 'utf8');
                }
                if (!contenido) return 'No se proporcionó contenido para publicar';
                const contentB64 = Buffer.from(contenido).toString('base64');
                let sha = null;
                try { const ex = gh(`repos/${user}/${repo}/contents/${archivo}`); if (ex.sha) sha = ex.sha; } catch(e) {}
                const body = { message: `BMO: publicado ${archivo}`, content: contentB64 };
                if (sha) body.sha = sha;
                const result = gh(`repos/${user}/${repo}/contents/${archivo}`, 'PUT', body);
                if (result.content) return `✅ Publicado *${archivo}* en *${repo}*\n🌐 https://${user}.github.io/${repo}/${archivo}`;
                return 'Error publicando: ' + (result.message||JSON.stringify(result).slice(0,150));
            }

            return `Operaciones:\n• repos\n• files|repo|carpeta\n• read|repo|archivo\n• edit|repo|archivo|contenido\n• delete|repo|archivo\n• commits|repo\n• pages|repo\n• crear_repo|nombre|desc|publico\n• publicar|repo|archivo|contenido`;
        } catch(e) {
            return 'Error GitHub: ' + e.message.slice(0,200);
        }
    },

    generar_html: async (input, ctx) => {
        // Generar HTML completo usando Gemini/Mistral
        const { callModel } = await import('../core/model_router.js');
        const inputLimpio = String(input).replace(/\[Contexto:.*?\]/gs, '').trim();
        const html = await callModel('generacion',
            'Genera SOLO el código HTML completo para: ' + inputLimpio + '\n\nREGLAS ESTRICTAS:\n1. SOLO devuelve HTML puro, nada mas\n2. Empieza con <!DOCTYPE html> y termina con </html>\n3. CSS dentro de <style>\n4. Diseño moderno, responsive, colores bonitos\n5. PROHIBIDO: explicaciones, comentarios fuera del HTML, markdown, backticks',
            { max_tokens: 2000, temperature: 0.5 }
        );
        // Limpiar backticks si el modelo los incluyó
        // Limpiar cualquier texto fuera del HTML
        let limpio = html.trim();
        // Quitar backticks
        limpio = limpio.replace(/^[`]{3}[a-z]*\n?/i, '').replace(/[`]{3}\s*$/,'').trim();
        // Extraer solo desde <!DOCTYPE hasta </html>
        const htmlMatch = limpio.match(/<!DOCTYPE[\s\S]*<\/html>/i);
        if (htmlMatch) limpio = htmlMatch[0];

        return limpio;
    },

    publicar_github: async (input, ctx) => {
        // input formato: "ruta_archivo|mensaje_commit|repo_destino(opcional)"
        const fs2 = await import('fs');
        const inputStr = String(input);

        // Separar por || para el nombre (evitar conflicto con | en HTML)
        const partsDoble = inputStr.split('||');
        const contenidoORuta = partsDoble[0]?.trim();
        let nombreArchivo = partsDoble[1]?.trim() || 'pagina.html';
        const mensajeCommit = 'Publicado por BMO: ' + nombreArchivo;

        let rutaArchivo = contenidoORuta;
        if (contenidoORuta.startsWith('<!DOCTYPE') || contenidoORuta.startsWith('<html') || contenidoORuta.includes('<body')) {
            // Extraer nombre del <title> del HTML
            let nombre = nombreArchivo;
            const titleMatch = contenidoORuta.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch && titleMatch[1]) {
                nombre = titleMatch[1].toLowerCase()
                    .replace(/[^a-z0-9]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '')
                    .slice(0, 40) + '.html';
            }
            const tmpPath = '/tmp/' + nombre;
            fs2.default.writeFileSync(tmpPath, contenidoORuta, 'utf8');
            rutaArchivo = tmpPath;
            // Actualizar nombreArchivo para la URL
            nombreArchivo = nombre;
        }
        const { exec: execG } = await import('child_process');
        const { promisify: prom } = await import('util');
        const execA = prom(execG);

        // Verificar que el archivo existe
        if (!rutaArchivo || !fs2.default.existsSync(rutaArchivo)) {
            return 'No encontre el archivo: ' + rutaArchivo;
        }

        // Leer configuracion de git
        const gitConfig = '/home/ruben/dashboard';
        try {
            // Detectar tipo de archivo y destino
            const nombre = nombreArchivo || rutaArchivo.split('/').pop() || 'pagina.html';
            const ext = nombre.split('.').pop().toLowerCase();

            // Copiar archivo al repo
            fs2.default.copyFileSync(rutaArchivo, `${gitConfig}/${nombre}`);

            // Git add, commit, push
            await execA(`cd ${gitConfig} && git add ${nombre}`);
            await execA(`cd ${gitConfig} && git commit -m "${mensajeCommit.replace(/"/g, "'")}"`);
            const { stdout } = await execA(`cd ${gitConfig} && git push origin main`);

            // Construir URL publica
            const remoteUrl = (await execA(`cd ${gitConfig} && git remote get-url origin`)).stdout.trim();
            const match = remoteUrl.match(/github\.com[/:](.*?)\/(.*?)(\.git)?$/);
            let urlPublica = '';
            if (match) {
                const [,user, repo] = match;
                urlPublica = `https://${user}.github.io/${repo}/${nombre}`;
            }

            return 'Publicado en GitHub.' + (urlPublica ? ' URL: ' + urlPublica : '');
        } catch(e) {
            // Si no hay cambios
            if (e.message.includes('nothing to commit')) return 'El archivo ya esta actualizado en GitHub.';
            // Si no hay git configurado
            if (e.message.includes('not a git repository')) return 'ERROR_GIT_NO_CONFIGURADO';
            return 'Error publicando: ' + e.message.slice(0, 150);
        }
    },

    enviar_mensaje: async (input, ctx) => {
        // Detectar formato MENU_REPOS para construir menú sin LLM
        if (String(input).startsWith('MENU_REPOS:')) {
            const partes = String(input).split(':');
            const nombreSugerido = partes[1] || 'mi-proyecto';
            const reposRaw = partes.slice(2).join(':');
            // Soportar CSV (nuevo) y asteriscos (viejo)
            let nombres;
            if (reposRaw.includes(',') && !reposRaw.includes('*')) {
                nombres = reposRaw.split(',').map(r => r.trim()).filter(n => n.length > 2 && n.toLowerCase() !== nombreSugerido.toLowerCase());
            } else {
                nombres = [...reposRaw.matchAll(/\*([\w-]+)\*/g)].map(m => m[1]).filter(n => n.length > 2 && n.toLowerCase() !== nombreSugerido.toLowerCase());
            }
            const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
            const lista = nombres.slice(0,8).map((n,i) => `${emojis[i]} ${n}`).join('\n');
            const menu = `✅ ¡Proyecto listo! ¿Dónde lo publico?\n\n0️⃣ Crear repo nuevo (*${nombreSugerido}*)\n${lista}\n\nResponde con el número 😊`;
            return menu;
        }

        // Detectar si el input es una ruta de archivo para enviar
        const rutaMatch = String(input).match(/(\/tmp\/[\w._\-áéíóúñÁÉÍÓÚÑü]+\.(xlsx|pptx|docx|pdf))/);
        if (rutaMatch && ctx?.clienteWA && ctx?.userId) {
            try {
                const fsM = await import('fs');
                const ruta = rutaMatch[1];
                if (fsM.default.existsSync(ruta)) {
                    const wwjs = await import('whatsapp-web.js');
                    const MM = wwjs.MessageMedia || wwjs.default?.MessageMedia;
                    const fileData = fsM.default.readFileSync(ruta);
                    const ext = ruta.split('.').pop();
                    const mimes = {
                        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        pdf: 'application/pdf'
                    };
                    const nombres = { xlsx: 'archivo.xlsx', pptx: 'presentacion.pptx', docx: 'documento.docx', pdf: 'documento.pdf' };
                    const media = new MM(mimes[ext], fileData.toString('base64'), nombres[ext]);
                    const emojis = { xlsx: '📊', pptx: '📽️', docx: '📄', pdf: '📑' };
                    await ctx.clienteWA.sendMessage(ctx.userId, media, { caption: `${emojis[ext]||'📎'} Archivo listo` });
                    return `ok`;
                }
            } catch(e) { console.log('[SEND_FILE] Error:', e.message); }
        }
        // Limpiar errores de terminal para mostrar mensaje amigable
        let inputStr = String(input);
        if (inputStr.includes('No such file or directory') || inputStr.includes('cannot access')) {
            const ruta = inputStr.match(/cannot access '([^']+)'/)?.[1] || 
                         inputStr.match(/No such file or directory.*?'([^']+)'/)?.[1] || '';
            inputStr = `❌ La ruta *${ruta || 'indicada'}* no existe en el sistema.`;
        } else if (inputStr.includes('Permission denied') || inputStr.includes('cannot open directory')) {
            const ruta = inputStr.match(/['"](\/[^'"]+)['"]/)?.[1] || '';
            inputStr = `❌ No tengo permisos para acceder a *${ruta || 'esa ruta'}*.`;
        }
        let texto = inputStr.replace(/\/tmp\/bmo_doc_[\w.]+/g, '').replace(/Documento editado y enviado:/gi, '').replace(/Reporte.*guardado en.*/gi, 'Documento listo ✅').trim()
            .replace(/^\[/, '').replace(/\]$/, '')
            .replace(/^Aquí tienes el contenido completo en español[:\s]*/i, '')
            .replace(/^Aquí está[:\s]*/i, '')
            .replace(/¿Necesitas algún ajuste[^?]*\?/gi, '')
            .replace(/\n---\n*$/, '')
            .trim();
        return texto.slice(0, 4000);
    },

    gestionar_goals: async (input, ctx) => {
        const { crearGoal, listarGoals, eliminarGoal, marcarCompleto, getPendientes } = await import('../goals/goal_manager.js');
        const userId = ctx?.userId || 'global';
        const partes = String(input).split('|');
        const accion = partes[0].trim().toLowerCase();

        if (accion === 'eliminar' || accion === 'borrar') {
            const id = parseInt(partes[1]);
            if (!id) return '❌ Indica el número del goal a eliminar.';
            const ok = eliminarGoal(id);
            return ok ? `✅ Goal #${id} eliminado.` : `❌ No encontré el goal #${id}.`;
        }
        if (accion === 'listar') {
            const goals = listarGoals(userId);
            if (!goals.length) return 'No tienes goals activos.';
            return goals.map(g => `#${g.id} [${g.estado}] ${g.objetivo.slice(0,60)}`).join('\n');
        }
        if (accion === 'completar') {
            const id = parseInt(partes[1]);
            marcarCompleto(id);
            return `✅ Goal #${id} marcado como completado.`;
        }
        return '❌ Acción no reconocida. Usa: eliminar|ID, listar, completar|ID';
    },

    recall_tasks: async (input, ctx) => {
        try {
            const { getTaskHistory } = await import('../memory/memory_manager.js');
            const userId = ctx?.userId || 'global';
            const query = String(input).toLowerCase();
            const hace48h = Date.now() - 48*60*60*1000;
            const hace7d  = Date.now() - 7*24*60*60*1000;
            const esTemporal = /ayer|hoy|reciente|hicimos|hice|trabajamos|última|ultimo/i.test(query);
            
            let tareas = getTaskHistory(userId, 20);
            if (esTemporal) {
                tareas = tareas.filter(t => t.timestamp > hace48h);
                if (!tareas.length) tareas = getTaskHistory(userId, 10).filter(t => t.timestamp > hace7d);
            } else {
                tareas = tareas.filter(t => t.objetivo.toLowerCase().includes(query));
            }
            if (!tareas.length) return `No encontré tareas recientes sobre: ${query}`;
            return tareas.slice(0,8).map(t => 
                `${t.exito?'✅':'❌'} ${t.objetivo.slice(0,80)}`
            ).join('\n');
        } catch(e) {
            return `Error en recall_tasks: ${e.message}`;
        }
    },

    knowledge_manager: async (input, ctx) => {
        try {
            const { getEmbedding, buscarSimilar } = await import('../core/embeddings.js');
            const Database = (await import('better-sqlite3')).default;
            const fs = await import('fs');
            const pathMod = await import('path');
            const DB_PATH = '/home/ruben/wa-ollama/memory/bmo_memory.db';
            const MAX_SIZE = 10 * 1024 * 1024;

            const getDB = () => new Database(DB_PATH);

            // Fire-and-forget embedding
            const saveEmbedding = (id, texto) => {
                getEmbedding(texto).then(vec => {
                    try {
                        const db2 = getDB();
                        db2.prepare('UPDATE knowledge SET embedding=? WHERE id=?').run(JSON.stringify(vec), id);
                        db2.close();
                    } catch(e) {}
                }).catch(() => {});
            };

            const partes = String(input).split('|');
            const accion = partes[0].trim().toLowerCase();
            const param  = partes[1]?.trim() || '';
            const userId = ctx?.userId || 'global';
            const db = getDB();

            // SAVE: guardar texto directo
            if (accion === 'ingest_text' || accion === 'save') {
                if (!param) return '❌ Especifica texto: save|contenido';
                const tipo = partes[2]?.trim() || 'fact';
                const importancia = parseInt(partes[3]) || 1;
                const r = db.prepare(
                    'INSERT INTO knowledge (tipo,texto,metadata,userId,importancia,timestamp) VALUES (?,?,?,?,?,?)'
                ).run(tipo, param, '{}', userId, importancia, Date.now());
                // FTS
                try { db.prepare('INSERT INTO fts_knowledge(rowid,texto) VALUES (?,?)').run(r.lastInsertRowid, param); } catch(e) {}
                saveEmbedding(r.lastInsertRowid, param);
                db.close();
                return `🧠 Guardado en knowledge [${tipo}]: "${param.slice(0,80)}..."`;
            }

            // INGEST: procesar archivo
            if (accion === 'ingest') {
                if (!param) return '❌ Especifica ruta: ingest|/ruta/archivo';
                if (!fs.default.existsSync(param)) return `❌ Archivo no encontrado: ${param}`;
                const stat = fs.default.statSync(param);
                if (stat.size > MAX_SIZE) return `❌ Archivo muy grande (${(stat.size/1024/1024).toFixed(1)}MB). Máximo 10MB.`;
                let texto = '';
                const ext = pathMod.extname(param).toLowerCase();
                if (ext === '.pdf') {
                    const pdfParse = (await import('pdf-parse')).default;
                    texto = (await pdfParse(fs.default.readFileSync(param))).text;
                } else if (['.txt','.md','.json'].includes(ext)) {
                    texto = fs.default.readFileSync(param, 'utf8');
                } else {
                    return `❌ Formato no soportado: ${ext}`;
                }
                const source = pathMod.default.basename(param);
                // Eliminar chunks anteriores del mismo source
                db.prepare("DELETE FROM knowledge WHERE json_extract(metadata,'$.source')=?").run(source);
                const palabras = texto.split(/\s+/).filter(Boolean);
                const CHUNK = 500;
                let count = 0;
                for (let i = 0; i < palabras.length; i += CHUNK) {
                    const chunk = palabras.slice(i, i + CHUNK).join(' ');
                    const meta = JSON.stringify({ source, chunk_idx: count });
                    const r = db.prepare(
                        'INSERT INTO knowledge (tipo,texto,metadata,userId,importancia,timestamp) VALUES (?,?,?,?,?,?)'
                    ).run('documento', chunk, meta, userId, 2, Date.now());
                    try { db.prepare('INSERT INTO fts_knowledge(rowid,texto) VALUES (?,?)').run(r.lastInsertRowid, chunk); } catch(e) {}
                    saveEmbedding(r.lastInsertRowid, chunk);
                    count++;
                }
                db.close();
                return `🧠 Aprendido: "${source}" → ${count} fragmentos en knowledge DB.`;
            }

            // QUERY: búsqueda semántica + FTS híbrida
            if (accion === 'query') {
                if (!param) return '❌ Especifica consulta: query|tu pregunta';
                // FTS rápido primero
                const ftsQ = param.trim().split(/\s+/).map(w => w + '*').join(' ');
                let rows = [];
                try {
                    rows = db.prepare(
                        'SELECT k.* FROM knowledge k JOIN fts_knowledge f ON k.id=f.rowid WHERE fts_knowledge MATCH ? ORDER BY k.importancia DESC LIMIT 20'
                    ).all(ftsQ);
                } catch(e) {}
                // Fallback si FTS vacío
                if (!rows.length) {
                    rows = db.prepare('SELECT * FROM knowledge ORDER BY importancia DESC, timestamp DESC LIMIT 30').all();
                }
                db.close();
                if (!rows.length) return '🧠 Knowledge vacío. Usa save|texto o ingest|archivo primero.';
                // Re-ranking semántico
                const conEmb = rows.filter(r => r.embedding);
                let resultados;
                if (conEmb.length >= 3) {
                    resultados = await buscarSimilar(param, conEmb, 3);
                } else {
                    resultados = rows.slice(0, 3);
                }
                // Incrementar usos
                const dbU = getDB();
                for (const r of resultados) dbU.prepare('UPDATE knowledge SET usos=usos+1 WHERE id=?').run(r.id);
                dbU.close();
                return resultados.map((r, i) => {
                    const meta = (() => { try { return JSON.parse(r.metadata); } catch { return {}; } })();
                    const src = meta.source ? ` (${meta.source})` : '';
                    const score = r.score !== undefined ? ` [sim:${r.score.toFixed(2)}]` : '';
                    return `[${i+1}]${src}${score}\n${r.texto.slice(0,400)}`;
                }).join('\n\n');
            }

            // LIST: listar entradas
            if (accion === 'list') {
                const rows = db.prepare('SELECT tipo, COUNT(*) as n, MAX(timestamp) as last FROM knowledge GROUP BY tipo ORDER BY n DESC').all();
                db.close();
                if (!rows.length) return '🧠 Knowledge vacío.';
                const total = rows.reduce((a, r) => a + r.n, 0);
                return `🧠 Knowledge DB (${total} entradas):\n` + rows.map(r => `  • [${r.tipo}] ${r.n} entradas`).join('\n');
            }

            // DELETE: eliminar por tipo o source
            if (accion === 'delete') {
                if (!param) return '❌ Especifica tipo o source: delete|fact';
                const r = db.prepare("DELETE FROM knowledge WHERE tipo=? OR json_extract(metadata,'$.source')=?").run(param, param);
                db.close();
                return `🗑️ Eliminadas ${r.changes} entradas de "${param}".`;
            }

            // STATS: estadísticas
            if (accion === 'stats') {
                const total = db.prepare('SELECT COUNT(*) as n FROM knowledge').get().n;
                const conEmb = db.prepare('SELECT COUNT(*) as n FROM knowledge WHERE embedding IS NOT NULL').get().n;
                const topUsed = db.prepare('SELECT texto, usos FROM knowledge ORDER BY usos DESC LIMIT 3').all();
                db.close();
                let out = `🧠 Knowledge Stats:\n  Total: ${total} | Con embedding: ${conEmb}\n  Top usados:\n`;
                out += topUsed.map((r,i) => `  ${i+1}. [${r.usos}x] ${r.texto.slice(0,60)}...`).join('\n');
                return out;
            }

            db.close();
            return 'Acciones: save|texto[|tipo][|importancia], ingest|ruta, query|pregunta, list, delete|tipo, stats';
        } catch(e) {
            return `Error en knowledge_manager: ${e.message}`;
        }
    },

    crear_presentacion: async (input) => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const execAsync = promisify(exec);
            let datos;
            try { datos = JSON.parse(input); }
            catch {
                datos = {
                    tipo: 'impress',
                    titulo: input.slice(0, 50),
                    diapositivas: [{ titulo: input.slice(0, 50), contenido: [input] }]
                };
            }
            datos.tipo = 'impress';
            const arg = JSON.stringify(datos).replace(/'/g, '"');
            const { stdout } = await execAsync(`python3 /home/ruben/wa-ollama/evoluciones/libreoffice_bmo.py '${arg}'`, { timeout: 120000 });
            const result = JSON.parse(stdout);
            return result.ok ? result.ruta : `Error: ${result.error}`;
        } catch(e) { return `Error en crear_presentacion: ${e.message}`; }
    },

    crear_documento_writer: async (input) => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const execAsync = promisify(exec);
            let datos;
            try { datos = JSON.parse(input); }
            catch {
                datos = {
                    tipo: 'writer',
                    titulo: 'Documento',
                    contenido: input
                };
            }
            // Tipo especial: cedula_spf
            if (datos.tipo === 'cedula_spf') {
                const { generarCedulaSPF } = await import('../evoluciones/cedula_spf.js');
                return await generarCedulaSPF();
            }
            datos.tipo = 'writer';
            // Limpiar markdown y formato antes de pasar a LibreOffice
            if (typeof datos.contenido === 'string') {
                datos.contenido = datos.contenido
                    .replace(/\*\*([^*]+)\*\*/g, '$1')  // quitar **bold**
                    .replace(/\*([^*]+)\*/g, '$1')         // quitar *italic*
                    .replace(/#{1,6}\s/g, '')                // quitar headers #
                    .replace(/`{1,3}[^`]*`{1,3}/g, '')       // quitar código
                    .replace(/\n{3,}/g, '\n\n')            // máximo 2 saltos
                    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1') // quitar links markdown
                    .trim();
            }
            const arg = JSON.stringify(datos).replace(/'/g, '"');
            const { stdout } = await execAsync(`python3 /home/ruben/wa-ollama/evoluciones/libreoffice_bmo.py '${arg}'`, { timeout: 120000 });
            const result = JSON.parse(stdout);
            return result.ok ? result.ruta : `Error: ${result.error}`;
        } catch(e) { return `Error en crear_documento_writer: ${e.message}`; }
    },

    crear_excel: async (input) => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const fs = await import('fs');
            const execAsync = promisify(exec);

            // Detectar si es edición de archivo existente
            const esEdicion = /\b(agrega|añade|quita|elimina|modifica|actualiza|edita|ponle|cambia)\b/i.test(String(input));
            const editarMatch = String(input).match(/\|EDITAR:(\/tmp\/[\w._-]+\.xlsx)/);

            // Si es edición pero NO hay doc activo — mostrar lista de excels disponibles
            if (esEdicion && !editarMatch) {
                const { execSync: es2 } = await import('child_process');
                const archivos = es2("find /tmp -name 'hoja_bmo_*.xlsx' -mtime -1 2>/dev/null | sort -r | head -5", {encoding:'utf8'}).trim().split('\n').filter(Boolean);
                if (archivos.length === 0) {
                    return 'NO_EXCEL_ACTIVO';
                }
                const lista = archivos.map((f,i) => {
                    const ts = f.match(/_(\d+)\.xlsx/)?.[1];
                    const fecha = ts ? new Date(parseInt(ts)).toLocaleTimeString() : 'desconocido';
                    return `${i+1}. ${f.split('/').pop()} (${fecha})`;
                }).join('\n');
                return `SELECCIONAR_EXCEL:${archivos.join('|')}:${lista}`;
            }
            if (editarMatch) {
                const rutaExistente = editarMatch[1];
                const instruccion = input.replace(/\|EDITAR:.*/, '').trim();
                // Leer el archivo existente y agregar datos
                const fs2 = await import('fs');
                if (fs2.default.existsSync(rutaExistente)) {
                    // Extraer nuevos datos del instrucción
                    const nuevasFila = instruccion.match(/([A-Za-záéíóúñ]+)\s+([\d,\.]+)/g) || [];
                    if (nuevasFila.length) {
                        // Usar openpyxl para editar el archivo existente
                        const { promisify: p2 } = await import('util');
                        const { exec: ex2 } = await import('child_process');
                        const ea2 = p2(ex2);
                        const filasNuevas = nuevasFila.map(f => {
                            const [mes, val] = f.trim().split(/\s+/);
                            return [mes, parseFloat(val.replace(',',''))];
                        });
                        const editScript = `
import openpyxl, json, sys
wb = openpyxl.load_workbook('${rutaExistente}')
ws = wb.active
nuevas = ${JSON.stringify(filasNuevas)}
for fila in nuevas:
    ws.append(fila)
wb.save('${rutaExistente}')
print(json.dumps({"ok": True, "ruta": "${rutaExistente}"}))
`;
                        const tmpPy = `/tmp/edit_excel_${Date.now()}.py`;
                        fs2.default.writeFileSync(tmpPy, editScript);
                        const { stdout: out2 } = await ea2(`python3 ${tmpPy}`, { timeout: 30000 });
                        fs2.default.unlinkSync(tmpPy);
                        const res2 = JSON.parse(out2);
                        return res2.ok ? res2.ruta : `Error editando: ${res2.error}`;
                    }
                }
            }
            // input puede ser JSON directo o texto natural
            let datos;
            try {
                datos = JSON.parse(input);
            } catch {
                // Construir JSON desde texto natural
                // Ejemplo: "Enero 150000, Febrero 180000, Marzo 120000"
                const pares = input.match(/([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s+([\d,\.]+)/g) || [];
                const filas = pares.map(p => {
                    const [mes, valor] = p.trim().split(/\s+/);
                    return [mes, parseFloat(valor.replace(',',''))];
                });
                datos = {
                    tipo: 'calc',
                    titulo: 'Reporte',
                    encabezados: ['Concepto', 'Valor'],
                    filas
                };
            }

            if (!datos.tipo) datos.tipo = 'calc';

            const tmpJson = `/tmp/excel_req_${Date.now()}.json`;
            fs.default.writeFileSync(tmpJson, JSON.stringify(datos));

            const { stdout, stderr } = await execAsync(
                `python3 /home/ruben/wa-ollama/evoluciones/libreoffice_bmo.py '${JSON.stringify(datos).replace(/'/g, '"')}'`,
                { timeout: 120000 }
            );
            fs.default.unlinkSync(tmpJson);

            const result = JSON.parse(stdout);
            if (result.ok) {
                return result.ruta;
            } else {
                return `Error creando Excel: ${result.error || stderr}`;
            }
        } catch(e) {
            return `Error en crear_excel: ${e.message}`;
        }
    },

    manage_dependencies: async (input) => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const fs = await import('fs');
            const path = await import('path');
            const execAsync = promisify(exec);

            const modo = String(input || '').trim();
            const [accion, paquete] = modo.includes(':') ? modo.split(':') : ['install', modo];
            const pkg = (paquete || accion).trim().toLowerCase().replace(/[^a-z0-9@/_.-]/g, '');

            if (!pkg) return '❌ Especifica un paquete. Ej: install:moment o check:canvas';

            // Lista negra de paquetes peligrosos o incompatibles con ARM
            const PROHIBIDOS = ['electron', 'puppeteer', 'playwright', 'sharp', 'node-gyp',
                'sodium-native', 'bcrypt', 'canvas', 'gl', 'opencv4nodejs'];
            if (PROHIBIDOS.some(p => pkg.includes(p))) {
                return `❌ Paquete "${pkg}" está en lista negra (incompatible con ARM o peligroso).`;
            }

            const PROJECT_DIR = '/home/ruben/wa-ollama';
            const modulePath = path.join(PROJECT_DIR, 'node_modules', pkg.split('/').pop());

            // Modo check: verificar si existe
            if (accion === 'check') {
                const existe = fs.existsSync(modulePath);
                return existe
                    ? `✅ Paquete "${pkg}" ya está instalado.`
                    : `❌ Paquete "${pkg}" NO está instalado.`;
            }

            // Modo list: listar dependencias instaladas recientemente
            if (accion === 'list') {
                const { stdout } = await execAsync('cat /home/ruben/wa-ollama/package.json');
                const pkgJson = JSON.parse(stdout);
                const deps = Object.keys(pkgJson.dependencies || {}).join(', ');
                return `📦 Dependencias instaladas: ${deps}`;
            }

            // Modo install: instalar paquete
            if (fs.existsSync(modulePath)) {
                return `✅ Paquete "${pkg}" ya está instalado. No se requiere acción.`;
            }

            console.log(`[TOOL] manage_dependencies | Instalando ${pkg}...`);
            const { stdout, stderr } = await execAsync(
                `cd ${PROJECT_DIR} && npm install ${pkg} --save --prefer-offline 2>&1`,
                { timeout: 60000 }
            );

            const exitoso = fs.existsSync(modulePath) || stdout.includes('added');
            if (exitoso) {
                return `📦 Paquete "${pkg}" instalado correctamente. Ya puede ser usado en futuras tareas.`;
            } else {
                return `⚠️ Instalación de "${pkg}" completó con advertencias: ${stderr?.slice(0,200) || stdout?.slice(0,200)}`;
            }
        } catch(e) {
            if (e.killed) return `⏱️ Timeout instalando paquete. Red lenta o paquete muy grande.`;
            return `Error en manage_dependencies: ${e.message.slice(0,200)}`;
        }
    },

    manage_disk_storage: async (input) => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const execAsync = promisify(exec);
            const modo = String(input || 'report').trim().toLowerCase();

            const run = async (cmd, fallback = '') => {
                try { return (await execAsync(cmd)).stdout.trim(); }
                catch { return fallback; }
            };

            if (modo === 'report') {
                const tmp     = await run("find /tmp -maxdepth 1 -name 'bmo_*' 2>/dev/null | wc -l | xargs -I{} echo '{} archivos bmo en /tmp'", '0 archivos bmo en /tmp');
                const logs    = await run('du -sh /home/ruben/.pm2/logs 2>/dev/null', 'N/A');
                const modelos = await run('du -sh /home/ruben/.ollama/models 2>/dev/null || echo "No instalado"', 'No instalado');
                const waLogs  = await run('du -sh /home/ruben/wa-ollama/logs 2>/dev/null', 'N/A');
                const disco = await run("df -h / | awk 'NR==2{print $5}'", 'N/A');
                return `📊 REPORTE DE DISCO:
Disco /: ${disco}
/tmp: ${tmp}
PM2 logs: ${logs}
Ollama modelos: ${modelos}
wa-ollama logs: ${waLogs}`;
            }

            if (modo === 'clean_logs') {
                const antes = await run("df / | awk 'NR==2{print $3}'", '0');
                await run('pm2 flush');
                await run('find /home/ruben/.pm2/logs -name "*.log" -size +10M -exec truncate -s 0 {} \;');
                await run('find /home/ruben/wa-ollama -name "*.log" -exec truncate -s 0 {} \;');
                const despues = await run("df / | awk 'NR==2{print $3}'", '0');
                const liberado = Math.max(0, parseInt(antes) - parseInt(despues));
                const disco = await run("df -h / | awk 'NR==2{print $5}'", 'N/A');
                return `🧹 Logs limpiados. Liberado: ~${(liberado/1024).toFixed(1)}MB. Disco actual: ${disco}`;
            }

            if (modo === 'clean_tmp') {
                const antes = await run("df / | awk 'NR==2{print $3}'", '0');
                await run('find /tmp -name "bmo_doc_*" -mmin +1440 -delete 2>/dev/null');
                await run('find /tmp -name "goal_gen_*" -mmin +1440 -delete 2>/dev/null');
                await run('find /tmp -name "ollama_req_*" -mmin +60 -delete 2>/dev/null');
                await run('find /tmp -name "bmo_app_*" -mmin +60 -delete 2>/dev/null');
                const despues = await run("df / | awk 'NR==2{print $3}'", '0');
                const liberado = Math.max(0, parseInt(antes) - parseInt(despues));
                const disco = await run("df -h / | awk 'NR==2{print $5}'", 'N/A');
                return `🧹 /tmp limpiado. Liberado: ~${(liberado/1024).toFixed(1)}MB. Disco actual: ${disco}`;
            }

            if (modo === 'clean_all') {
                const r1 = await TOOLS.manage_disk_storage('clean_logs');
                const r2 = await TOOLS.manage_disk_storage('clean_tmp');
                const disco = await run("df -h / | awk 'NR==2{print $5}'", 'N/A');
                return `🧹 Higiene Digital Completada:
${r1}
${r2}
Espacio actual en /: ${disco}`;
            }

            return `Modo desconocido: ${modo}. Usa: report, clean_logs, clean_tmp, clean_all`;
        } catch(e) {
            return `Error en manage_disk_storage: ${e.message}`;
        }
    },

    ejecutar_codigo: async (input, ctx) => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const fs2 = await import('fs');
            const execAsync = promisify(exec);

            // Extraer código de bloque markdown si viene así
            let codigo = input.trim();
            const bloqueMatch = codigo.match(/```(?:python|py|js|javascript|node)?\s*([\s\S]*?)```/);
            if (bloqueMatch) codigo = bloqueMatch[1].trim();

            // Limpiar prefijo de lenguaje
            codigo = codigo.replace(/^(python|py|javascript|node|js)\s*\n/i, '');

            // Detectar lenguaje por contenido
            const tienePython = /^(print|def |import |from |class |if __name__|#!.*python)/m.test(codigo) ||
                                 /\bprint\s*\(/i.test(codigo) ||
                                 /^(python|py)\s/i.test(input);
            const tieneNode = /^(node|js|javascript)\s/i.test(input) ||
                               /\b(require|console\.log|const |let |var |async |await )/.test(codigo) && !tienePython;

            const esPython = tienePython || (!tieneNode && !codigo.includes('{'));
            const ext = esPython ? 'py' : 'mjs';
            const tmpFile = `/tmp/bmo_code_${Date.now()}.${ext}`;
            fs2.default.writeFileSync(tmpFile, codigo);

            const cmd = esPython ? `python3 ${tmpFile}` : `node ${tmpFile}`;

            const { stdout, stderr } = await execAsync(cmd, { timeout: 30000, cwd: '/home/ruben/wa-ollama' });
            fs2.default.unlinkSync(tmpFile);

            const resultado = (stdout || '') + (stderr ? `
STDERR: ${stderr}` : '');
            return resultado.slice(0, 2000) || 'Ejecutado sin output';
        } catch(e) {
            return `Error ejecutando codigo: ${e.message.slice(0, 500)}`;
        }
    },

    leer_archivo_proyecto: async (input, ctx) => {
        try {
            const fs2 = await import('fs');
            const path2 = await import('path');
            const base = '/home/ruben/wa-ollama';
            const ruta = input.trim().startsWith('/') ? input.trim() : path2.join(base, input.trim());

            // Seguridad: solo leer dentro del proyecto
            if (!ruta.startsWith(base) && !ruta.startsWith('/tmp/')) {
                return 'Solo puedo leer archivos del proyecto wa-ollama o /tmp/';
            }
            if (!fs2.default.existsSync(ruta)) return `Archivo no encontrado: ${ruta}`;
            const stat = fs2.default.statSync(ruta);
            if (stat.size > 100000) return `Archivo muy grande (${(stat.size/1024).toFixed(0)}KB). Especifica líneas.`;
            return fs2.default.readFileSync(ruta, 'utf8').slice(0, 3000);
        } catch(e) {
            return `Error leyendo archivo: ${e.message}`;
        }
    },

    commit_github: async (input, ctx) => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const execAsync = promisify(exec);

            // input: "mensaje del commit | ruta/del/repo"
            const partes = input.split('|');
            const mensaje = partes[0].trim() || 'BMO auto-commit';
            const repo = partes[1]?.trim() || '/home/ruben/dashboard';

            // Verificar que es un repo git
            const { stdout: status } = await execAsync(`git -C ${repo} status --short`);
            if (!status.trim()) return 'No hay cambios para commitear en ' + repo;

            await execAsync(`git -C ${repo} add -A`);
            const { stdout: commit } = await execAsync(`git -C ${repo} commit -m "${mensaje.replace(/"/g, "'")}"`);
            const { stdout: push } = await execAsync(`git -C ${repo} push`).catch(e => ({stdout: 'Push falló: ' + e.message.slice(0,100)}));

            return `Commit exitoso: ${mensaje}
${commit.slice(0,200)}
${push}`;
        } catch(e) {
            return `Error en commit: ${e.message.slice(0,300)}`;
        }
    },

    gestionar_documentos: async (input, ctx) => {
        try {
            const { listarDocumentos, buscarDocumento, eliminarDocumento } = await import('../core/document_manager.js');
            const userId = ctx?.userId || 'global';
            const cmd = String(input).trim().toLowerCase();

            // LISTAR
            if (/listar|lista|cuáles|cuales|tengo|mis documentos/i.test(cmd) || cmd === 'list') {
                const docs = listarDocumentos(userId);
                if (!docs.length) return 'No tienes documentos guardados.';
                return 'Tus documentos:\n' + docs.map((d,i) => `${i+1}. ${d.titulo||d.id} (${d.tipo}) - ${new Date(d.creado).toLocaleDateString()}`).join('\n');
            }

            // ENVIAR/DESCARGAR
            if (/envia|manda|descarga|compartir/i.test(cmd)) {
                const titulo = cmd.replace(/^(envia|manda|descarga|compartir)\s*/i,'').trim();
                const doc = buscarDocumento(userId, titulo);
                if (!doc) return `No encontré ningún documento con ese nombre.`;
                if (ctx?.clienteWA) {
                    const wwjs = await import('whatsapp-web.js');
                    const MM = wwjs.MessageMedia || wwjs.default?.MessageMedia;
                    const fs2 = await import('fs');
                    const fileData = fs2.default.readFileSync(doc.ruta);
                    const mimes = {
                        docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                        pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'
                    };
                    const ext = doc.ruta.split('.').pop();
                    const media = new MM(mimes[ext]||'application/octet-stream', fileData.toString('base64'), doc.ruta.split('/').pop());
                    await ctx.clienteWA.sendMessage(ctx.userId, media, {caption: `📄 ${doc.titulo}`});
                    return `ok`;
                }
            }

            // ELIMINAR
            if (/elimina|borra|delete/i.test(cmd)) {
                const titulo = cmd.replace(/^(elimina|borra|delete)\s*/i,'').trim();
                const doc = eliminarDocumento(userId, titulo);
                if (!doc) return `No encontré "${titulo}" para eliminar.`;
                return `Eliminado: ${doc.titulo}`;
            }

            // BUSCAR
            const doc = buscarDocumento(userId, input);
            if (doc) return `Encontrado: ${doc.titulo} (${doc.tipo})
Ruta: ${doc.ruta}
Creado: ${new Date(doc.creado).toLocaleString()}`;
            return `No encontré ningún documento con: "${input}"`;
        } catch(e) {
            return `Error en gestionar_documentos: ${e.message}`;
        }
    },

    estado_actual: async (input, ctx) => {
        try {
            const { getEstadoSesion } = await import('../core/session_state.js');
            const userId = ctx?.userId || 'global';
            const estado = getEstadoSesion(userId);
            if (!estado) return 'No hay ninguna tarea activa en este momento. Estoy listo para ayudarte.';
            const { objetivo, pasos, pasoActual, totalPasos, porcentaje, estado: st, iniciado, descripcionActual } = estado;
            const tiempoTranscurrido = iniciado ? Math.round((Date.now()-iniciado)/1000) : 0;
            const tiempoEstimado = iniciado && pasoActual > 0
                ? Math.round((tiempoTranscurrido/pasoActual) * (totalPasos - pasoActual))
                : null;
            if (st === 'completado') {
                // Si ya terminó, dar contexto de lo último hecho
                const hace = Math.round((Date.now() - (estado.finalizado||Date.now()))/1000);
                return `Acabo de terminar: "${objetivo}" (hace ${hace}s). ¿En qué más te ayudo?`;
            }
            // Si el objetivo es igual a la pregunta actual, no hay tarea real activa
            const preguntaActual = String(input).replace(/\[Contexto:.*?\]/,'').trim().toLowerCase();
            if (objetivo.toLowerCase().includes(preguntaActual.slice(0,20))) {
                return 'Ahora mismo estoy libre. ¿En qué te puedo ayudar?';
            }
            let r = `Estoy trabajando en: "${objetivo}" 🔄
`;
            r += `Voy en el paso ${pasoActual} de ${totalPasos} (${porcentaje}%): ${descripcionActual}
`;
            if (pasos?.length && pasoActual < pasos.length) {
                r += `Lo que sigue: ${pasos.slice(pasoActual).join(' → ')}`;
            }
            if (tiempoEstimado !== null && tiempoEstimado > 0) r += `
Calculo unos ${tiempoEstimado}s más.`;
            return r;
        } catch(e) {
            return `Error obteniendo estado: ${e.message}`;
        }
    },

    check_system_health: async () => {
        try {
            const { promisify } = await import('util');
            const { exec } = await import('child_process');
            const execAsync = promisify(exec);

            const run = async (cmd, fallback = 'N/A') => {
                try { return (await execAsync(cmd)).stdout.trim(); }
                catch { return fallback; }
            };

            // Temperatura
            const tempRaw = await run('vcgencmd measure_temp', 'temp=N/A');
            const temp = tempRaw.replace('temp=', '');

            // CPU usage (promedio 1s)
            const cpuRaw = await run("top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}'", '0');
            const cpu = parseFloat(cpuRaw).toFixed(1) + '%';

            // RAM
            const ramRaw = await run("free -m | awk '/Mem:/{print $2,$3,$4}'", '0 0 0');
            const [ramTotal, ramUsed, ramFree] = ramRaw.split(' ').map(Number);
            const ramPct = ((ramUsed / ramTotal) * 100).toFixed(1);
            const ram = `${ramUsed}MB/${ramTotal}MB (${ramPct}% usado, ${ramFree}MB libre)`;

            // Storage
            const diskRaw = await run("df -h / | awk 'NR==2{print $2,$3,$4,$5}'", 'N/A');
            const [dTotal, dUsed, dFree, dPct] = diskRaw.split(' ');
            const disk = `${dUsed}/${dTotal} usado (${dPct}), ${dFree} libre`;

            // Uptime
            const uptime = await run("uptime -p", 'N/A');

            // PM2 reinicios del proceso bmo
            const pm2Raw = await run("pm2 jlist 2>/dev/null", '[]');
            let reinicios = 'N/A';
            try {
                const procs = JSON.parse(pm2Raw);
                const bmo = procs.find(p => p.name === 'bmo');
                reinicios = bmo ? String(bmo.pm2_env.restart_time) : 'N/A';
            } catch {}

            // Alertas automáticas
            const alertas = [];
            const tempNum = parseFloat(temp);
            if (tempNum > 70) alertas.push('⚠️ Temperatura crítica');
            else if (tempNum > 60) alertas.push('🌡️ Temperatura elevada');
            if (parseFloat(ramPct) > 85) alertas.push('⚠️ RAM alta');
            if (parseInt(reinicios) > 10) alertas.push('⚠️ Muchos reinicios PM2');

            const estado = alertas.length ? alertas.join(' | ') : '✅ Sistema estable';

            return `🖥️ SALUD DEL SISTEMA (${new Date().toLocaleTimeString()})
Temperatura: ${temp}
CPU: ${cpu}
RAM: ${ram}
Disco (/): ${disk}
Uptime: ${uptime}
PM2 reinicios (bmo): ${reinicios}
Estado: ${estado}`;
        } catch(e) {
            return `Error en check_system_health: ${e.message}`;
        }
    },

    recall_episodic: async (input, ctx) => {
        try {
            const { EpisodicMemory } = await import('../memory/episodic_memory.js');
            const mem = new EpisodicMemory();
            const userId = ctx?.userId || 'global';
            const episodes = await mem.recallSimilar(userId, String(input), 5);
            if (!episodes.length) return 'No recuerdo conversaciones similares a: ' + String(input).slice(0,60);
            const lines2 = episodes.map(e => '[' + new Date(e.timestamp).toLocaleDateString('es') + '] ' + e.summary); return 'Episodios:\n' + lines2.join('\n');




        } catch(e) { return 'Error en recall_episodic: ' + e.message; }
    },

    analizar_causa: async (input, ctx) => {
        try {
            const { causalAgent } = await import('../agents/causal_agent.js');
            const [evento, ...rest] = String(input).split('|');
            const result = await causalAgent.analyze(evento, { contexto: rest.join('|') });
            return `🔍 Análisis causal:
• Causa: ${result.causa}
• Efecto: ${result.efecto}
• Predicción: ${result.prediccion}
• Confianza: ${result.confianza}%`;
        } catch(e) { return 'Error en analizar_causa: ' + e.message; }
    },

    rl_stats: async (input, ctx) => {
        try {
            const { ReinforcementLearning } = await import('../memory/reinforcement_learning.js');
            const stats = new ReinforcementLearning().getStats(10);
            if (!stats.length) return 'Sin datos de aprendizaje aún.';
            return 'Top acciones por recompensa:\n' + stats.map(s => '- ' + s.action + ': OK=' + s.wins + ' FAIL=' + s.losses + ' reward=' + s.reward).join('\n');




        } catch(e) { return 'Error: ' + e.message; }
    },

    memory_search: async (input, ctx) => {
        try {
            const { getLongTerm, getTaskHistory } = await import('../memory/memory_manager.js');
            const userId = ctx?.userId || 'global';
            const query = String(input).slice(0, 100).toLowerCase();

            const tareas = getTaskHistory(userId, 10);
            const hechos = getLongTerm(userId, 8);

            // Filtrar por relevancia si hay query específico (no temporal)
            const esTemporal = /ayer|hoy|reciente|última|ultimo|hicimos|hice|trabajamos|pasó/i.test(query);
            
            let resumenTareas = tareas
                .filter(t => esTemporal || t.objetivo.toLowerCase().includes(query))
                .map(t => `[TAREA] ${t.objetivo} | ${t.exito ? 'exitosa' : 'fallida'}`);
            
            let resumenHechos = hechos
                .filter(h => esTemporal || h.contenido.toLowerCase().includes(query))
                .map(h => `[${h.tipo}] ${h.contenido.slice(0, 150)}`);

            const todo = [...resumenTareas, ...resumenHechos];
            if (!todo.length) return `No tengo registros previos sobre: ${query}`;
            return todo.slice(0, 8).join('\n');
        } catch(e) {
            return `Error en memory_search: ${e.message}`;
        }
    },

    code_agent: async (input, ctx) => {
        // Agente de código — genera, depura, explica, refactoriza, ejecuta
        // input formato: "accion||código_o_descripción||código_actual(opcional)||error(opcional)"
        try {
            const { codeAgent } = await import('../agents/code_agent.js');
            const partes = String(input).split('||');
            const descripcion = partes[0] || input;
            const codigoActual = partes[1] || '';
            const error = partes[2] || '';

            const contexto = {};
            if (codigoActual) contexto.codigo_actual = codigoActual;
            if (error) contexto.error = error;

            const datos = await codeAgent.procesar(descripcion, contexto);

            // Si debe ejecutar, correrlo
            let ejecutado = null;
            if (datos.ejecutar && datos.codigo) {
                ejecutado = await codeAgent.ejecutarCodigo(datos.codigo, datos.lenguaje, datos.archivo);
            }

            return codeAgent.formatearRespuesta(datos, ejecutado);
        } catch(e) {
            return `❌ Error en code_agent: ${e.message}`;
        }
    },

    guardar_proyecto_estado: async (input, ctx) => {
        const fs = await import('fs');
        const userId = ctx?.userId || 'global';
        const estadoPath = `/tmp/bmo-proyecto-${userId}.json`;
        try {
            const inputStr = String(input);
            let datos = {};

            // Formato especial: "RESULTADO_1_ESTADO:descripcion_original"
            if (inputStr.startsWith('RESULTADO_1_ESTADO:')) {
                const descripcion = inputStr.replace('RESULTADO_1_ESTADO:', '').trim();
                datos = { fase: 'esperando_respuestas', tipo: 'pendiente', descripcion };
            } else {
                // Intentar parsear JSON directo
                try { datos = JSON.parse(inputStr); } catch(e) { datos = { fase: 'esperando_respuestas', raw: inputStr }; }
            }

            // Formato especial: activar modo edición tras publicación
            if (inputStr.includes('||REPO:')) {
                const repoM = inputStr.match(/\|\|REPO:([\w-]+)/);
                const userM = inputStr.match(/\|\|USER:([\w-]+)/);
                if (repoM) {
                    const userId3 = ctx?.userId || 'global';
                    const path3 = `/tmp/bmo-proyecto-${userId3}.json`;
                    fs.default.writeFileSync(path3, JSON.stringify({
                        fase: 'editando',
                        repo: repoM[1],
                        user: userM?.[1] || 'rendonbarco727-coder',
                        timestamp: Date.now()
                    }), 'utf8');
                    // Retornar mensaje limpio sin los marcadores
                    const mensajeLimpio = inputStr.replace(/\|\|REPO:[\w-]+/g,'').replace(/\|\|USER:[\w-]+/g,'').trim();
                    return mensajeLimpio;
                }
            }

            // Formato especial: guardar lista de repos en estado
            if (inputStr.startsWith('GUARDAR_REPOS:')) {
                const reposStr = inputStr.replace('GUARDAR_REPOS:', '').trim();
                const userId4 = ctx?.userId || 'global';
                const path4 = `/tmp/bmo-proyecto-${userId4}.json`;
                if (fs.default.existsSync(path4)) {
                    const estadoPrev = JSON.parse(fs.default.readFileSync(path4, 'utf8'));
                    // Extraer nombres — soportar CSV y formato con asteriscos
                    let nombres;
                    if (reposStr.includes(',') && !reposStr.includes('*')) {
                        nombres = reposStr.split(',').map(r => r.trim()).filter(r => r.length > 0);
                    } else {
                        nombres = [...reposStr.matchAll(/\*([\w-]+)\*/g)].map(m => m[1]);
                    }
                    // Filtrar el nombre sugerido de la lista para que los índices coincidan con el menú
                    const nombreSugeridoActual = estadoPrev.nombre_sugerido || estadoPrev.titulo || '';
                    if (nombreSugeridoActual) {
                        nombres = nombres.filter(n => n.toLowerCase() !== nombreSugeridoActual.toLowerCase());
                    }
                    estadoPrev.repos_lista = nombres;
                    estadoPrev.timestamp = Date.now();
                    fs.default.writeFileSync(path4, JSON.stringify(estadoPrev), 'utf8');
                }
                return 'ok';
            }

            // Formato especial: guardar tmpDir del proyecto generado
            if (inputStr.startsWith('GUARDAR_TMPDIR:')) {
                const jsonStr = inputStr.replace('GUARDAR_TMPDIR:', '').trim();
                try {
                    const resultado = JSON.parse(jsonStr);
                    const userId2 = ctx?.userId || 'global';
                    const path2 = `/tmp/bmo-proyecto-${userId2}.json`;
                    if (fs.default.existsSync(path2)) {
                        const estadoPrev = JSON.parse(fs.default.readFileSync(path2, 'utf8'));
                        estadoPrev.fase = 'esperando_repo';
                        estadoPrev.tmpDir = resultado.tmpDir;
                        estadoPrev.titulo = resultado.titulo || estadoPrev.nombre_sugerido || 'mi-proyecto';
                        estadoPrev.timestamp = Date.now();
                        fs.default.writeFileSync(path2, JSON.stringify(estadoPrev), 'utf8');
                        return `ok`;
                    }
                } catch(e) {}
                return `ok`;
            }

            // Si el input contiene JSON de análisis (viene del web_project_builder)
            const jsonMatch = inputStr.match(/\{[\s\S]*"tipo"[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const analisis = JSON.parse(jsonMatch[0]);
                    datos = {
                        fase: 'esperando_respuestas',
                        tipo: analisis.tipo || 'web_profesional',
                        descripcion: analisis.descripcion_corta || datos.descripcion || '',
                        nombre_sugerido: analisis.nombre_sugerido || 'mi-proyecto',
                        necesita_imagenes: analisis.necesita_imagenes || false
                    };
                } catch(e) {}
            }

            fs.default.writeFileSync(estadoPath, JSON.stringify({ ...datos, timestamp: Date.now() }), 'utf8');
            return `ok`;
        } catch(e) {
            return `error: ${e.message}`;
        }
    },

    web_project_builder: async (input, ctx) => {
        const fs = await import('fs');
        const path = await import('path');
        const { execSync } = await import('child_process');
        const { callModel } = await import('../core/model_router.js');

        const inputStr = String(input).trim();
        const parts = inputStr.split('||');
        const accion = parts[0]?.trim().toLowerCase();

        // ACCION: analizar — detecta tipo de proyecto y qué datos necesita
        // ACCION: analizar — detecta tipo de proyecto y qué datos necesita
        if (accion === 'analizar') {
            const descripcion = parts[1] || '';
            const analisis = await callModel('razonamiento',
                `Eres un analista experto en proyectos web. Analiza este prompt y decide qué información ya está presente.

PROMPT: "${descripcion}"

INSTRUCCIONES ESTRICTAS:
1. Lee TODO el prompt y extrae la información ya proporcionada
2. Si el prompt menciona controles/interacción → NO preguntes controles
3. Si el prompt menciona colores/estilo → NO preguntes colores  
4. Si el prompt menciona velocidad/dificultad → NO preguntes velocidad
5. Si el prompt menciona game over/reinicio → NO preguntes eso
6. Juegos y animaciones: necesita_imagenes=false SIEMPRE
7. Si el prompt es detallado → preguntas:[]

EJEMPLOS:
"snake neón, flechas y swipe, velocidad aumenta, game over sin alert, botón start"
→ {"tipo":"juego","nombre_sugerido":"snake-neon","necesita_imagenes":false,"preguntas":[],"descripcion_corta":"Snake neón con swipe y flechas","info_extraida":{"colores":"neón oscuro","controles":"flechas y swipe táctil","caracteristicas":["velocidad aumenta al comer","game over en canvas","botón start"]}}

"hazme una landing"
→ {"tipo":"landing","nombre_sugerido":"mi-landing","necesita_imagenes":true,"preguntas":["¿Para qué negocio?","¿Colores preferidos?"],"descripcion_corta":"Landing page"}

Responde SOLO JSON válido sin texto extra.`,
                { max_tokens: 600, temperature: 0.1 }
            );
            try {
                const limpio = analisis.replace(/\`\`\`json|\`\`\`/g, '').trim();
                const json = JSON.parse(limpio.match(/\{[\s\S]*\}/)[0]);
                json._sin_preguntas = (!json.preguntas || json.preguntas.length === 0);
                return JSON.stringify(json);
            } catch(e) {
                return JSON.stringify({
                    tipo: 'web_profesional',
                    nombre_sugerido: 'mi-proyecto',
                    necesita_imagenes: false,
                    necesita_datos: false,
                    preguntas: [],
                    _sin_preguntas: true,
                    descripcion_corta: descripcion,
                    info_extraida: {}
                });
            }
        }

        // ACCION: generar — genera el proyecto completo
        if (accion === 'generar') {
            const contexto = parts[1] || '';
            const tmpDir = '/tmp/bmo-project-' + Date.now();
            fs.default.mkdirSync(tmpDir, { recursive: true });
            fs.default.mkdirSync(tmpDir + '/css', { recursive: true });
            fs.default.mkdirSync(tmpDir + '/js', { recursive: true });
            fs.default.mkdirSync(tmpDir + '/assets', { recursive: true });

            let contextoObj = {};
            try { contextoObj = JSON.parse(contexto); } catch(e) { contextoObj = { descripcion: contexto }; }

            const tipo = contextoObj.tipo || 'web_profesional';
            const desc = contextoObj.descripcion || contexto;
            const infoExtraida = contextoObj.info_extraida || {};
            const colores = contextoObj.colores || infoExtraida.colores || 'moderno y oscuro';
            const datos = contextoObj.datos || JSON.stringify(infoExtraida) || '';
            const caracteristicas = infoExtraida.caracteristicas ? infoExtraida.caracteristicas.join(', ') : '';
            const controles = infoExtraida.controles || '';
            const imagenes = contextoObj.imagenes || [];

            // Generar CSS
            const cssPrompt = `Genera SOLO CSS profesional y moderno para: ${desc}
Colores/estilo: ${colores}
Tipo de proyecto: ${tipo}
REGLAS: Solo CSS puro, sin comentarios innecesarios, responsive, con animaciones suaves, variables CSS para colores, fuentes de Google Fonts via @import.`;

            const css = await callModel('web', cssPrompt, { max_tokens: 1500, temperature: 0.4 });

            // Generar JS según tipo
            let jsPrompt = '';
            if (tipo === 'dashboard') {
                jsPrompt = `Genera SOLO JavaScript para un dashboard con Chart.js.
Datos: ${datos || 'usa datos de ejemplo realistas'}
Descripción: ${desc}
REGLAS: Usa Chart.js CDN, crea gráficas de barras y líneas, datos dinámicos, sin comentarios innecesarios.`;
            } else if (tipo === 'juego') {
                jsPrompt = `Genera SOLO JavaScript completo para el juego: ${desc}
REGLAS: Usa Canvas HTML5, game loop con requestAnimationFrame, controles de teclado y touch para móvil, sistema de puntuación, game over y restart. Sin comentarios innecesarios.`;
            } else if (tipo === 'app_db') {
                jsPrompt = `Genera SOLO JavaScript para una app con almacenamiento local.
Descripción: ${desc}
Datos: ${datos || 'inferir del contexto'}
REGLAS: Usa localStorage como DB, operaciones CRUD completas, validación de formularios, sin frameworks externos.`;
            } else {
                jsPrompt = `Genera SOLO JavaScript moderno para: ${desc}
REGLAS: Animaciones scroll, interactividad, sin jQuery, vanilla JS moderno. Sin comentarios innecesarios.`;
            }

            const js = await callModel('web', jsPrompt, { max_tokens: 2000, temperature: 0.4 });

            // Generar HTML principal
            const imagenesHTML = imagenes.length > 0
                ? `Usa estas URLs de imágenes: ${imagenes.join(', ')}`
                : tipo === 'juego' ? 'No necesita imágenes' : 'Usa placeholders de https://picsum.photos si necesitas imágenes';

            // Para juegos: todo en un solo archivo para evitar problemas de paths
            const esTodoEnUno = tipo === 'juego' || tipo === 'animacion';

            const htmlPrompt = esTodoEnUno
                ? `Eres un experto en desarrollo de juegos con HTML5 Canvas. Crea un juego COMPLETO y JUGABLE en un solo archivo HTML.

JUEGO: ${desc}
ESPECIFICACIONES DEL USUARIO: ${datos}
ESTILO VISUAL: ${colores}

REQUISITOS TÉCNICOS OBLIGATORIOS:
1. UN SOLO archivo HTML con <style> en head y <script> antes de </body>
2. Canvas de 400x400px centrado, con fondo negro o muy oscuro
3. Pantalla de START: muestra título, instrucciones y botón "▶ Iniciar" - el juego NO inicia solo
4. Game loop con requestAnimationFrame - NUNCA uses setInterval para el loop principal
5. Game over: pantalla dentro del canvas (NO alert()) con puntuación y botón "🔄 Reiniciar"
6. Puntuación visible en pantalla durante el juego (esquina superior)
7. Controles táctiles: 4 botones de flecha en pantalla para móvil (↑ ↓ ← →)
8. Controles de teclado: flechas y WASD

PARA SNAKE ESPECÍFICAMENTE:
- Tamaño de celda: 20px, grid de 20x20
- Snake inicial: 3 segmentos, dirección derecha
- Velocidad inicial: 150ms por tick (lento y jugable)
- Si el usuario pidió "velocidad aumenta": reducir el intervalo 2ms cada vez que come (mínimo 60ms)
- Comida: círculo rojo brillante con efecto de brillo
- Snake: gradiente verde, cabeza más brillante
- Colisión con paredes y consigo mismo termina el juego
- Score: +10 por cada comida

DISEÑO VISUAL:
- Fondo general: #1a1a2e o similar oscuro
- Canvas border: 2px solid con color neón
- Fuentes: Google Fonts 'Press Start 2P' para título retro o sans-serif moderno
- Botones: bordes redondeados, hover effects con CSS
- Todo responsive con max-width

ESTRUCTURA DEL GAME LOOP (úsala exactamente así):
const CELL = 20, COLS = 20, ROWS = 20;
let snake, dir, nextDir, food, score, speed, gameState, animId;

function resetGame() {
  snake = [{x:10,y:10},{x:9,y:10},{x:8,y:10}];
  dir = {x:1,y:0}; nextDir = {x:1,y:0};
  score = 0; speed = 150; gameState = 'start';
  spawnFood(); cancelAnimationFrame(animId);
}

function spawnFood() {
  do { food = {x:Math.floor(Math.random()*COLS), y:Math.floor(Math.random()*ROWS)}; }
  while (snake.some(s=>s.x===food.x&&s.y===food.y));
}

let lastTime = 0;
function loop(ts) {
  animId = requestAnimationFrame(loop);
  if (ts - lastTime < speed) return;
  lastTime = ts;
  dir = nextDir;
  const head = {x: snake[0].x+dir.x, y: snake[0].y+dir.y};
  if (head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS||snake.some(s=>s.x===head.x&&s.y===head.y)) {
    gameState='gameover'; drawGameOver(); return;
  }
  snake.unshift(head);
  if (head.x===food.x&&head.y===food.y) { score+=10; speed=Math.max(60,speed-2); spawnFood(); }
  else snake.pop();
  draw();
}

LAYOUT HTML (úsalo exactamente):
- div#game-container: display:flex, flex-direction:column, align-items:center
- canvas#gameCanvas: 400x400
- div#controls con botones en grid 3x3:
  [vacío][↑][vacío]
  [←][vacío][→]
  [vacío][↓][vacío]
- div#score-display arriba del canvas

GAME OVER: dibuja en canvas con ctx.fillRect oscuro semitransparente + texto + botón restart (NO alert())
START SCREEN: dibuja en canvas con título y "Toca para iniciar"

PROHIBIDO: alert(), confirm(), código incompleto, imágenes externas, texto fuera del HTML`
                : `Genera SOLO el HTML completo para: ${desc}
Tipo: ${tipo}
${imagenesHTML}
Datos extra: ${datos || 'ninguno'}
REGLAS ESTRICTAS:
1. Empieza con <!DOCTYPE html>, termina con </html>
2. Linkea ./css/style.css en el <head>
3. Incluye el script ./js/app.js antes de </body>
${tipo === 'dashboard' ? '4. Incluye CDN de Chart.js: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>' : ''}
5. Estructura semántica completa con header, main, footer
6. Meta tags completos incluyendo <title> descriptivo`;

            const html = await callModel('web', htmlPrompt, { max_tokens: 3000, temperature: 0.3 });

            // Helper: pasar código por Biome para formatear y corregir
            const biomeFormat = (code, ext='js') => {
                try {
                    const { execSync: execB } = require('child_process');
                    const tmpB = `/tmp/biome_tmp_${Date.now()}.${ext}`;
                    require('fs').writeFileSync(tmpB, code, 'utf8');
                    execB(`/home/ruben/wa-ollama/node_modules/.bin/biome format --write ${tmpB} 2>/dev/null`, {encoding:'utf8'});
                    const result = require('fs').readFileSync(tmpB, 'utf8');
                    require('fs').unlinkSync(tmpB);
                    return result;
                } catch(e) {
                    return code; // Si falla, devolver original
                }
            };

            // Limpiar y guardar archivos
            const limpiar = (code, tipo_arch) => {
                let c = code.trim();
                c = c.replace(/^\`\`\`[a-z]*\n?/i, '').replace(/\`\`\`\s*$/,'').trim();
                if (tipo_arch === 'html') {
                    const m = c.match(/<!DOCTYPE[\s\S]*<\/html>/i);
                    if (m) c = m[0];
                }
                return c;
            };

            const htmlLimpio = limpiar(html, 'html');
            const cssLimpio = limpiar(css, 'css');
            const jsLimpio = limpiar(js, 'js');

            if (esTodoEnUno) {
                // Para juegos: formatear el HTML completo con Biome
                const htmlFormateado = biomeFormat(htmlLimpio, 'html');
                fs.default.writeFileSync(tmpDir + '/index.html', htmlFormateado || htmlLimpio, 'utf8');
            } else {
                fs.default.writeFileSync(tmpDir + '/index.html', htmlLimpio, 'utf8');
                fs.default.writeFileSync(tmpDir + '/css/style.css', cssLimpio, 'utf8');
                // Formatear JS con Biome
                const jsFormateado = biomeFormat(jsLimpio, 'js');
                fs.default.writeFileSync(tmpDir + '/js/app.js', jsFormateado || jsLimpio, 'utf8');
            }

            // Si es app_db, generar data.json
            if (tipo === 'app_db') {
                const dataJson = { registros: [], version: '1.0', creado: new Date().toISOString() };
                fs.default.writeFileSync(tmpDir + '/data/data.json', JSON.stringify(dataJson, null, 2), 'utf8');
            }

            // Extraer título del HTML para nombre del proyecto
            const titleMatch = htmlLimpio.match(/<title[^>]*>([^<]+)<\/title>/i);
            const titulo = titleMatch ? titleMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 40) : 'mi-proyecto';

            return JSON.stringify({
                ok: true,
                tmpDir,
                titulo,
                tipo,
                archivos: ['index.html', 'css/style.css', 'js/app.js']
            });
        }

        // ACCION: publicar — sube proyecto completo a GitHub
        if (accion === 'publicar') {
            const tmpDir = parts[1] || '';
            const repo = parts[2] || '';
            const esNuevo = parts[3] === 'nuevo';

            if (!tmpDir || !fs.default.existsSync(tmpDir)) return '❌ No encontré el proyecto generado. Intenta generarlo de nuevo.';
            if (!repo) return '❌ Falta el nombre del repo.';

            let token = process.env.GITHUB_TOKEN || '';
            if (!token) {
                try {
                    const envContent = fs.default.readFileSync('/home/ruben/wa-ollama/.env', 'utf8');
                    const m = envContent.match(/^GITHUB_TOKEN=(.+)$/m);
                    if (m) token = m[1].trim();
                } catch(e) {}
            }
            if (!token) return '❌ GitHub no configurado.';

            // Limpiar nombre del repo — quitar caracteres inválidos
            // Normalizar nombre del repo — quitar acentos y caracteres especiales
            const repoLimpio = repo.toLowerCase()
                .replace(/[áàäâ]/g,'a').replace(/[éèëê]/g,'e').replace(/[íìïî]/g,'i')
                .replace(/[óòöô]/g,'o').replace(/[úùüû]/g,'u').replace(/[ñ]/g,'n')
                .replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'')
                .slice(0, 40);

            const { execSync: execS } = await import('child_process');
            const gh = (url, method='GET', body=null) => {
                const bodyFlag = body ? `--data '${JSON.stringify(body).replace(/'/g, "\x27")}'` : '';
                const r = execS(`curl -s --max-time 15 -X ${method} -H "Authorization: Bearer ${token}" -H "Accept: application/vnd.github+json" ${bodyFlag} "https://api.github.com/${url}"`, {encoding:'utf8'});
                try { return JSON.parse(r); } catch(e) { return { message: r.slice(0,200) }; }
            };

            const user = (() => { try { return gh('user').login; } catch(e) { return 'rendonbarco727-coder'; } })();

            // Crear repo si es nuevo
            if (esNuevo) {
                const created = gh('user/repos', 'POST', { name: repo, private: false, auto_init: false });
                if (created.message && !created.html_url) return '❌ Error creando repo: ' + created.message;
                // Esperar un momento para que GitHub lo inicialice
                execS('sleep 2');
            }

            // Subir todos los archivos recursivamente
            const subirArchivo = (rutaLocal, rutaRepo) => {
                const contenido = fs.default.readFileSync(rutaLocal);
                const contentB64 = contenido.toString('base64');
                let sha = null;
                try {
                    const ex = gh(`repos/${user}/${repo}/contents/${rutaRepo}`);
                    if (ex.sha) sha = ex.sha;
                } catch(e) {}
                const body = { message: `BMO: ${rutaRepo}`, content: contentB64 };
                if (sha) body.sha = sha;
                return gh(`repos/${user}/${repo}/contents/${rutaRepo}`, 'PUT', body);
            };

            const archivosSubidos = [];
            const errores = [];

            const subirDirectorio = (dirLocal, prefijo = '') => {
                const items = fs.default.readdirSync(dirLocal);
                for (const item of items) {
                    const rutaLocal = path.default.join(dirLocal, item);
                    const rutaRepo = prefijo ? prefijo + '/' + item : item;
                    const stat = fs.default.statSync(rutaLocal);
                    if (stat.isDirectory()) {
                        subirDirectorio(rutaLocal, rutaRepo);
                    } else {
                        try {
                            const result = subirArchivo(rutaLocal, rutaRepo);
                            if (result.content) archivosSubidos.push(rutaRepo);
                            else errores.push(rutaRepo + ': ' + (result.message||'error'));
                        } catch(e) {
                            errores.push(rutaRepo + ': ' + e.message.slice(0,50));
                        }
                    }
                }
            };

            subirDirectorio(tmpDir);

            // Activar GitHub Pages — siempre, sea repo nuevo o existente
            try {
                const pagesCheck = execS(`curl -s -H "Authorization: Bearer ${token}" https://api.github.com/repos/${user}/${repoLimpio}/pages`, {encoding:"utf8"});
                const pagesData = JSON.parse(pagesCheck);
                if (pagesData.message === "Not Found") {
                    execS(`gh api repos/${user}/${repoLimpio}/pages --method POST -f 'source[branch]=main' -f 'source[path]=/'`, {encoding:"utf8"});
                }
            } catch(e) {
                try { execS(`gh api repos/${user}/${repoLimpio}/pages --method POST -f 'source[branch]=main' -f 'source[path]=/'`, {encoding:"utf8"}); } catch(e2) {}
            }

            const url = `https://${user}.github.io/${repoLimpio}/`;
            let resp = `✅ Proyecto publicado en *${repoLimpio}*\n`;
            resp += `📁 Archivos subidos: ${archivosSubidos.length}\n`;
            if (errores.length) resp += `⚠️ Errores: ${errores.join(', ')}\n`;
            resp += `🌐 URL: ${url}\n\n`;
            if (esNuevo) resp += `_(Pages puede tardar 1-2 min en activarse)_\n\n`;
            resp += `✏️ ¿Quieres editar algo? Dime qué cambiar o responde *no* para terminar.`;
            resp += `||REPO:${repoLimpio}||USER:${user}`;

            // Limpiar tmp
            try { execS(`rm -rf ${tmpDir}`); } catch(e) {}

            return resp;
        }

        // ACCION: editar — descarga, edita y republica un archivo del repo
        if (accion === 'editar') {
            const repo2 = parts[1] || 'bmo-jarvis-hub';
            const archivo2 = parts[2] || 'index.html';
            const instrucciones = parts[3] || '';

            // Definir token y gh helper para esta acción
            let token2 = process.env.GITHUB_TOKEN || '';
            if (!token2) {
                try {
                    const envContent2 = fs.default.readFileSync('/home/ruben/wa-ollama/.env', 'utf8');
                    const m2 = envContent2.match(/^GITHUB_TOKEN=(.+)$/m);
                    if (m2) token2 = m2[1].trim();
                } catch(e) {}
            }
            const { execSync: execS2 } = await import('child_process');
            const gh = (url, method='GET', body=null) => {
                const bodyFlag = body ? `--data '${JSON.stringify(body).replace(/'/g, "\x27")}'` : '';
                const r = execS2(`curl -s --max-time 15 -X ${method} -H "Authorization: Bearer ${token2}" -H "Accept: application/vnd.github+json" ${bodyFlag} "https://api.github.com/${url}"`, {encoding:'utf8'});
                try { return JSON.parse(r); } catch(e) { return { message: r.slice(0,200) }; }
            };
            const user2 = (() => { try { return gh('user').login; } catch(e) { return 'rendonbarco727-coder'; } })();

            // Descargar archivo actual
            const fileInfo = gh(`repos/${user2}/${repo2}/contents/${archivo2}`);
            if (fileInfo.message) return `❌ No encontré ${archivo2} en ${repo2}: ${fileInfo.message}`;

            const contenidoActual = Buffer.from(fileInfo.content, 'base64').toString('utf8');

            // Editar con modelo potente
            const { callModel: cm } = await import('../core/model_router.js');
            const contenidoEditado = await cm('web',
                `Eres un experto en desarrollo web. Tienes este archivo HTML completo y debes modificarlo.

CAMBIOS SOLICITADOS: ${instrucciones}

ARCHIVO ACTUAL:
${contenidoActual}

REGLAS ESTRICTAS:
1. Devuelve SOLO el código HTML completo modificado, sin explicaciones
2. Empieza con <!DOCTYPE html> y termina con </html>
3. Aplica TODOS los cambios pedidos
4. Mantén TODO el código existente que no se pide cambiar
5. Si piden "botones de control", agrega botones ↑↓←→ visibles en pantalla
6. Si piden "más lento", reduce la velocidad inicial (aumenta el intervalo de tiempo)
7. Si piden "pantalla game over bonita", reemplaza alert() por una pantalla en canvas
8. PROHIBIDO: explicaciones, texto fuera del HTML, código incompleto`,
                { max_tokens: 6000, temperature: 0.2 }
            );

            // Limpiar y subir
            let limpio = contenidoEditado.trim().replace(/^\`\`\`[a-z]*\n?/i,'').replace(/\`\`\`\s*$/,'').trim();
            const htmlM = limpio.match(/<!DOCTYPE[\s\S]*<\/html>/i);
            if (htmlM) limpio = htmlM[0];

            const contentB64 = Buffer.from(limpio).toString('base64');
            const body = { message: `BMO: editado ${archivo2} — ${instrucciones.slice(0,50)}`, content: contentB64, sha: fileInfo.sha };
            const result = gh(`repos/${user2}/${repo2}/contents/${archivo2}`, 'PUT', body);

            if (result.content) {
                return `✅ *${archivo2}* actualizado en *${repo2}*\n🌐 https://${user2}.github.io/${repo2}/\n\n✏️ ¿Algo más que editar? Responde *no* para terminar.||REPO:${repo2}||USER:${user2}`;
            }
            return `❌ Error al guardar: ${result.message||'desconocido'}`;
        }

        return 'Acciones: analizar||descripcion | generar||contextoJSON | publicar||tmpDir||repo||nuevo | editar||repo||archivo||instrucciones';
    },

    // ── SKILLS (OpenClaw) ──────────────────────────────────────────────
    ejecutar_skill: async (input, ctx) => {
        // input: "nombre_skill|mensaje_usuario"
        const [skillNombre, ...resto] = String(input).split('|');
        const mensajeUsuario = resto.join('|') || input;
        try {
            const { leerSkillMd, usarSkill } = await import('../skills/skill_registry.js');
            const skillMd = leerSkillMd(skillNombre.trim());
            if (!skillMd) return `Skill "${skillNombre}" no encontrada o no tiene SKILL.md`;
            usarSkill(skillNombre.trim());
            const prompt = `Usa las siguientes instrucciones de skill para responder al usuario.

=== SKILL: ${skillNombre.trim()} ===
${skillMd}
=== FIN SKILL ===

Mensaje del usuario: ${mensajeUsuario}

Responde siguiendo exactamente las instrucciones de la skill.`;
            const respuesta = await callModel('rapido', prompt);
            return respuesta || 'La skill no generó respuesta.';
        } catch(e) {
            return `Error ejecutando skill ${skillNombre}: ${e.message}`;
        }
    },


    crear_documento_interactivo: async (input, ctx) => {
        const { ejecutar } = await import('./crear_documento_interactivo.js');
        const sesion = { mensajeOriginal: input, ultimoMensaje: input };
        await ejecutar({ client: ctx.clienteWA, id: ctx.userId, sesion });
        return null; // maneja mensajes directamente
    },

    controlar_casa: async (input, ctx) => {
        const { ejecutar } = await import('./home_assistant.js');
        const sesion = { mensajeOriginal: input, ultimoMensaje: input };
        await ejecutar({ client: ctx.clienteWA, id: ctx.userId, sesion });
        return null; // home_assistant.js envía mensajes directamente
    },

    crear_docx: async (input, ctx) => {
        // input: "nombre_archivo|contenido en texto plano"
        try {
            const sep = input.indexOf('|');
            if (sep === -1) return '❌ Formato: nombre_archivo|contenido';
            const nombreBase = input.slice(0, sep).trim().replace(/[^a-zA-Z0-9_ áéíóúñÁÉÍÓÚÑ-]/g, '').trim() || 'documento';
            const contenido = input.slice(sep + 1).trim();
            if (!contenido) return '❌ Contenido vacío';

            // Importar path localmente
            const pathMod2 = await import('path');
            const pathLib = pathMod2.default || pathMod2;

            // Auto-instalar docx si falta
            const PROJECT_ROOT = '/home/ruben/wa-ollama';
            const docxPath = pathLib.join(PROJECT_ROOT, 'node_modules', 'docx');
            if (!fs.existsSync(docxPath)) {
                console.log('[TOOL] crear_docx | Instalando dependencia docx...');
                await execAsync('cd ' + PROJECT_ROOT + ' && npm install docx --save --prefer-offline 2>&1', { timeout: 60000 });
            }

            const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');

            const lineas = contenido.split('\n');
            const parrafos = lineas.map(linea => {
                const esEncabezado = /^\*\*(.+)\*\*$/.test(linea) || (linea.length < 60 && /^[A-ZÁÉÍÓÚÑ]/.test(linea) && !linea.endsWith('.'));
                const textoLimpio = linea.replace(/\*\*/g, '').trim();
                if (!textoLimpio) return new Paragraph({});
                if (esEncabezado) {
                    return new Paragraph({
                        heading: HeadingLevel.HEADING_2,
                        children: [new TextRun({ text: textoLimpio, bold: true })]
                    });
                }
                return new Paragraph({ children: [new TextRun(textoLimpio)] });
            });

            const doc = new Document({ sections: [{ children: parrafos }] });
            const buffer = await Packer.toBuffer(doc);

            const outDir = '/tmp';
            const outPath = pathLib.join(outDir, nombreBase.replace(/ /g, '_') + '.docx');
            fs.writeFileSync(outPath, buffer);

            console.log('[TOOL] crear_docx | Guardado: ' + outPath);
            return outPath;
        } catch(e) {
            return 'Error en crear_docx: ' + e.message.slice(0, 300);
        }
    },


};

export async function ejecutarTool(nombre, input, ctx = {}) {
    const tool = TOOLS[nombre];
    if (!tool) return `Herramienta desconocida: ${nombre}`;
    try {
        console.log(`[TOOL] ${nombre} | ${String(input).slice(0, 80)}`);

        const t0 = Date.now();
        const resultado = await tool(input, ctx);
        registrarToolUsage(nombre, ctx.userId || 'global', true, Date.now() - t0);
        return resultado;
    } catch(e) {
        console.error(`[TOOL] Error en ${nombre}:`, e.message);
        registrarToolUsage(nombre, ctx.userId || 'global', false, 0);
        logError('tool_error', e.message, { contexto: { tool: nombre, input: String(input).slice(0, 100) } });
        return `Error en ${nombre}: ${e.message}`;
    }
}

export function listarTools() { return Object.keys(TOOLS); }

// bmo_endpoint.js — Servidor HTTP que recibe instrucciones desde bmo_brain.html
// Escucha en puerto 3001, accesible via Tailscale desde cualquier dispositivo

import express from 'express';
import { emitirEvento, agregarCliente, removerCliente } from './core/sse_emitter.js';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

const BASE_DIR = '/home/ruben/wa-ollama';
const PORT = 3001;
const SECRET = process.env.BMO_SECRET || 'bmo-bridge-secret-2025';

const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS — solo permitir desde Tailscale y GitHub Pages
app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowed = [
    'https://rendonbarco727-coder.github.io',
    'http://100.81.246.50:3001',
    'null' // Para pruebas locales
  ];
  if (allowed.some(o => origin.includes(o)) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-BMO-Secret, x-secret');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── PING ────────────────────────────────────────────────────
app.get('/ping', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), version: 'bmo-endpoint-1.0' });
});

// ─── RECIBIR INSTRUCCIÓN ─────────────────────────────────────
app.post('/instruccion', async (req, res) => {
  // Validar secret
  const secret = req.headers['x-bmo-secret'];
  if (secret !== SECRET) {
    console.error(`[ENDPOINT] Secret inválido desde ${req.ip}`);
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  const instr = req.body;

  // Validar estructura mínima
  if (!instr || !instr.tipo) {
    return res.status(400).json({ ok: false, error: 'Instrucción inválida' });
  }

  console.log(`[ENDPOINT] Instrucción recibida: ${instr.tipo} — ${instr.descripcion}`);

  try {
    const resultado = await aplicarInstruccion(instr);
    res.json({ ok: resultado.ok, mensaje: resultado.mensaje });
  } catch(e) {
    console.error('[ENDPOINT] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── ESTADO ACTUAL ───────────────────────────────────────────
app.get('/estado', (req, res) => {
  try {
    const applied = path.join(BASE_DIR, '.instruccion_aplicada');
    const moduloRoto = path.join(BASE_DIR, '.modulo_roto');
    res.json({
      ok: true,
      ultimaInstruccion: fs.existsSync(applied) ? fs.readFileSync(applied, 'utf8').trim() : null,
      moduloRoto: fs.existsSync(moduloRoto) ? fs.readFileSync(moduloRoto, 'utf8').trim() : null,
      ts: new Date().toISOString()
    });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── APLICAR INSTRUCCIÓN ─────────────────────────────────────
async function aplicarInstruccion(instr) {

  if (instr.tipo === 'fix' && instr.codigo && instr.archivo) {
    const target = path.join(BASE_DIR, instr.archivo);

    // Seguridad: solo archivos dentro de BASE_DIR
    if (!target.startsWith(BASE_DIR)) {
      return { ok: false, mensaje: 'Ruta no permitida' };
    }

    // Backup
    if (fs.existsSync(target)) {
      const backup = target + '.endpoint_backup_' + Date.now();
      fs.copyFileSync(target, backup);
      console.log(`[ENDPOINT] Backup: ${backup}`);
    }

    // Verificar sintaxis
    const tmp = `/tmp/bmo_ep_fix_${Date.now()}.js`;
    fs.writeFileSync(tmp, instr.codigo);
    try {
      await execAsync(`node --check ${tmp}`);
    } catch(e) {
      fs.unlinkSync(tmp);
      return { ok: false, mensaje: 'Sintaxis inválida: ' + e.message.slice(0, 100) };
    }
    fs.unlinkSync(tmp);

    // Aplicar
    if (instr.modo === 'append') {
      fs.appendFileSync(target, '\n' + instr.codigo);
    } else {
      fs.writeFileSync(target, instr.codigo);
    }

    // Marcar aplicada
    fs.writeFileSync(
      path.join(BASE_DIR, '.instruccion_aplicada'),
      instr.timestamp || Date.now().toString()
    );

    // Limpiar flag módulo roto
    const mrFlag = path.join(BASE_DIR, '.modulo_roto');
    if (fs.existsSync(mrFlag)) fs.unlinkSync(mrFlag);

    console.log(`[ENDPOINT] Fix aplicado en ${instr.archivo}`);
    return { ok: true, mensaje: `Fix aplicado en ${instr.archivo}` };

  } else if (instr.tipo === 'modulo_nuevo' && instr.codigo && instr.archivo) {
    const modPath = path.join(BASE_DIR, 'evoluciones', instr.archivo);

    const tmp = `/tmp/bmo_ep_mod_${Date.now()}.js`;
    fs.writeFileSync(tmp, instr.codigo);
    try {
      await execAsync(`node --check ${tmp}`);
    } catch(e) {
      fs.unlinkSync(tmp);
      return { ok: false, mensaje: 'Sintaxis inválida en módulo' };
    }
    fs.unlinkSync(tmp);

    fs.writeFileSync(modPath, instr.codigo);
    console.log(`[ENDPOINT] Módulo creado: ${modPath}`);
    return { ok: true, mensaje: `Módulo ${instr.archivo} creado` };

  } else if (instr.tipo === 'reiniciar') {
    // Reinicio diferido 3 segundos para dar tiempo a responder
    setTimeout(async () => {
      try {
        await execAsync('sudo systemctl restart wa-bot');
      } catch(e) {
        console.error('[ENDPOINT] Error reiniciando:', e.message);
      }
    }, 3000);
    return { ok: true, mensaje: 'Reinicio programado en 3s' };

  } else if (instr.tipo === 'comando' && instr.comando) {
    // Solo comandos permitidos
    const PERMITIDOS = ['systemctl status wa-bot', 'journalctl -u wa-bot -n 20 --no-pager'];
    if (!PERMITIDOS.includes(instr.comando)) {
      return { ok: false, mensaje: 'Comando no permitido' };
    }
    const { stdout } = await execAsync(instr.comando);
    return { ok: true, mensaje: stdout.slice(0, 500) };

  } else {
    return { ok: false, mensaje: `Tipo desconocido: ${instr.tipo}` };
  }
}

// ─── INICIAR ─────────────────────────────────────────────────

// ─── SKILLS HUB ──────────────────────────────────────────────
app.get('/skills', (req, res) => {
  if (req.headers['x-bmo-secret'] !== SECRET) return res.status(401).end();
  const skillsDir = '/home/ruben/wa-ollama/skills';
  const dirs = fs.existsSync(skillsDir)
    ? fs.readdirSync(skillsDir).filter(f => {
        try { return fs.statSync(path.join(skillsDir,f)).isDirectory(); } catch(e){ return false; }
      })
    : [];
  const skills = dirs.map(slug => {
    const mdPath = path.join(skillsDir, slug, 'SKILL.md');
    const md = fs.existsSync(mdPath) ? fs.readFileSync(mdPath,'utf8') : '';
    const nameMatch = md.match(/^name:\s*(.+)/m);
    const descMatch = md.match(/^description:\s*(.+)/m);
    return {
      id: slug,
      name: nameMatch?.[1]?.trim() || slug,
      description: descMatch?.[1]?.trim() || '',
      file: `skills/${slug}/SKILL.md`,
      status: 'installed',
      icon: '🧩'
    };
  });
  res.json({ skills });
});

app.post('/skills/install', (req, res) => {
  if (req.headers['x-bmo-secret'] !== SECRET) return res.status(401).end();
  const { slug, name, content } = req.body;
  if (!slug) return res.status(400).json({ ok: false, error: 'slug requerido' });
  const dir = path.join('/home/ruben/wa-ollama/skills', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content || `# ${name || slug}\n`);
  console.log(`[SKILLS] ✅ Instalada: ${slug}`);
  res.json({ ok: true, slug });
});

app.post('/skills/remove', (req, res) => {
  if (req.headers['x-bmo-secret'] !== SECRET) return res.status(401).end();
  const { id } = req.body;
  if (!id) return res.status(400).json({ ok: false, error: 'id requerido' });
  const dir = path.join('/home/ruben/wa-ollama/skills', id);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`[SKILLS] 🗑 Removida: ${id}`);
  }
  res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[ENDPOINT] BMO Endpoint activo en puerto ${PORT}`);
  console.log(`[ENDPOINT] Tailscale: http://100.81.246.50:${PORT}/ping`);
  console.log(`[ENDPOINT] Secret: ${SECRET}`);
});

// ─── FILE MANAGER ────────────────────────────────────────────
const DIR = '/home/ruben/wa-ollama';

app.get('/files', (req,res) => {
  const files = fs.readdirSync(DIR)
    .filter(f => !['node_modules','backups','.wwebjs_auth','.wwebjs_cache'].includes(f))
    .filter(f => f.endsWith('.js') || f.endsWith('.json') || f === '.env')
    .map(f => {
      const st = fs.statSync(path.join(DIR,f));
      const ext = path.extname(f).slice(1);
      return { name:f, size:st.size, modified:st.mtime.toISOString().slice(0,10), type:ext==='js'?'js':ext==='json'?'json':'other', badge:f==='index.js'?'main':ext==='js'?'mod':null };
    });
  res.json({ files });
});

app.get('/file/:name', (req,res) => {
  try {
    const fp = path.resolve(DIR, req.params.name);
    if (!fp.startsWith(DIR)) return res.json({error:'invalid'});
    res.json({ content: fs.readFileSync(fp,'utf8') });
  } catch(e) { res.json({error:e.message}); }
});

app.put('/file/:name', (req,res) => {
  try {
    const fp = path.resolve(DIR, req.params.name);
    if (!fp.startsWith(DIR)) return res.json({error:'invalid'});
    fs.writeFileSync(fp, req.body.content);
    res.json({ ok:true });
  } catch(e) { res.json({error:e.message}); }
});

app.delete('/file/:name', (req,res) => {
  try {
    const fp = path.resolve(DIR, req.params.name);
    if (!fp.startsWith(DIR)) return res.json({error:'invalid'});
    fs.unlinkSync(fp);
    res.json({ ok:true });
  } catch(e) { res.json({error:e.message}); }
});

app.get('/backups', (req,res) => {
  try {
    const bkDir = path.join(DIR,'backups');
    if (!fs.existsSync(bkDir)) return res.json({backups:[]});
    const backups = fs.readdirSync(bkDir).map(f => ({
      name:f, date: fs.statSync(path.join(bkDir,f)).mtime.toISOString().slice(0,10)
    }));
    res.json({ backups });
  } catch(e) { res.json({error:e.message}); }
});

app.post('/backup', async (req,res) => {
  try {
    const name = `index.js.backup_${Date.now()}`;
    fs.copyFileSync(path.join(DIR,'index.js'), path.join(DIR,'backups',name));
    res.json({ ok:true, name });
  } catch(e) { res.json({error:e.message}); }
});

// ─── SSE EVENTOS EN TIEMPO REAL ──────────────────────────────
app.get('/eventos', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const EVENT_PIPE = '/tmp/bmo_events.pipe';
  let lastSize = 0;
  try { lastSize = fs.statSync(EVENT_PIPE).size; } catch(e) {}

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch(e) { clearInterval(ping); watcher.close(); }
  }, 15000);

  // Leer eventos nuevos del archivo
  const watcher = setInterval(() => {
    try {
      const stat = fs.statSync(EVENT_PIPE);
      if (stat.size > lastSize) {
        const content = fs.readFileSync(EVENT_PIPE, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        const newLines = lines.slice(Math.max(0, lines.length - 20));
        // Calcular cuántas líneas nuevas hay
        const bytesAntes = lastSize;
        lastSize = stat.size;
        // Enviar últimas líneas
        for (const line of newLines.slice(-5)) {
          try {
            const ev = JSON.parse(line);
            if (ev.ts > Date.now() - 5000) { // Solo eventos de los últimos 5s
              res.write(`data: ${line}\n\n`);
            }
          } catch(e) {}
        }
      }
    } catch(e) {}
  }, 300);

  req.on('close', () => {
    clearInterval(ping);
    clearInterval(watcher);
  });
});

// ─── ENDPOINT INTERNO — recibe eventos de BMO y los reenvía por SSE ───
app.post('/interno/evento', (req, res) => {
  const secret = req.headers['x-bmo-secret'];
  if (secret !== SECRET) return res.status(401).end();
  const { tipo, datos } = req.body;
  emitirEvento(tipo, datos);
  res.json({ ok: true });
});

// ─── LOGS EN TIEMPO REAL ─────────────────────────────────────
app.get('/logs', async (req, res) => {
  try {
    const { stdout } = await execAsync('tail -n 50 /home/ruben/.pm2/logs/bmo-out.log');
    res.json({ ok: true, logs: stdout.split('\n').filter(l => l.trim()) });
  } catch(e) {
    res.json({ ok: false, logs: [] });
  }
});

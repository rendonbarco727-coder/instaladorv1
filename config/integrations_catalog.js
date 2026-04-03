import { execSync } from 'child_process';
import fs from 'fs';

// Catálogo completo de integraciones
export const INTEGRATIONS = {
  github: {
    nombre: 'GitHub',
    descripcion: 'Crear repos, subir archivos, GitHub Pages',
    comandos: ['sube a github', 'publica en github', 'crea un repo', 'github pages'],
    verificar: () => {
      const token = process.env.GITHUB_TOKEN || '';
      if (!token) return { ok: false, razon: 'Sin token' };
      try {
        const r = execSync(`curl -s --max-time 5 -H "Authorization: Bearer ${token}" https://api.github.com/user`, {encoding:'utf8'});
        const d = JSON.parse(r);
        return d.login ? { ok: true, info: `@${d.login}` } : { ok: false, razon: 'Token invalido' };
      } catch { return { ok: false, razon: 'Error de conexion' }; }
    },
    configurar: [
      { pregunta: 'Ve a https://github.com/settings/tokens\nCrea un *Personal Access Token (classic)*\nPermisos: repo, workflow\n\nPega tu token:', env: 'GITHUB_TOKEN', validar: (v) => v.startsWith('ghp_') || v.startsWith('github_pat_') }
    ]
  },
  gmail: {
    nombre: 'Gmail',
    descripcion: 'Leer y enviar correos desde WhatsApp',
    comandos: ['envia un correo', 'lee mi gmail', 'revisa mi email'],
    verificar: () => {
      const user = process.env.GMAIL_USER || '';
      const pass = process.env.GMAIL_APP_PASSWORD || '';
      if (!user || !pass) return { ok: false, razon: 'Sin credenciales' };
      return { ok: true, info: user };
    },
    configurar: [
      { pregunta: 'Tu correo de Gmail (ejemplo: tunombre@gmail.com):', env: 'GMAIL_USER', validar: (v) => v.includes('@gmail.com') },
      { pregunta: 'Necesitas una *App Password* de Google.\nVe a: https://myaccount.google.com/apppasswords\nCrea una para "Correo"\n\nPega la App Password (16 caracteres):', env: 'GMAIL_APP_PASSWORD', validar: (v) => v.replace(/\s/g,'').length >= 16 }
    ]
  },
  google_calendar: {
    nombre: 'Google Calendar',
    descripcion: 'Ver y crear eventos en tu calendario',
    comandos: ['agenda', 'calendario', 'crea un evento', 'que tengo hoy'],
    verificar: () => {
      const creds = process.env.GOOGLE_CALENDAR_CREDENTIALS || '';
      return creds ? { ok: true, info: 'Configurado' } : { ok: false, razon: 'Sin credenciales' };
    },
    configurar: [
      { pregunta: 'Para Google Calendar necesitas OAuth2.\nVe a: https://console.cloud.google.com\n1. Crea un proyecto\n2. Habilita Calendar API\n3. Crea credenciales OAuth2\n4. Descarga el JSON\n\nPega el contenido del JSON de credenciales:', env: 'GOOGLE_CALENDAR_CREDENTIALS', validar: (v) => v.includes('client_id') }
    ]
  },
  telegram: {
    nombre: 'Telegram Bot',
    descripcion: 'BMO también disponible en Telegram',
    comandos: ['telegram', 'bot telegram'],
    verificar: () => {
      const token = process.env.TELEGRAM_BOT_TOKEN || '';
      if (!token) return { ok: false, razon: 'Sin token' };
      try {
        const r = execSync(`curl -s --max-time 5 "https://api.telegram.org/bot${token}/getMe"`, {encoding:'utf8'});
        const d = JSON.parse(r);
        return d.ok ? { ok: true, info: `@${d.result?.username}` } : { ok: false, razon: 'Token invalido' };
      } catch { return { ok: false, razon: 'Error' }; }
    },
    configurar: [
      { pregunta: 'Habla con @BotFather en Telegram\nEscribe /newbot y sigue los pasos\n\nPega el token que te da BotFather:', env: 'TELEGRAM_BOT_TOKEN', validar: (v) => v.includes(':') && v.length > 20 }
    ]
  },
  notion: {
    nombre: 'Notion',
    descripcion: 'Crear y leer páginas de Notion',
    comandos: ['notion', 'crea una nota en notion', 'agrega a notion'],
    verificar: () => {
      const token = process.env.NOTION_TOKEN || '';
      if (!token) return { ok: false, razon: 'Sin token' };
      try {
        const r = execSync(`curl -s --max-time 5 -H "Authorization: Bearer ${token}" -H "Notion-Version: 2022-06-28" https://api.notion.com/v1/users/me`, {encoding:'utf8'});
        const d = JSON.parse(r);
        return d.object === 'user' ? { ok: true, info: d.name } : { ok: false, razon: 'Token invalido' };
      } catch { return { ok: false, razon: 'Error' }; }
    },
    configurar: [
      { pregunta: 'Ve a https://www.notion.so/my-integrations\nCrea una nueva integracion\n\nPega el token (empieza con secret_):', env: 'NOTION_TOKEN', validar: (v) => v.startsWith('secret_') }
    ]
  },
  spotify: {
    nombre: 'Spotify',
    descripcion: 'Controlar musica de Spotify',
    comandos: ['spotify', 'pon musica', 'pausa spotify', 'siguiente cancion'],
    verificar: () => {
      const token = process.env.SPOTIFY_CLIENT_ID || '';
      return token ? { ok: true, info: 'Configurado' } : { ok: false, razon: 'Sin credenciales' };
    },
    configurar: [
      { pregunta: 'Ve a https://developer.spotify.com/dashboard\nCrea una app\n\nPega el *Client ID*:', env: 'SPOTIFY_CLIENT_ID', validar: (v) => v.length >= 20 },
      { pregunta: 'Ahora pega el *Client Secret*:', env: 'SPOTIFY_CLIENT_SECRET', validar: (v) => v.length >= 20 }
    ]
  }
};

// Verificar todas las integraciones
export function verificarIntegraciones() {
  const resultado = {};
  for (const [key, int] of Object.entries(INTEGRATIONS)) {
    try { resultado[key] = { ...int.verificar(), nombre: int.nombre, descripcion: int.descripcion }; }
    catch { resultado[key] = { ok: false, razon: 'Error', nombre: int.nombre }; }
  }
  return resultado;
}

// Detectar qué integración necesita un mensaje
export function detectarIntegracionNecesaria(mensaje) {
  const msg = mensaje.toLowerCase();
  for (const [key, int] of Object.entries(INTEGRATIONS)) {
    if (int.comandos.some(cmd => msg.includes(cmd))) {
      const estado = int.verificar();
      if (!estado.ok) return { key, int, estado };
    }
  }
  return null;
}

const _sesionesInt = new Map();
export const getSesionInt = (id) => _sesionesInt.get(id);
export const setSesionInt = (id, data) => _sesionesInt.set(id, data);
export const clearSesionInt = (id) => _sesionesInt.delete(id);

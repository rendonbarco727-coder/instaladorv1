import fs from 'fs';
import { execSync } from 'child_process';

const ENV_PATH = '/home/ruben/wa-ollama/.env';

export const API_CATALOG = {
  GEMINI_API_KEY: {
    nombre: 'Google Gemini',
    opciones: [
      { id: 1, desc: 'Gemini 2.5 Flash (recomendado)' },
      { id: 2, desc: 'Gemini 2.0 Flash' },
      { id: 3, desc: 'Gemini 1.5 Pro' },
    ],
    validar: (key) => {
      try {
        const r = execSync(`curl -s --max-time 8 "https://generativelanguage.googleapis.com/v1beta/models?key=${key}"`, {encoding:'utf8'});
        return !JSON.parse(r).error;
      } catch { return false; }
    },
    url: 'https://aistudio.google.com/app/apikey'
  },
  GROQ_API_KEY: {
    nombre: 'Groq (LLaMA)',
    opciones: [
      { id: 1, desc: 'LLaMA 3.1 8B (rápido, gratis)' },
      { id: 2, desc: 'LLaMA 3.3 70B (más potente)' },
    ],
    validar: (key) => {
      try {
        const tmp = `/tmp/groq_test_${Date.now()}.json`;
        fs.writeFileSync(tmp, JSON.stringify({model:'llama-3.1-8b-instant',messages:[{role:'user',content:'hi'}],max_tokens:5}));
        const r = execSync(`curl -s --max-time 8 -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" https://api.groq.com/openai/v1/chat/completions -d @${tmp}`, {encoding:'utf8'});
        try { fs.unlinkSync(tmp); } catch {}
        return !JSON.parse(r).error;
      } catch { return false; }
    },
    url: 'https://console.groq.com/keys'
  },
  MISTRAL_API_KEY: {
    nombre: 'Mistral AI',
    opciones: [
      { id: 1, desc: 'Mistral Small (rápido)' },
      { id: 2, desc: 'Mistral Large (potente)' },
    ],
    validar: (key) => {
      try {
        const tmp = `/tmp/mist_test_${Date.now()}.json`;
        fs.writeFileSync(tmp, JSON.stringify({model:'mistral-small-latest',messages:[{role:'user',content:'hi'}],max_tokens:5}));
        const r = execSync(`curl -s --max-time 8 -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" https://api.mistral.ai/v1/chat/completions -d @${tmp}`, {encoding:'utf8'});
        try { fs.unlinkSync(tmp); } catch {}
        return !JSON.parse(r).error;
      } catch { return false; }
    },
    url: 'https://console.mistral.ai/api-keys'
  },
  EXA_API_KEY: {
    nombre: 'EXA Search',
    opciones: [{ id: 1, desc: 'EXA Search (busqueda semantica)' }],
    validar: (key) => {
      try {
        const tmp = `/tmp/exa_test_${Date.now()}.json`;
        fs.writeFileSync(tmp, JSON.stringify({query:'test',numResults:1}));
        const r = execSync(`curl -s --max-time 8 -H "x-api-key: ${key}" -H "Content-Type: application/json" https://api.exa.ai/search -d @${tmp}`, {encoding:'utf8'});
        try { fs.unlinkSync(tmp); } catch {}
        return !JSON.parse(r).error;
      } catch { return false; }
    },
    url: 'https://dashboard.exa.ai/api-keys'
  },
  GITHUB_TOKEN: {
    nombre: 'GitHub',
    opciones: [{ id: 1, desc: 'Token de acceso personal' }],
    validar: (key) => {
      try {
        const r = execSync(`curl -s --max-time 8 -H "Authorization: Bearer ${key}" https://api.github.com/user`, {encoding:'utf8'});
        return !!JSON.parse(r).login;
      } catch { return false; }
    },
    url: 'https://github.com/settings/tokens'
  }
};

export function leerEnv() {
  const vars = {};
  if (!fs.existsSync(ENV_PATH)) return vars;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) vars[line.slice(0,idx).trim()] = line.slice(idx+1).trim();
  }
  return vars;
}

export function setEnvVar(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  content = regex.test(content) ? content.replace(regex, `${key}=${value}`) : content + `\n${key}=${value}`;
  fs.writeFileSync(ENV_PATH, content);
  process.env[key] = value;
}

export async function verificarTodasAPIs() {
  const env = leerEnv();
  const resultados = {};
  for (const [envKey, info] of Object.entries(API_CATALOG)) {
    const key = env[envKey] || process.env[envKey] || '';
    if (!key) {
      resultados[envKey] = { estado: 'no_configurada', nombre: info.nombre };
    } else {
      try {
        resultados[envKey] = { estado: info.validar(key) ? 'activa' : 'expirada', nombre: info.nombre };
      } catch {
        resultados[envKey] = { estado: 'error', nombre: info.nombre };
      }
    }
  }
  return resultados;
}

const _sesiones = new Map();
export const getSesionConfig = (id) => _sesiones.get(id);
export const setSesionConfig = (id, data) => _sesiones.set(id, data);
export const clearSesionConfig = (id) => _sesiones.delete(id);

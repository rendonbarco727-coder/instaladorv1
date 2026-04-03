// core/skill_security_agent.js — Agente de ciberseguridad para skills
// Verifica skills antes de instalarlas: análisis de intención + escaneo de código

import { execAsync } from './context.js';

// Patrones de código malicioso conocidos
const PATRONES_MALICIOSOS = [
  // Exfiltración de datos
  { patron: /curl[^|]*\|\s*bash/i,           nivel: 'CRITICO',  desc: 'pipe curl|bash — ejecución remota' },
  { patron: /wget[^|]*\|\s*(bash|sh|python)/i, nivel: 'CRITICO', desc: 'pipe wget|shell — ejecución remota' },
  { patron: /base64\s*-d.*\|\s*(bash|sh)/i,  nivel: 'CRITICO',  desc: 'base64 decode + shell — payload oculto' },
  { patron: /eval\s*\([^)]*fetch/i,          nivel: 'CRITICO',  desc: 'eval(fetch) — código remoto dinámico' },
  { patron: /process\.env/g,                 nivel: 'ALTO',     desc: 'acceso a variables de entorno' },
  { patron: /\.env\b/,                       nivel: 'ALTO',     desc: 'lectura de archivo .env' },
  { patron: /\/etc\/passwd/i,                nivel: 'CRITICO',  desc: 'acceso a /etc/passwd' },
  { patron: /\/etc\/shadow/i,                nivel: 'CRITICO',  desc: 'acceso a /etc/shadow' },
  { patron: /ssh.*id_rsa|id_rsa.*ssh/i,      nivel: 'CRITICO',  desc: 'acceso a clave SSH privada' },
  // Crypto / wallets
  { patron: /wallet|mnemonic|seed.?phrase|private.?key/i, nivel: 'ALTO', desc: 'posible extracción de wallet crypto' },
  { patron: /metamask|phantom|keystore/i,    nivel: 'ALTO',     desc: 'referencia a wallet browser' },
  // Persistencia / backdoors
  { patron: /crontab|\/etc\/cron/i,          nivel: 'ALTO',     desc: 'modificación de cron — posible persistencia' },
  { patron: /systemctl\s+enable/i,           nivel: 'MEDIO',    desc: 'habilitación de servicio systemd' },
  { patron: /~\/\.bashrc|~\/\.profile|~\/\.zshrc/i, nivel: 'ALTO', desc: 'modificación de shell profile' },
  // Exfiltración de red
  { patron: /ngrok|serveo|localhost\.run/i,  nivel: 'ALTO',     desc: 'túnel de red externo detectado' },
  { patron: /discord\.com\/api\/webhooks/i,  nivel: 'ALTO',     desc: 'webhook Discord — posible exfiltración' },
  { patron: /telegram\.org\/bot.*sendMessage/i, nivel: 'ALTO',  desc: 'bot Telegram externo — posible exfiltración' },
  // Destructivo
  { patron: /rm\s+-rf\s+\//i,               nivel: 'CRITICO',  desc: 'rm -rf / — comando destructivo' },
  { patron: /dd\s+if=\/dev\/zero/i,          nivel: 'CRITICO',  desc: 'dd /dev/zero — borrado de disco' },
  { patron: /mkfs\./i,                       nivel: 'CRITICO',  desc: 'formateo de sistema de archivos' },
  // Obfuscación
  { patron: /\\x[0-9a-f]{2}(\\x[0-9a-f]{2}){8,}/i, nivel: 'ALTO', desc: 'secuencia hex larga — posible obfuscación' },
  { patron: /atob\s*\(/,                     nivel: 'MEDIO',    desc: 'decodificación base64 en runtime' },
  { patron: /String\.fromCharCode\s*\(/,     nivel: 'MEDIO',    desc: 'construcción de string por charcode — posible obfuscación' },
];

// Escaneo estático del código
function escanearCodigo(contenido) {
  const hallazgos = [];
  for (const { patron, nivel, desc } of PATRONES_MALICIOSOS) {
    if (patron.test(contenido)) {
      hallazgos.push({ nivel, desc, patron: patron.toString() });
    }
  }
  return hallazgos;
}

// Parsear frontmatter YAML del SKILL.md
function parsearFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const resultado = {};
  for (const linea of yaml.split('\n')) {
    const m = linea.match(/^(\w+):\s*(.+)$/);
    if (m) resultado[m[1].trim()] = m[2].trim();
  }
  return resultado;
}

// Agente principal de seguridad
export async function auditarSkill({ slug, skillMd, archivosExtra = [], contexto = '', objetivo = '' }) {
  const resultado = {
    slug,
    aprobada: false,
    nivel_riesgo: 'DESCONOCIDO',  // LIMPIA | BAJO | MEDIO | ALTO | CRITICO
    hallazgos_estaticos: [],
    analisis_llm: null,
    veredicto: null,
    razon: '',
  };

  // ── 1. Escaneo estático del SKILL.md ────────────────────────────────
  const hallazgosMd = escanearCodigo(skillMd);
  resultado.hallazgos_estaticos.push(...hallazgosMd.map(h => ({ archivo: 'SKILL.md', ...h })));

  // Escaneo de archivos de código adicionales
  for (const { nombre, contenido } of archivosExtra) {
    const hallazgos = escanearCodigo(contenido);
    resultado.hallazgos_estaticos.push(...hallazgos.map(h => ({ archivo: nombre, ...h })));
  }

  // Determinar nivel de riesgo estático
  const niveles = resultado.hallazgos_estaticos.map(h => h.nivel);
  if (niveles.includes('CRITICO'))     resultado.nivel_riesgo = 'CRITICO';
  else if (niveles.includes('ALTO'))   resultado.nivel_riesgo = 'ALTO';
  else if (niveles.includes('MEDIO'))  resultado.nivel_riesgo = 'MEDIO';
  else if (niveles.length > 0)         resultado.nivel_riesgo = 'BAJO';
  else                                  resultado.nivel_riesgo = 'LIMPIA';

  // ── 2. Si es CRITICO, rechazar sin consultar LLM ─────────────────────
  if (resultado.nivel_riesgo === 'CRITICO') {
    resultado.aprobada = false;
    resultado.veredicto = 'RECHAZADA';
    resultado.razon = `Código peligroso detectado: ${resultado.hallazgos_estaticos.filter(h => h.nivel === 'CRITICO').map(h => h.desc).join(', ')}`;
    return resultado;
  }

  // ── 3. Análisis LLM: contexto + intención + código ───────────────────
  try {
    const { callModel } = await import('./model_router.js');

    const frontmatter = parsearFrontmatter(skillMd);
    const nombreSkill = frontmatter.name || slug;
    const descripcionSkill = frontmatter.description || '(sin descripción)';

    // Construir el código de los archivos extra para el LLM
    const codigoExtra = archivosExtra.length
      ? archivosExtra.map(f => `\n### ${f.nombre}\n\`\`\`\n${f.contenido.slice(0, 1500)}\n\`\`\``).join('\n')
      : '(solo SKILL.md, sin archivos de código adicionales)';

    const hallazgosStr = resultado.hallazgos_estaticos.length
      ? resultado.hallazgos_estaticos.map(h => `- [${h.nivel}] ${h.archivo}: ${h.desc}`).join('\n')
      : 'Ninguno detectado por análisis estático.';

    const prompt = `Eres un experto en ciberseguridad analizando una skill para un agente IA autónomo que corre en Raspberry Pi con acceso a WhatsApp, shell y archivos del sistema.

## CONTEXTO DE LA SOLICITUD
- Objetivo del usuario: "${objetivo || '(no especificado)'}"
- Por qué se necesita esta skill: "${contexto || '(no especificado)'}"

## SKILL A ANALIZAR
- Nombre: ${nombreSkill}
- Descripción declarada: ${descripcionSkill}
- Slug/carpeta: ${slug}

## CONTENIDO SKILL.md
\`\`\`
${skillMd.slice(0, 3000)}
\`\`\`

## ARCHIVOS DE CÓDIGO
${codigoExtra}

## HALLAZGOS DEL ANÁLISIS ESTÁTICO
${hallazgosStr}

## TU TAREA
Analiza si esta skill:
1. Hace lo que dice que hace (coherencia intención vs código)
2. Tiene comportamiento oculto o malicioso
3. El código coincide con la descripción declarada
4. Existe riesgo real considerando el contexto de uso

Responde SOLO en este formato JSON exacto, sin markdown:
{
  "veredicto": "APROBADA" | "SOSPECHOSA" | "RECHAZADA",
  "nivel_riesgo": "LIMPIA" | "BAJO" | "MEDIO" | "ALTO" | "CRITICO",
  "coherencia_codigo": true | false,
  "razon": "explicación breve en español (máx 200 chars)",
  "recomendacion": "qué hacer (máx 100 chars)"
}`;

    const respuestaRaw = await callModel('analitico', prompt);
    
    // Parsear JSON del LLM
    try {
      const jsonMatch = respuestaRaw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const analisis = JSON.parse(jsonMatch[0]);
        resultado.analisis_llm = analisis;
        resultado.veredicto = analisis.veredicto || 'SOSPECHOSA';
        resultado.razon = analisis.razon || '';
        // LLM puede subir el nivel de riesgo pero no bajarlo
        const nivelesOrden = ['LIMPIA','BAJO','MEDIO','ALTO','CRITICO'];
        const nivelActual = nivelesOrden.indexOf(resultado.nivel_riesgo);
        const nivelLLM = nivelesOrden.indexOf(analisis.nivel_riesgo || 'LIMPIA');
        if (nivelLLM > nivelActual) resultado.nivel_riesgo = analisis.nivel_riesgo;
      } else {
        resultado.veredicto = 'SOSPECHOSA';
        resultado.razon = 'LLM no devolvió JSON válido — requiere revisión manual';
      }
    } catch(e) {
      resultado.veredicto = 'SOSPECHOSA';
      resultado.razon = 'Error parseando respuesta LLM — requiere revisión manual';
    }

  } catch(e) {
    // Si el LLM falla pero el escaneo estático fue limpio, aprobar con advertencia
    if (resultado.nivel_riesgo === 'LIMPIA') {
      resultado.veredicto = 'APROBADA';
      resultado.razon = 'Análisis estático limpio (LLM no disponible)';
    } else {
      resultado.veredicto = 'SOSPECHOSA';
      resultado.razon = `LLM no disponible y análisis estático encontró: ${resultado.nivel_riesgo}`;
    }
  }

  resultado.aprobada = resultado.veredicto === 'APROBADA';
  return resultado;
}

// Formatear reporte para WhatsApp
export function formatearReporteSeguridad(auditoria) {
  const iconos = { LIMPIA: '🟢', BAJO: '🟡', MEDIO: '🟠', ALTO: '🔴', CRITICO: '⛔', DESCONOCIDO: '⚪' };
  const icono = iconos[auditoria.nivel_riesgo] || '⚪';
  
  let msg = `🔐 *Auditoría de Seguridad — ${auditoria.slug}*\n`;
  msg += `${icono} Nivel de riesgo: *${auditoria.nivel_riesgo}*\n`;
  msg += `Veredicto: *${auditoria.veredicto}*\n`;
  
  if (auditoria.hallazgos_estaticos.length) {
    msg += `\n⚠️ *Hallazgos estáticos:*\n`;
    for (const h of auditoria.hallazgos_estaticos.slice(0, 5)) {
      msg += `  [${h.nivel}] ${h.archivo}: ${h.desc}\n`;
    }
    if (auditoria.hallazgos_estaticos.length > 5) {
      msg += `  ...y ${auditoria.hallazgos_estaticos.length - 5} más\n`;
    }
  }

  if (auditoria.analisis_llm) {
    msg += `\n🤖 *Análisis IA:*\n`;
    msg += `  Coherencia código: ${auditoria.analisis_llm.coherencia_codigo ? '✅' : '❌'}\n`;
    msg += `  ${auditoria.razon}\n`;
    if (auditoria.analisis_llm.recomendacion) {
      msg += `  💡 ${auditoria.analisis_llm.recomendacion}\n`;
    }
  } else if (auditoria.razon) {
    msg += `\n📋 ${auditoria.razon}\n`;
  }

  msg += `\n${auditoria.aprobada ? '✅ *Skill aprobada para instalación*' : '🚫 *Skill NO instalada*'}`;
  return msg;
}

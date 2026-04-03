// core/features/skills_commands.js
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { ROOT_DIR, CONFIG } from '../../config/bmo.config.js';
import { execAsync } from '../context.js';
const esAutorizado = (id) => CONFIG.admin_ids.includes(id.replace('@lid','').replace('@c.us','')) || id === CONFIG.admin_wa;

const HUB_RAW = 'https://raw.githubusercontent.com/openclaw/openclaw/main/skills';
const SKILLS_PATH = `${ROOT_DIR}/skills`
const DB_PATH = `${ROOT_DIR}/memory/bmo_memory.db`

export async function handleSkillsCommands(userMessage, id, client) {
  if (!esAutorizado(id)) return false;

  // BMO, skills
  if (/BMO,?\s+skills?/i.test(userMessage)) {
    try {
      const { listarSkills, autoDescubrirSkills } = await import('../../skills/skill_registry.js');
      autoDescubrirSkills();
      const skills = listarSkills();
      if (!skills.length) {
        await client.sendMessage(id, '📦 No tienes skills instaladas.\n\nInstala una con:\n*BMO, instala skill [nombre]*');
      } else {
        const lista = skills.map((s, i) => `${i+1}. *${s.nombre}*\n   ${s.descripcion}\n   Usos: ${s.usos}`).join('\n\n');
        await client.sendMessage(id, `📦 *Skills instaladas (${skills.length}):*\n\n${lista}\n\n💡 Instala más con:\n*BMO, instala skill [nombre]*`);
      }
    } catch(e) {
      await client.sendMessage(id, '❌ Error listando skills: ' + e.message.slice(0,80));
    }
    return true;
  }

  // BMO, instala skill [nombre]
  const matchInstala = userMessage.match(/BMO,?\s+instala\s+skill\s+([\w-]+)/i);
  if (matchInstala) {
    const slugBuscado = matchInstala[1].toLowerCase().trim();
    await client.sendMessage(id, `🔍 Buscando skill *${slugBuscado}* en el Hub...`);
    try {
      const { registrarSkill } = await import('../../skills/skill_registry.js');
      const { auditarSkill, formatearReporteSeguridad } = await import('../skill_security_agent.js');

      // 1. Descargar SKILL.md
      const mdUrl = `${HUB_RAW}/${slugBuscado}/SKILL.md`;
      let mdRaw = '';
      try {
        const { stdout } = await execAsync(`curl -sf --max-time 10 "${mdUrl}"`);
        mdRaw = stdout || '';
      } catch(_) { mdRaw = ''; }
      if (!mdRaw || mdRaw.length < 20) {
        await client.sendMessage(id, `❌ Skill *${slugBuscado}* no encontrada en el Hub.`);
        return true;
      }

      // 2. Descargar archivos de código adicionales del Hub (index.js, src/*.js, etc.)
      const archivosExtra = [];
      try {
        const apiUrl = `https://api.github.com/repos/openclaw/openclaw/contents/skills/${slugBuscado}`;
        const { stdout: listaRaw } = await execAsync(`curl -sf --max-time 8 -H 'User-Agent: BMO-bot' '${apiUrl}'`);
        const lista = JSON.parse(listaRaw || '[]');
        const archCodigo = lista.filter(f => f.type === 'file' && /\.(js|ts|py|sh)$/.test(f.name));
        for (const arch of archCodigo.slice(0, 5)) {
          try {
            const rawUrl = arch.download_url || `https://raw.githubusercontent.com/openclaw/openclaw/main/skills/${slugBuscado}/${arch.name}`;
            const { stdout: codigo } = await execAsync(`curl -sf --max-time 8 '${rawUrl}'`);
            if (codigo && codigo.length > 10) archivosExtra.push({ nombre: arch.name, contenido: codigo });
          } catch(_) {}
        }
      } catch(_) {}

      // 3. Avisar que se está auditando
      await client.sendMessage(id, `🔐 Auditando seguridad de *${slugBuscado}*...\n_Analizando código e intención..._`);

      // 4. Ejecutar auditoría
      const auditoria = await auditarSkill({
        slug: slugBuscado,
        skillMd: mdRaw,
        archivosExtra,
        objetivo: `instalar skill ${slugBuscado}`,
        contexto: `El usuario solicitó instalar esta skill desde el Hub de OpenClaw para su bot BMO.`,
      });

      // 5. Enviar reporte
      const reporte = formatearReporteSeguridad(auditoria);
      await client.sendMessage(id, reporte);

      // 6. Si aprobada, instalar
      if (auditoria.aprobada) {
        const nameMatch = mdRaw.match(/^name:\s*(.+)$/m);
        const descMatch = mdRaw.match(/^description:\s*(.+)$/m);
        const nombre = nameMatch?.[1]?.trim() || slugBuscado;
        const descripcion = descMatch?.[1]?.trim() || `Hub skill: ${slugBuscado}`;
        const rutaSkill = path.join(SKILLS_PATH, slugBuscado);
        fs.mkdirSync(rutaSkill, { recursive: true });
        fs.writeFileSync(path.join(rutaSkill, 'SKILL.md'), mdRaw);
        // Guardar archivos de código descargados
        for (const arch of archivosExtra) {
          fs.writeFileSync(path.join(rutaSkill, arch.nombre), arch.contenido);
        }
        registrarSkill(nombre, descripcion, rutaSkill);
      }
    } catch(e) {
      await client.sendMessage(id, '❌ Error instalando skill: ' + e.message.slice(0,100));
    }
    return true;
  }

  // BMO, quita skill [nombre]
  const matchQuita = userMessage.match(/BMO,?\s+quita\s+skill\s+([\w-]+)/i);
  if (matchQuita) {
    const nombreSkill = matchQuita[1].toLowerCase().trim();
    try {
      const rutaSkill = path.join(SKILLS_PATH, nombreSkill);
      if (fs.existsSync(rutaSkill)) fs.rmSync(rutaSkill, { recursive: true });
      const db = new Database(DB_PATH);
      db.prepare('DELETE FROM skills WHERE nombre=? OR nombre=?').run(nombreSkill, nombreSkill.replace(/-/g,' '));
      db.close();
      await client.sendMessage(id, `🗑️ Skill *${nombreSkill}* eliminada.`);
    } catch(e) {
      await client.sendMessage(id, '❌ Error: ' + e.message.slice(0,80));
    }
    return true;
  }

  return false;
}

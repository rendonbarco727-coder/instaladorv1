// core/features/reminder_commands.js
import fs from 'fs';
import { CONFIG, ROOT_DIR } from '../../config/bmo.config.js';
import path from 'path';

const guardarContexto = () => {};
const obtenerModulo = (_) => null;
const buscarWeb = async (_) => null;
const preguntarGemini = async (_id, prompt) => prompt.slice(0, 100);

const RECORDATORIOS_FILE = path.join(ROOT_DIR, "recordatorios.json");
export let recordatorios = [];
export let clientGlobal = null;

export function setClientGlobal(c) { clientGlobal = c; }

export function cargarRecordatorios() {
  if (fs.existsSync(RECORDATORIOS_FILE)) {
    try { recordatorios = JSON.parse(fs.readFileSync(RECORDATORIOS_FILE)); console.log("Recordatorios cargados: " + recordatorios.length); }
    catch { recordatorios = []; }
  }
}

export function guardarRecordatorios() {
  fs.writeFileSync(RECORDATORIOS_FILE, JSON.stringify(recordatorios, null, 2));
}

export function programarRecordatorio(r) {
  const diff = r.fecha - Date.now(); if (diff <= 0) return;
  setTimeout(async () => {
    if (clientGlobal) {
      if (r.accion === "trafico") {
        try {
          const mod = obtenerModulo("trafico_monterrey");
          if (mod) {
            await mod.ejecutar({ client: clientGlobal, id: r.id, sesion: { mensajeOriginal: "trafico de " + r.origen + " a " + r.destino, ultimoMensaje: "como esta el trafico de " + r.origen + " a " + r.destino } });
          }
        } catch(e) {
          await clientGlobal.sendMessage(r.id, "Error consultando trafico: " + e.message);
        }
      } else if (r.accion === "clima") {
        const ciudad = r.ciudad || "Monterrey";
        const climaData = await buscarWeb("clima manana " + ciudad);
        const climaMsg = await preguntarGemini(r.id, climaData || "clima " + ciudad, "Resume el clima de manana en 3 lineas. Solo texto.");
        await clientGlobal.sendMessage(r.id, "🌤 *Pronostico de manana - " + ciudad + "*\n\n" + (climaMsg || "No pude obtener el clima."));
      } else {
        await clientGlobal.sendMessage(r.id, "⏰ Recordatorio: " + r.mensaje);
      }
      if (r.recurrente) {
        let proximaFecha = r.fecha + 24 * 60 * 60 * 1000;
        if (r.diasSemana && r.diasSemana.length > 0) {
          const proxima = new Date(proximaFecha);
          let intentos = 0;
          while (!r.diasSemana.includes(proxima.getDay()) && intentos < 8) {
            proxima.setDate(proxima.getDate() + 1);
            intentos++;
          }
          proximaFecha = proxima.getTime();
        }
        r.fecha = proximaFecha;
        guardarRecordatorios();
        programarRecordatorio(r);
      } else {
        recordatorios = recordatorios.filter((x) => x.recordId !== r.recordId);
        guardarRecordatorios();
      }
    }
  }, diff);
}

export function iniciarRecordatorios() {
  cargarRecordatorios();
  const ahora = Date.now();
  for (const r of recordatorios) {
    if (r.fecha > ahora) programarRecordatorio(r);
    else recordatorios = recordatorios.filter((x) => x.recordId !== r.recordId);
  }
  guardarRecordatorios();
}

export function parsearFecha(texto) {
  const ahora = Date.now();
  const minMatch = texto.match(/en (\d+) minutos?/i); if (minMatch) return ahora + parseInt(minMatch[1]) * 60 * 1000;
  const hrMatch = texto.match(/en (\d+) horas?/i); if (hrMatch) return ahora + parseInt(hrMatch[1]) * 3600 * 1000;
  const diaMatch = texto.match(/en (\d+) d[ii]as?/i); if (diaMatch) return ahora + parseInt(diaMatch[1]) * 86400 * 1000;
  const fechaMatch = texto.match(/el (\d{4}-\d{2}-\d{2}) a las (\d{2}:\d{2})/i);
  if (fechaMatch) return new Date(fechaMatch[1] + "T" + fechaMatch[2] + ":00").getTime();
  const horaMatch = texto.match(/a las (\d{1,2})(?::(\d{2}))?\s*(am|pm|de la noche|de la manana)?/i);
  if (horaMatch) {
    let hora = parseInt(horaMatch[1]);
    const min = parseInt(horaMatch[2] || "0");
    const mod = (horaMatch[3] || "").toLowerCase();
    if (mod === "pm" || mod === "de la noche") { if (hora < 12) hora += 12; }
    if (mod === "am" || mod === "de la manana") { if (hora === 12) hora = 0; }
    const fecha = new Date();
    fecha.setHours(hora, min, 0, 0);
    if (fecha.getTime() <= Date.now()) fecha.setDate(fecha.getDate() + 1);
    return fecha.getTime();
  }
  return null;
}

export function parsearDiasSemana(texto) {
  const dias = { domingo:0, lunes:1, martes:2, miercoles:3, jueves:4, viernes:5, sabado:6 };
  const encontrados = [];
  for (const [nombre, num] of Object.entries(dias)) {
    if (texto.toLowerCase().includes(nombre)) encontrados.push(num);
  }
  if (/fines? de semana/i.test(texto)) { encontrados.push(0, 6); }
  if (/entre semana|dias? h[aa]biles?/i.test(texto)) { encontrados.push(1,2,3,4,5); }
  return [...new Set(encontrados)].sort();
}

export function manejarRecordatorio(id, texto) {
  const recurrente = /todos los d[ii]as|cada d[ii]a|diariamente|siempre a las/i.test(texto);
  const esClima = /clima|tiempo|temperatura|pron[oo]stico/i.test(texto);
  const ciudadMatch = texto.match(/clima.*?(?:de|en)\s+([A-Za-z\s]+?)(?:\s+a las|\s+manana|$)/i);
  const ciudad = ciudadMatch ? ciudadMatch[1].trim() : "Monterrey";
  const fecha = parsearFecha(texto);
  if (!fecha) return "No pude entender la hora. Ejemplo: siempre a las 8pm mandame el clima";
  let mensaje = texto
    .replace(/siempre|todos los dias|cada dia|diariamente/gi, "")
    .replace(/a las \d{1,2}(?::\d{2})?\s*(?:am|pm|de la noche|de la manana)?/gi, "")
    .replace(/recuerdame/gi, "")
    .trim() || "recordatorio";
  const duplicado = recordatorios.find(r => r.id === id && r.mensaje.trim() === mensaje.trim() && Math.abs(r.fecha - fecha) < 60000);
  if (duplicado) return "Ya tienes un recordatorio igual: " + duplicado.mensaje + " a las " + new Date(duplicado.fecha).toLocaleTimeString("es-MX");
  const r = { recordId: Date.now().toString(), id, mensaje, fecha, recurrente, accion: esClima ? "clima" : null, ciudad };
  recordatorios.push(r); guardarRecordatorios(); programarRecordatorio(r);
  guardarContexto(id, "ultimo_recordatorio", r);
  guardarContexto(id, "lista_recordatorios", [r]);
  const tipo = recurrente ? "Recordatorio diario" : "Recordatorio";
  return tipo + " guardado: " + mensaje + " para " + new Date(fecha).toLocaleString("es-MX") + (recurrente ? " (se repetira cada dia)" : "");
}

export function listarRecordatorios(id) {
  const esAdmin = CONFIG.admin_ids.some(aid => id.includes(aid));
  const lista = esAdmin ? recordatorios : recordatorios.filter(r => r.id === id);
  if (lista.length === 0) return "No tienes recordatorios activos.";
  return "⏰ *Tus recordatorios:*\n\n" + lista.map((r, i) =>
    (i+1) + ". *" + r.mensaje + "*\n   📅 " + new Date(r.fecha).toLocaleString("es-MX") + (r.recurrente ? " (diario)" : "") + "\n   🆔 ID: " + r.recordId
  ).join("\n\n");
}

export function eliminarRecordatorio(id, recordId) {
  const antes = recordatorios.length;
  recordatorios = recordatorios.filter(r => !(r.recordId === recordId && (r.id === id || CONFIG.admin_ids.some(aid => id.includes(aid)))));
  guardarRecordatorios();
  return recordatorios.length < antes ? "✅ Recordatorio eliminado." : "❌ No encontre ese recordatorio.";
}

export function modificarRecordatorio(id, recordId, cambios) {
  const r = recordatorios.find(r => r.recordId === recordId && (r.id === id || CONFIG.admin_ids.some(aid => id.includes(aid))));
  if (!r) return "No encontre ese recordatorio.";
  if (cambios.hora) {
    const nuevaFecha = parsearFecha("a las " + cambios.hora);
    if (nuevaFecha) r.fecha = nuevaFecha;
  }
  if (cambios.diasSemana !== undefined) r.diasSemana = cambios.diasSemana;
  if (cambios.recurrente !== undefined) r.recurrente = cambios.recurrente;
  if (cambios.mensaje) r.mensaje = cambios.mensaje;
  guardarRecordatorios();
  const diasNombres = ["Dom","Lun","Mar","Mie","Jue","Vie","Sab"];
  const diasStr = r.diasSemana?.length ? " solo los " + r.diasSemana.map(d => diasNombres[d]).join(", ") : "";
  return "✅ Recordatorio actualizado: " + r.mensaje + " a las " + new Date(r.fecha).toLocaleTimeString("es-MX") + diasStr;
}

export async function handleReminderCommands(userMessage, id, client) {
  if (/mis recordatorios|ver recordatorios|lista.*recordatorios|recordatorios.*activos|que recordatorios/i.test(userMessage)) {
    const listaActiva = recordatorios.filter(r => r.id === id);
    guardarContexto(id, "lista_recordatorios", listaActiva);
    guardarContexto(id, "lista_recordatorios_indexada", listaActiva.map((r,i) => ({...r, numero: i+1})));
    await client.sendMessage(id, listarRecordatorios(id));
    return true;
  }
  if (/elimina.*recordatorio|borra.*recordatorio|cancela.*recordatorio/i.test(userMessage)) {
    const idMatch = userMessage.match(/ID[:\s]+(\S+)/i);
    if (idMatch) {
      await client.sendMessage(id, eliminarRecordatorio(id, idMatch[1]));
    } else {
      const lista = listarRecordatorios(id);
      await client.sendMessage(id, lista + "\n\nDime el ID del recordatorio que quieres eliminar.");
    }
    return true;
  }
  if (/recuerdame|ponme un aviso|reminder/i.test(userMessage)) {
    await client.sendMessage(id, manejarRecordatorio(id, userMessage));
    return true;
  }
  return false;
}

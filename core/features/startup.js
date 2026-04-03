import fs from "fs";
import path from "path";
import { setClientGlobal, iniciarRecordatorios } from "./reminder_commands.js";
import { registrarClienteScheduler } from "../orchestrator.js";
import { iniciarGoalScheduler } from "../../goals/goal_scheduler.js";
import { iniciarAutonomousLoop } from "../../autonomy/autonomous_loop.js";
import { getPendientes } from "../../goals/goal_manager.js";
import { revisarMensajesPerdidos } from "./mensajes_perdidos.js";
import { programarResumenNocturno } from "./utilidades.js";
import { programarAuditoriaNocturna } from "./auditoria.js";
import { evaluacionEvolutiva } from "./evoluciones_manager.js";
import { cargarAutonomia, guardarAutonomia, cargarEvoluciones, cargarExperimentos } from "./evoluciones_manager.js";
import { procesarConIA } from "../message_router.js";
import { CONFIG, ROOT_DIR } from '../../config/bmo.config.js';

const OWNER_ID = CONFIG.admin_wa;
const ADMIN_ID = OWNER_ID;

// Stubs para módulos opcionales no migrados
const cargarHistorial = () => {};
const generarRetoDelDia = async () => {};
const vigilarLogs = async () => null;
const cargarModulosExistentes = async () => {};

export async function onReady(client) {
  try {
    const { initHeartbeat } = await import("../heartbeat.js");
    initHeartbeat(client, OWNER_ID);
    console.log("[INDEX] Heartbeat iniciado");
  } catch(e) { console.log("[INDEX] Heartbeat error:", e.message); }

  setClientGlobal(client);
  cargarHistorial();
  iniciarRecordatorios();
  console.log("WhatsApp conectado!");
  registrarClienteScheduler(client, OWNER_ID);
  iniciarGoalScheduler(client);
  iniciarAutonomousLoop(client);

  try {
    const { iniciarGateway } = await import("../gateway.js");
    iniciarGateway(client, OWNER_ID);
  } catch(e) { console.log("[GATEWAY] Error:", e.message); }

  setTimeout(() => generarRetoDelDia(client, ADMIN_ID).catch(() => generarRetoDelDia(client, OWNER_ID)), 60 * 60 * 1000);
  setInterval(() => generarRetoDelDia(client, ADMIN_ID).catch(() => generarRetoDelDia(client, OWNER_ID)), 24 * 60 * 60 * 1000);

  setInterval(async () => {
    try {
      const { execSync } = await import("child_process");
      const errores = execSync("pm2 logs bmo --lines 100 --nostream 2>/dev/null | grep -i error | tail -10").toString().split("\n").filter(Boolean);
      if (errores.length > 0) {
        console.log("[VIGILANTE] Errores detectados:", errores.length);
        const analisis = await vigilarLogs(errores);
        if (analisis && analisis.critico && client) {
          await client.sendMessage(ADMIN_ID, "⚠️ Vigilante detectó problema critico:\n" + analisis.descripcion + "\n\nSolucion sugerida: " + analisis.solucion);
        }
      }
    } catch(e) { console.log("[VIGILANTE] Error:", e.message); }
  }, 30 * 60 * 1000);

  const _goalsActuales = getPendientes();
  console.log(`[Planificador] ${_goalsActuales.length} objetivos activos en SQLite`);
  await cargarModulosExistentes();

  try {
    const { ejecutarTool } = await import("../../tools/tool_registry.js");
    const identityPath = path.join(ROOT_DIR, "data/bmo_identity.md");
    const listResult = await ejecutarTool("knowledge_manager", "list", { userId: "system" });
    if (!listResult.includes("bmo_identity.md")) {
      console.log("[IDENTITY] Ingestando identidad en vault...");
      await ejecutarTool("knowledge_manager", `ingest|${identityPath}`, { userId: "system" });
      console.log("[IDENTITY] Identidad ingestada");
    }
  } catch(e) { console.log("[IDENTITY] Error:", e.message); }

  const evolucionesDir = path.join(ROOT_DIR, "evoluciones");
  try {
    const archivosError = fs.readdirSync(evolucionesDir).filter(f => f.endsWith(".error"));
    for (const archivoError of archivosError) {
      const nombreModulo = archivoError.replace(".js.error", "");
      const rutaModulo = path.join(evolucionesDir, "")+ + nombreModulo + ".js";
      const errorMsg = fs.readFileSync(path.join(evolucionesDir, "")+ + archivoError, "utf8");
      console.log("Auto-corrigiendo modulo: " + nombreModulo);
      try {
        const codigoRoto = fs.readFileSync(rutaModulo, "utf8");
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${process.env.GEMINI_API_KEY}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Este modulo JavaScript tiene error: " + errorMsg + "\nCodigo:\n" + codigoRoto + "\nCorrigelo sin markdown ni backticks. Solo JavaScript valido." }] }], generationConfig: { maxOutputTokens: 1000 } }) }
        );
        const resData = await res.json();
        const codigoCorregido = resData.candidates[0].content.parts[0].text.replace(/```javascript|```js|```/g, "").trim();
        fs.writeFileSync(rutaModulo, codigoCorregido);
        fs.unlinkSync(path.join(evolucionesDir, "")+ + archivoError);
        console.log("Modulo corregido: " + nombreModulo);
      } catch(e2) { console.log("Auto-correccion fallo: " + e2.message.slice(0, 80)); }
    }
  } catch(e) { console.log("Error revisando errores: " + e.message); }

  setTimeout(() => revisarMensajesPerdidos(client, procesarConIA), 3000);
  programarResumenNocturno(client);
  programarAuditoriaNocturna(client, { cargarAutonomia, guardarAutonomia, cargarEvoluciones, cargarExperimentos });

  const ahora_ev = new Date();
  const diasEv = [1, 3, 5];
  if (diasEv.includes(ahora_ev.getDay())) {
    const objetivoEv = new Date();
    objetivoEv.setHours(21, 0, 0, 0);
    if (ahora_ev < objetivoEv) {
      const diffEv = objetivoEv.getTime() - ahora_ev.getTime();
      setTimeout(() => evaluacionEvolutiva(client), diffEv);
      console.log("Evaluacion evolutiva programada en " + Math.round(diffEv/60000) + " minutos");
    }
  }

  const tareaPendienteFile = path.join(ROOT_DIR, "tarea_pendiente.json");
  if (fs.existsSync(tareaPendienteFile)) {
    try {
      const tp = JSON.parse(fs.readFileSync(tareaPendienteFile, "utf8"));
      fs.unlinkSync(tareaPendienteFile);
      setTimeout(async () => {
        await client.sendMessage(tp.id, tp.mensaje);
        if (tp.tarea) await procesarConIA(tp.id, tp.tarea, client);
      }, 5000);
    } catch(e) { console.error("Error tarea pendiente:", e.message); }
  }
}

export async function onDisconnected(client, reason) {
    console.log("[WA] Desconectado:", reason);
    if (reason === 'LOGOUT') {
        console.error("[WA] Sesión cerrada — requiere nuevo QR");
        return;
    }
    const delays = [5000, 10000, 20000, 40000, 60000];
    for (let i = 0; i < delays.length; i++) {
        console.log(`[WA] Reconectando intento ${i+1}/${delays.length} en ${delays[i]/1000}s...`);
        await new Promise(r => setTimeout(r, delays[i]));
        try {
            await client.initialize();
            console.log("[WA] Reconectado OK");
            return;
        } catch(e) {
            console.error(`[WA] Intento ${i+1} falló:`, e.message);
        }
    }
    console.error("[WA] No se pudo reconectar después de 5 intentos");
}

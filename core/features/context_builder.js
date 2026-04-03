import { state } from '../state.js';
import { esAutorizado } from '../context.js';
import { obtenerEstado } from '../self_eval.js';
import { generarContextoVoluntad } from '../mood.js';
import { parsearIntent } from '../intent_parser.js';
import { obtenerContexto } from '../reference_resolver.js';
import { ultimoArchivo as ultimoArchivoDescarga } from './download_commands.js';
import { listarModulos } from '../motor_evoluciones.js';
import { manejarRecordatorio } from './reminder_commands.js';

export async function buildContext(id, userMessage, client, recordatorios, contextoErrores) {
  const esAdmin = esAutorizado(id);

  const listaActual = state.contextoListas.get(id);
  const extraLista = listaActual && listaActual.length > 0
    ? "\nArchivos disponibles (usar nombres EXACTOS):\n" + listaActual.map((f,i) => (i+1)+". "+f).join("\n")
    : "";

  const ult = ultimoArchivoDescarga.get(id);
  const extraUltimo = ult ? "\nUltimo archivo descargado/procesado por el usuario: " + ult.path + " (tipo: " + ult.tipo + ")" : "";

  const ultImg = state.ultimaImagen.get(id);
  const extraImagen = ultImg ? "\nUltima imagen generada con prompt: " + ultImg + ". Si el usuario pide modificarla o mejorarla, genera un nuevo JSON de imagen con el prompt actualizado." : "";

  const estadoEval = obtenerEstado();
  const contextoVoluntad = generarContextoVoluntad();
  const extraAutoeval = estadoEval.fallos > 0 || estadoEval.dudas > 0
    ? `\nAutoeval: ${estadoEval.fallos} fallos, ${estadoEval.dudas} dudas. Temas problematicos: ${estadoEval.temas_fallidos.slice(0,3).join(", ") || "ninguno"}. Ajusta tu respuesta para evitar repetir estos errores.`
    : "";

  const intent = parsearIntent(userMessage);

  if (intent.tipo === "trafico" && intent.esRecordatorio && intent.origen && intent.destino) {
    const msgRec = "trafico de " + intent.origen + " a " + intent.destino + " a las " + intent.hora;
    await client.sendMessage(id, manejarRecordatorio(id, msgRec + (intent.frecuencia === "diaria" ? " todos los dias" : "")));
    return null;
  }

  const ctxIntent = intent.tipo
    ? " | Intent detectado: tipo=" + intent.tipo
      + (intent.origen ? " origen=" + intent.origen : "")
      + (intent.destino ? " destino=" + intent.destino : "")
      + (intent.hora ? " hora=" + intent.hora : "")
      + (intent.frecuencia ? " frecuencia=" + intent.frecuencia : "")
      + (intent.ciudad ? " ciudad=" + intent.ciudad : "")
    : "";

  const recsActivos = recordatorios.filter(r => r.id === id);
  const listaIndexada = obtenerContexto(id, "lista_recordatorios_indexada") || [];
  const ctxIndex = listaIndexada.length > 0
    ? " | Lista numerada: " + listaIndexada.map(r => "numero:" + r.numero + " ID:" + r.recordId + " '" + r.mensaje + "'").join(" | ")
    : "";
  const ctxRecs = recsActivos.length > 0
    ? " | Recordatorios activos: " + recsActivos.map(r =>
        "ID:" + r.recordId + " '" + r.mensaje + "' a las " + new Date(r.fecha).toLocaleTimeString("es-MX")
        + (r.recurrente ? " diario" : "")
        + (r.diasSemana ? " dias:" + r.diasSemana.join(",") : "")
      ).join(" | ")
    : "";

  const modulosDisponibles = listarModulos();
  const extraModulos = modulosDisponibles.length > 0
    ? "\nMODULOS DISPONIBLES: " + modulosDisponibles.join(", ") + ". Si el mensaje aplica a uno, responde {accion:modulo, nombre:nombre_modulo}"
    : "";

  // Memoria semántica relevante al mensaje actual
  let extraMemoria = "";
  try {
    const { buscarMemoriasRelevantes } = await import('../../cognicion/memoria_bmo.js');
    const memorias = await buscarMemoriasRelevantes(id, userMessage, 3);
    if (memorias.length > 0) {
      extraMemoria = "\nMEMORIA RELEVANTE:\n" + memorias.map(m => `[${m.tipo}] ${m.contenido}`).join("\n");
    }
  } catch(e) {}

  // Knowledge relevante — solo para mensajes con sustancia (no saludos/conversación simple)
  let extraKnowledge = "";
  const esConversacional = /^(hola|hey|ok|bien|gracias|si|no|perfecto|listo|ya|sí|buenas|claro|dale|ándale|entendido)$/i.test(userMessage.trim());
  const esMuyCorto = userMessage.trim().length < 20;
  if (!esConversacional && !esMuyCorto) {
    try {
      const { ejecutarTool } = await import('../../tools/tool_registry.js');
      const kResult = await ejecutarTool('knowledge_manager', `query|${userMessage.slice(0,100)}`, { userId: id });
      if (kResult && !kResult.includes('vacío') && !kResult.includes('Error')) {
        extraKnowledge = "\nKNOWLEDGE BASE:\n" + String(kResult).slice(0, 400);
      }
    } catch(e) {}
  }

  // Top acciones que BMO ejecuta bien (RL)
  let extraRL = "";
  try {
    const { ReinforcementLearning } = await import('../../memory/reinforcement_learning.js');
    const rl = new ReinforcementLearning();
    const top = rl.getStats(3).filter(s => s.wins > 2);
    if (top.length > 0) {
      extraRL = "\nACCIONES CONFIABLES: " + top.map(s => `${s.action}(${Math.round(s.wins/(s.wins+s.losses)*100)}%)`).join(", ");
    }
  } catch(e) {}

  const contextoCompleto = contextoErrores + extraLista + extraUltimo + extraImagen + extraAutoeval + contextoVoluntad + ctxRecs + ctxIndex + ctxIntent + extraModulos + extraMemoria + extraKnowledge + extraRL;

  return { contextoCompleto, esAdmin };
}

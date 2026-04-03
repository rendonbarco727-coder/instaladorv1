import { esAutorizado } from '../context.js';
import { ejecutarAgente as ejecutarAgenteNuevo } from '../orchestrator.js';
import { manejarComandoAgente } from '../../evoluciones/agente_autonomo.js';
import { crearGoal } from '../../goals/goal_manager.js';
import { ejecutarRetoPendiente, obtenerEstadoBanco } from '../banco_habilidades.js';
import { listarEvoluciones } from '../../cognicion/auto_evolucion.js';

export const _activeDocuments = new Map();

export async function dispatchIntent(id, userMessage, client, activeDocuments) {

  // --- Comandos directos BMO: interceptar ANTES del intent router ---
  try {
    const { dispatchPreLoop } = await import('./command_dispatcher.js');
    const dispatched = await dispatchPreLoop(id, userMessage, client);
    if (dispatched?.handled) return true;
  } catch(e) { console.log('[DISPATCH] Error en intent_dispatch:', e.message); }

  if (esAutorizado(id)) {
    const { detectIntent } = await import('../intent_router.js');
    const intent = await detectIntent(userMessage);
    console.log(`[INDEX] intent=${intent.type}${intent.tool ? '/' + intent.tool : ''}`);

    if (intent.type === 'tool' && intent.tool) {
      const { ejecutarTool } = await import('../../tools/tool_registry.js');
      const toolInput = intent.input || userMessage.replace(/^bmo,?\s*/i,'').trim();
      try {
        const resultado = await ejecutarTool(intent.tool, toolInput, { userId: id, clienteWA: client });
        if (resultado && typeof resultado === 'string' && resultado.startsWith('/tmp/')) {
          activeDocuments.set(id, resultado);
          console.log(`[INDEX] active_document guardado: ${resultado}`);
        } else if (resultado) {
          await client.sendMessage(id, resultado);
        }
      } catch(e) {
        const respAgente = await ejecutarAgenteNuevo(userMessage, id, client);
        if (respAgente) await client.sendMessage(id, respAgente);
      }
      return true;
    }

    if (intent.type === 'simple' && intent.response) {
      await client.sendMessage(id, intent.response());
      return true;
    }

    if (intent.type === 'agent' || intent.type === 'scheduler') {
      if (/monitorea|rastrea|vigila|sigue/i.test(userMessage)) {
        const goalId = crearGoal(id, userMessage);
        await client.sendMessage(id, `📋 Objetivo #${goalId} creado y programado.`);
      }
      const respAgente = await ejecutarAgenteNuevo(userMessage, id, client);
      try {
        const { execSync } = await import('child_process');
        const reciente = execSync("find /tmp -name 'bmo_doc_*.docx' -mmin -5 2>/dev/null | sort -r | head -1").toString().trim();
        if (reciente) {
          activeDocuments.set(id, reciente);
          console.log(`[INDEX] active_document detectado: ${reciente}`);
        }
      } catch(e) {}
      if (respAgente && typeof respAgente === 'string' && !respAgente.startsWith('/tmp/')) {
        await client.sendMessage(id, respAgente);
      }
      return true;
    }
  }

  const esComandoAgente = userMessage.toLowerCase().startsWith('agente');
  const esComandoGUI = /toma.*captura|captura.*pantalla|screenshot|screenshoot|abre\s+(la\s+|el\s+)?(calculadora|calculator|editor|terminal|navegador|chrome|firefox|libreoffice)|crea?\s+(un?|una?)\s*(documento|doc|word|hoja|excel|calculo|presentaci[oó]n|ppt|reporte|informe|tabla|archivo)/i.test(userMessage);
  if (esComandoAgente || (esAutorizado(id) && esComandoGUI)) {
    const respAgente = await manejarComandoAgente(userMessage, id, client);
    if (respAgente !== null) {
      await client.sendMessage(id, respAgente);
    }
    return true;
  }

  if (userMessage.toLowerCase().trim() === 'ejecutar reto' && esAutorizado(id)) {
    const { ejecutarRetoPendiente } = await import('../banco_habilidades.js');
    const { procesarConIA } = await import('../message_router.js');
    const reto = await ejecutarRetoPendiente(client, id);
    if (reto) await procesarConIA(id, "bmo " + reto, client);
    return true;
  }

  if (userMessage.toLowerCase().trim() === 'mis evoluciones' && esAutorizado(id)) {
    await client.sendMessage(id, listarEvoluciones());
    return true;
  }

  if (userMessage.toLowerCase().trim() === 'banco bmo' && esAutorizado(id)) {
    const estado = obtenerEstadoBanco();
    await client.sendMessage(id,
      `*Banco de habilidades BMO:*\n\nHabilidades aprendidas: ${estado.habilidades}\nLecciones de errores: ${estado.lecciones}\nRetos completados: ${estado.retosCompletados}\nReto pendiente: ${estado.retoPendiente || "ninguno"}`
    );
    return true;
  }

  if (userMessage.toLowerCase().trim() === 'aplicar fix' && esAutorizado(id)) {
    await client.sendMessage(id, '⏳ Descargando y aplicando instrucción del bridge...');
    try {
      const { descargarInstruccion, aplicarInstruccion } = await import('../bmo_bridge.js');
      const instr = await descargarInstruccion();
      if (!instr || instr.tipo === 'ninguna') {
        await client.sendMessage(id, 'ℹ️ No hay instrucciones pendientes en el Gist.');
      } else {
        const ok = await aplicarInstruccion(instr, client, id);
        await client.sendMessage(id, ok ? '✅ Fix aplicado correctamente.' : '❌ Fix rechazado (código inseguro o sintaxis inválida).');
      }
    } catch(e) {
      await client.sendMessage(id, 'Error: ' + e.message.slice(0, 100));
    }
    return true;
  }

  return false;
}

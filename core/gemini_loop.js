import { state } from './state.js';
import { esAutorizado } from './context.js';
import { setSesionConfig } from '../config/api_manager.js';
import { handleWizardCommands } from './features/wizard_commands.js';
import { ejecutarAgente as ejecutarAgenteNuevo } from './orchestrator.js';
import { dispatchIntent, _activeDocuments } from './features/intent_dispatch.js';
import { buildContext } from './features/context_builder.js';
import { handleResponse, corregirConMistral } from './features/response_handler.js';

export async function runGeminiLoop(id, userMessage, client, esAdmin, recordatorios) {
  const MAX_INTENTOS = 3;
  let intentos = 0;
  let contextoErrores = "";

  // UNICODE SANITIZE
  userMessage = userMessage.replace(/[‪-‮⁦-⁩-‏﻿]/g, '').trim();
  if (!userMessage) return;

  // SECURITY FILTER
  const dangerousPattern = /`[^`]*`|\$\([^)]*\)|\/etc\/passwd|\/etc\/shadow|\/etc\/sudoers|rm\s+-rf|mkfs|dd\s+if=|chmod\s+777\s*\/|:()\{:|curl.*\|.*bash|wget.*\|.*sh/i;
  if (dangerousPattern.test(userMessage) && !esAutorizado(id)) {
    await client.sendMessage(id, 'Lo siento, ese tipo de consulta no está permitida.');
    return;
  }

  // GIT CONFIG WIZARD
  if (esAutorizado(id) && userMessage.includes('ERROR_GIT_NO_CONFIGURADO')) {
    await client.sendMessage(id,
      'Git no esta configurado. Vamos a configurarlo:\n\n' +
      '1. Primero necesitas un token de GitHub\n' +
      '   Ve a: https://github.com/settings/tokens\n' +
      '   Crea un *Personal Access Token (classic)*\n' +
      '   Permisos necesarios: repo, workflow\n\n' +
      '2. Responde con tu token cuando lo tengas\n' +
      '   O escribe *cancelar*'
    );
    setSesionConfig(id, { paso: 'git_token' });
    return;
  }

  // WIZARDS
  if (esAutorizado(id) && await handleWizardCommands(userMessage, id, client)) return;

  // DOCUMENT CONTINUITY
  if (esAutorizado(id)) {
    const esContinuacion = /agr[eé]g|a[nñ]ade|edita|mejor|corrige|reorgani|ponle|quita|elimina.*secci|agrega.*tabla|agrega.*gr[aá]f|a[nñ]ade.*mes|pon.*mes|incluye/i.test(userMessage);
    const esConversacional = /^(hola|buenos|buenas|cómo|como|qué tal|que tal|holi|hey|hi|gracias|ok|bien|perfecto|listo|ya|sí|si|n)/i.test(userMessage.trim());
    if (esConversacional && _activeDocuments.get(id)) {
      console.log('[INDEX] Mensaje conversacional — limpiando active_document');
      _activeDocuments.delete(id);
    }
    const docActivo = _activeDocuments.get(id);
    if (esContinuacion && docActivo) {
      console.log(`[INDEX] Continuación de documento: ${docActivo}`);
      const objetivo = `editar_documento|${docActivo}|${userMessage}`;
      const respAgente = await ejecutarAgenteNuevo(objetivo, id, client);
      if (respAgente && typeof respAgente === 'string' && respAgente.startsWith('/tmp/')) {
        _activeDocuments.set(id, respAgente);
      } else if (respAgente) {
        await client.sendMessage(id, respAgente);
      }
      return;
    }
  }

  // LOOP PRINCIPAL
  while (intentos < MAX_INTENTOS) {
    intentos++;

    // 1. Intent dispatch (tool, agente, GUI, comandos especiales)
    const despachado = await dispatchIntent(id, userMessage, client, _activeDocuments);
    if (despachado) return;

    // 2. Construir contexto
    const ctx = await buildContext(id, userMessage, client, recordatorios, contextoErrores);
    if (!ctx) return; // manejado internamente (ej. recordatorio tráfico)

    // 3. Llamar Gemini + manejar respuesta
    const resultado = await handleResponse(
      id, userMessage, client, ctx.esAdmin,
      ctx.contextoCompleto, contextoErrores,
      intentos, MAX_INTENTOS, recordatorios, _activeDocuments
    );

    if (resultado.manejado) return;

    // Si no manejado, actualizar contextoErrores y reintentar
    contextoErrores = resultado.contextoErrores;
  }

  // Corrector Mistral al agotar intentos
  const corregido = await corregirConMistral(id, userMessage, client);
  if (!corregido) {
    await client.sendMessage(id, "Intente resolver tu solicitud " + MAX_INTENTOS + " veces pero no lo logre. Intenta reformular tu pregunta.");
  }
}

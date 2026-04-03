// core/features/wizard_commands.js
import { CONFIG } from '../../config/bmo.config.js';
const esAutorizado = (id) => CONFIG.admin_ids.includes(id.replace('@lid','').replace('@c.us','')) || id === CONFIG.admin_wa;
import { API_CATALOG, setEnvVar, verificarTodasAPIs, getSesionConfig, setSesionConfig, clearSesionConfig } from '../../config/api_manager.js';
import { INTEGRATIONS, verificarIntegraciones, detectarIntegracionNecesaria, getSesionInt, setSesionInt, clearSesionInt } from '../../config/integrations_catalog.js';

export async function handleWizardCommands(userMessage, id, client) {
  if (!esAutorizado(id)) return false;

  // GIT CONFIG WIZARD
  if (userMessage.includes('ERROR_GIT_NO_CONFIGURADO')) {
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
    return true;
  }

  // INTEGRATIONS WIZARD
  const sesionInt = getSesionInt(id);

  if (/^(bmo\s+)?(integraciones|mis integraciones|servicios|conectar|setup)/i.test(userMessage.trim())) {
    const estado = verificarIntegraciones();
    let msg = '*Integraciones disponibles:*\n\n';
    const keys = Object.keys(estado);
    keys.forEach((k, i) => {
      const e = estado[k];
      const emoji = e.ok ? 'OK' : 'NO CONFIGURADO';
      const info = e.ok ? ` (${e.info})` : '';
      msg += `${i+1}. ${e.nombre}: ${emoji}${info}\n   _${e.descripcion}_\n`;
    });
    msg += '\nResponde el numero para configurar, o *cancelar*';
    setSesionInt(id, { paso: 'seleccion', keys, estado });
    await client.sendMessage(id, msg);
    return true;
  }

  if (sesionInt) {
    if (/^cancelar$/i.test(userMessage.trim())) {
      clearSesionInt(id);
      await client.sendMessage(id, 'Configuracion cancelada.');
      return true;
    }
    if (sesionInt.paso === 'seleccion') {
      const num = parseInt(userMessage.trim());
      if (num >= 1 && num <= sesionInt.keys.length) {
        const key = sesionInt.keys[num-1];
        const int = INTEGRATIONS[key];
        const primerPaso = int.configurar[0];
        setSesionInt(id, { paso: 'configurando', key, int, pasoIdx: 0, datos: {} });
        await client.sendMessage(id, `*Configurar ${int.nombre}*\n\n${primerPaso.pregunta}`);
      } else {
        await client.sendMessage(id, 'Numero invalido. Intenta de nuevo o escribe cancelar');
      }
      return true;
    }
    if (sesionInt.paso === 'configurando') {
      const int = sesionInt.int;
      const paso = int.configurar[sesionInt.pasoIdx];
      const valor = userMessage.trim();
      if (paso.validar && !paso.validar(valor)) {
        await client.sendMessage(id, 'Valor invalido. Verifica e intenta de nuevo:\n' + paso.pregunta);
        return true;
      }
      setEnvVar(paso.env, valor);
      const nuevosDatos = { ...sesionInt.datos, [paso.env]: valor };
      const siguienteIdx = sesionInt.pasoIdx + 1;
      if (siguienteIdx < int.configurar.length) {
        setSesionInt(id, { ...sesionInt, pasoIdx: siguienteIdx, datos: nuevosDatos });
        await client.sendMessage(id, int.configurar[siguienteIdx].pregunta);
      } else {
        clearSesionInt(id);
        await client.sendMessage(id, 'Verificando configuracion...');
        try {
          const resultado = int.verificar();
          if (resultado.ok) {
            await client.sendMessage(id, `*${int.nombre}* configurado correctamente.\nAhora puedes pedirme: _${int.comandos[0]}_`);
          } else {
            await client.sendMessage(id, `Algo fallo: ${resultado.razon}\nEscribe *bmo integraciones* para intentar de nuevo.`);
          }
        } catch(e) {
          await client.sendMessage(id, `Guardado. Reinicia BMO para aplicar: _pm2 restart bmo_`);
        }
      }
      return true;
    }
  }

  const intNecesaria = detectarIntegracionNecesaria(userMessage);
  if (intNecesaria && !sesionInt) {
    const { int } = intNecesaria;
    await client.sendMessage(id,
      `Para hacer eso necesito acceso a *${int.nombre}*.\n\n` +
      `No esta configurado todavia.\n` +
      `Escribe *bmo integraciones* para configurarlo ahora.`
    );
    return true;
  }

  // CONFIG WIZARD — APIs
  const sesionCfg = getSesionConfig(id);
  const esConfigCmd = /^(bmo\s+)?(config|configurar\s+api|gestionar\s+api|mis\s+api|estado\s+api)/i.test(userMessage.trim());

  if (esConfigCmd) {
    await client.sendMessage(id, 'Verificando APIs...');
    const estado = await verificarTodasAPIs();
    const keys = Object.keys(estado);
    let msg = '*Estado de tus APIs:*\n\n';
    keys.forEach((k, i) => {
      const e = estado[k];
      const emoji = e.estado === 'activa' ? 'OK' : e.estado === 'no_configurada' ? 'NO CONFIGURADA' : 'EXPIRADA';
      msg += `${i+1}. ${e.nombre}: ${emoji}\n`;
    });
    msg += '\nResponde el numero para configurar/agregar key, o *cancelar*';
    msg += '\n_(Si ya tienes una key activa, agregar otra la suma al pool de rotacion)_';
    setSesionConfig(id, { paso: 'seleccion', estado, keys });
    await client.sendMessage(id, msg);
    return true;
  }

  if (sesionCfg) {
    if (/^cancelar$/i.test(userMessage.trim())) {
      clearSesionConfig(id);
      await client.sendMessage(id, 'Configuracion cancelada.');
      return true;
    }
    if (sesionCfg.paso === 'seleccion') {
      const num = parseInt(userMessage.trim());
      if (num >= 1 && num <= sesionCfg.keys.length) {
        const envKey = sesionCfg.keys[num-1];
        const info = API_CATALOG[envKey];
        let msg = `Configurar *${info.nombre}*\n\n`;
        if (info.opciones.length > 1) {
          info.opciones.forEach(o => { msg += `${o.id}. ${o.desc}\n`; });
          msg += '\nElige el numero del modelo:';
          setSesionConfig(id, { paso: 'modelo', envKey, info });
        } else {
          msg += `Obtener key en: ${info.url}\n\nPega tu API key:`;
          setSesionConfig(id, { paso: 'key', envKey, info });
        }
        await client.sendMessage(id, msg);
      } else {
        await client.sendMessage(id, 'Numero invalido. Intenta de nuevo o escribe cancelar');
      }
      return true;
    }
    if (sesionCfg.paso === 'modelo') {
      const num = parseInt(userMessage.trim());
      const modelo = sesionCfg.info.opciones.find(o => o.id === num);
      if (modelo) {
        setSesionConfig(id, { ...sesionCfg, paso: 'key', modelo });
        await client.sendMessage(id, `Modelo: *${modelo.desc}*\n\nObtener key en: ${sesionCfg.info.url}\n\nPega tu API key:`);
      } else {
        await client.sendMessage(id, 'Numero invalido. Elige un modelo valido.');
      }
      return true;
    }
    if (sesionCfg.paso === 'key') {
      const key = userMessage.trim();
      const valida = sesionCfg.info.validar(key);
      if (valida) {
        const envActual = process.env[sesionCfg.envKey] || '';
        if (envActual && envActual !== key) {
          setSesionConfig(id, { ...sesionCfg, paso: 'pool_o_reemplazar', keyNueva: key });
          await client.sendMessage(id, `Key valida. Ya tienes una key para *${sesionCfg.info.nombre}*.\n\n1. Reemplazar la actual\n2. Agregar al pool de rotacion (usa ambas)\n\nElige 1 o 2:`);
        } else {
          setEnvVar(sesionCfg.envKey, key);
          clearSesionConfig(id);
          await client.sendMessage(id, `*${sesionCfg.info.nombre}* configurado. Reiniciando...`);
          const { exec } = await import('child_process');
          setTimeout(() => exec('pm2 restart bmo --update-env'), 3000);
        }
      } else {
        await client.sendMessage(id, `Key invalida para *${sesionCfg.info.nombre}*. Verifica en: ${sesionCfg.info.url}\n\nIntenta de nuevo o escribe cancelar:`);
      }
      return true;
    }
  }

  return false;
}

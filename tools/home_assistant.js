import fetch from 'node-fetch';

const HASS_URL = process.env.HASS_URL || 'http://100.81.246.50:8123';
const HASS_TOKEN = process.env.HASS_TOKEN;

const hdrs = () => ({
  'Authorization': `Bearer ${HASS_TOKEN}`,
  'Content-Type': 'application/json'
});

async function getEstados() {
  const r = await fetch(`${HASS_URL}/api/states`, { headers: hdrs() });
  return r.json();
}

async function llamarServicio(dominio, servicio, datos) {
  const r = await fetch(`${HASS_URL}/api/services/${dominio}/${servicio}`, {
    method: 'POST', headers: hdrs(), body: JSON.stringify(datos)
  });
  return r.ok;
}

function buscarEntidad(estados, query) {
  const q = query.toLowerCase();
  return estados.filter(e => {
    const n = (e.attributes.friendly_name || e.entity_id).toLowerCase();
    return n.includes(q) || e.entity_id.includes(q);
  });
}

export async function ejecutar({ client, id, sesion }) {
  const texto = (sesion?.mensajeOriginal || sesion?.ultimoMensaje || '').toLowerCase();

  try {
    const estados = await getEstados();

    // Listar dispositivos
    if (texto.includes('listar') || texto.includes('dispositivos')) {
      const luces = estados.filter(e => e.entity_id.startsWith('light.'));
      const switches = estados.filter(e => e.entity_id.startsWith('switch.'));
      let resp = '🏠 *Dispositivos en tu casa:*\n\n';
      if (luces.length) {
        resp += `💡 *Luces (${luces.length}):*\n`;
        luces.forEach(l => resp += `• ${l.state === 'on' ? '🔆' : '⚫'} ${l.attributes.friendly_name || l.entity_id}\n`);
      }
      if (switches.length) {
        resp += `\n🔌 *Enchufes (${switches.length}):*\n`;
        switches.forEach(s => resp += `• ${s.state === 'on' ? '✅' : '⭕'} ${s.attributes.friendly_name || s.entity_id}\n`);
      }
      if (!luces.length && !switches.length) resp += 'No hay dispositivos aún. Agrégalos en Home Assistant.';
      await client.sendMessage(id, resp);
      return;
    }

    // Resumen de casa
    if (texto.includes('resumen') || (texto.includes('casa') && !texto.includes('enciende') && !texto.includes('apaga'))) {
      const lucesOn = estados.filter(e => e.entity_id.startsWith('light.') && e.state === 'on').length;
      const lucesTotal = estados.filter(e => e.entity_id.startsWith('light.')).length;
      const switchesOn = estados.filter(e => e.entity_id.startsWith('switch.') && e.state === 'on').length;
      const temps = estados.filter(e => e.attributes.unit_of_measurement === '°C');
      let resp = `🏠 *Estado de tu casa:*\n\n💡 Luces: ${lucesOn}/${lucesTotal}\n🔌 Enchufes activos: ${switchesOn}\n`;
      if (temps.length) {
        resp += '\n🌡️ *Temperaturas:*\n';
        temps.forEach(t => resp += `• ${t.attributes.friendly_name || t.entity_id}: ${t.state}°C\n`);
      }
      await client.sendMessage(id, resp);
      return;
    }

    // Temperatura — no interceptar si es tarea de código/script
    if ((texto.includes('temperatura') || texto.includes('clima')) && 
        !/\b(script|python|código|programa|bash|node|javascript|\.py|\.sh|procesador|cpu del pi)\b/i.test(texto)) {
      const temps = estados.filter(e => e.attributes.unit_of_measurement === '°C' || e.entity_id.startsWith('weather.'));
      if (!temps.length) { await client.sendMessage(id, '🌡️ No hay sensores de temperatura.'); return; }
      let resp = '🌡️ *Temperatura:*\n\n';
      temps.forEach(t => resp += `• ${t.attributes.friendly_name || t.entity_id}: ${t.state}${t.attributes.unit_of_measurement || ''}\n`);
      await client.sendMessage(id, resp);
      return;
    }

    // Encender / Apagar
    let servicio = null;
    let accion = '';
    if (texto.includes('enciende') || texto.includes('prende') || texto.includes('encender')) { servicio = 'turn_on'; accion = 'encendido 🔆'; }
    else if (texto.includes('apaga') || texto.includes('apagar')) { servicio = 'turn_off'; accion = 'apagado ⚫'; }

    if (servicio) {
      if (texto.includes('todas') && (texto.includes('luc') || texto.includes('luces'))) {
        const luces = estados.filter(e => e.entity_id.startsWith('light.'));
        for (const l of luces) await llamarServicio('light', servicio, { entity_id: l.entity_id });
        await client.sendMessage(id, `💡 Todas las luces ${accion}`);
        return;
      }
      const palabras = texto.replace(/(enciende|apaga|prende|desactiva|activa|la|el|las|los|por favor|bmo)/g, '').trim();
      const encontradas = buscarEntidad(estados, palabras);
      if (!encontradas.length) {
        await client.sendMessage(id, `❌ No encontré "${palabras}". Usa "listar dispositivos" para ver los disponibles.`);
        return;
      }
      for (const e of encontradas.slice(0, 3)) {
        await llamarServicio(e.entity_id.split('.')[0], servicio, { entity_id: e.entity_id });
      }
      const nombres = encontradas.slice(0, 3).map(e => e.attributes.friendly_name || e.entity_id).join(', ');
      await client.sendMessage(id, `✅ *${nombres}* ${accion}`);
      return;
    }

    await client.sendMessage(id, '🏠 No entendí el comando. Prueba: "listar dispositivos", "enciende la luz", "apaga todo", "temperatura"');

  } catch(e) {
    console.error('[HA]', e.message);
    await client.sendMessage(id, '❌ Error conectando con Home Assistant.');
  }
}

export function test() { return !!HASS_TOKEN; }

export async function notificarAlexa(mensaje, dispositivo = 'alexa_media_todas_partes') {
  try {
    const r = await fetch(`${HASS_URL}/api/services/notify/${dispositivo}`, {
      method: 'POST',
      headers: hdrs(),
      body: JSON.stringify({ message: mensaje, data: { type: 'announce' } })
    });
    return r.ok;
  } catch(e) {
    console.error('[Alexa notify]', e.message);
    return false;
  }
}

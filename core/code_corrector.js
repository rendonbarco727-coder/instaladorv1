import axios from 'axios';
import fs from 'fs';
import { execSync } from 'child_process';
import { ROOT_DIR } from '../config/bmo.config.js';

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_AGENT_ID = process.env.MISTRAL_AGENT_ID;
const LOG_CORRECTOR = `${ROOT_DIR}/corrector.log`
const MAX_INTENTOS = 6;

function log(msg) {
  const linea = new Date().toISOString() + " | " + msg + "\n";
  fs.appendFileSync(LOG_CORRECTOR, linea);
  console.log("[CORRECTOR] " + msg);
}

async function consultarMistral(prompt) {
  const res = await axios.post('https://api.mistral.ai/v1/agents/completions', {
    agent_id: MISTRAL_AGENT_ID,
    messages: [{ role: "user", content: prompt }]
  }, {
    headers: {
      'Authorization': 'Bearer ' + MISTRAL_API_KEY,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });
  return res.data.choices[0].message.content;
}

export async function corregirError(descripcion, codigoActual, error) {
  log("Iniciando correccion: " + descripcion);
  for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
    log("Intento " + intento + "/" + MAX_INTENTOS);
    try {
      const prompt = "Eres corrector de codigo Node.js ES modules.\nTarea: " + descripcion + "\nError: " + error + "\nCodigo:\n" + codigoActual.slice(0, 2000) + "\nIntento " + intento + "/" + MAX_INTENTOS + ".\nResponde SOLO el codigo corregido sin markdown.";
      const codigoCorregido = await consultarMistral(prompt);
      const limpio = codigoCorregido.replace(/```javascript|```js|```/g, '').trim();
      const archivoTemp = `${ROOT_DIR}/sandbox/temp_corrector.js`
      fs.writeFileSync(archivoTemp, limpio);
      try {
        execSync('node --check ' + archivoTemp, { timeout: 5000 });
        log("Sintaxis OK en intento " + intento);
        fs.unlinkSync(archivoTemp);
        return { exito: true, codigo: limpio, intentos: intento };
      } catch(syntaxError) {
        error = syntaxError.message.slice(0, 200);
        log("Sintaxis fallo: " + error);
        if (fs.existsSync(archivoTemp)) fs.unlinkSync(archivoTemp);
      }
    } catch(e) {
      log("Error Mistral: " + e.message);
      error = e.message;
    }
  }
  log("No se pudo corregir despues de " + MAX_INTENTOS + " intentos");
  return { exito: false, intentos: MAX_INTENTOS };
}

export async function vigilarLogs(ultimos_errores) {
  if (!ultimos_errores || ultimos_errores.length === 0) return null;
  try {
    const prompt = "Analiza estos errores de un bot WhatsApp Node.js:\n" + ultimos_errores.join("\n") + "\nResponde SOLO JSON: {\"critico\":true/false,\"descripcion\":\"que fallo\",\"solucion\":\"como arreglarlo\"}";
    const respuesta = await consultarMistral(prompt);
    const json = respuesta.replace(/```json|```/g, '').trim();
    return JSON.parse(json);
  } catch(e) {
    log("Error vigilando: " + e.message);
    return null;
  }
}

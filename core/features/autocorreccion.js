import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { buscarWeb } from "../web_search.js";
import { guardarError, obtenerContextoErrores } from "./memoria_comandos.js";
import { registrarAccion } from "./evoluciones_manager.js";
import { callModel } from "../model_router.js";
import { ROOT_DIR, CONFIG } from "../../config/bmo.config.js";

const execAsync = promisify(exec);
const BACKUP_DIR = path.join(ROOT_DIR, 'backups');

export async function crearRespaldo() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `index_${timestamp}.js`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.copyFileSync(path.join(ROOT_DIR, "index.js"), backupPath);
  console.log("Respaldo creado: " + backupPath);
  return backupPath;
}

export async function restaurarRespaldo(backupPath) {
  fs.copyFileSync(backupPath, path.join(ROOT_DIR, "index.js"));
  console.log("Respaldo restaurado desde: " + backupPath);
}

export async function reiniciarBot() {
  await execAsync("pm2 restart bmo --update-env", { timeout: 30000 });
}

export async function verificarSintaxis() {
  try {
    await execAsync(`node --check ${path.join(ROOT_DIR, "index.js")}`, { timeout: 15000 });
    return true;
  } catch (err) {
    console.error("Error de sintaxis:", err.message.slice(0, 200));
    return false;
  }
}

export async function agenteSelfCode(client, id, tareaOriginal) {
  let codigoNuevo = null;
  console.log("Agente autocodigo activado para: " + tareaOriginal);
  await client.sendMessage(id, "No tengo esa habilidad aun. Voy a intentar aprenderla...");

  const backupPath = await crearRespaldo();

  try {
    await client.sendMessage(id, "Buscando como implementar esto...");
    const busqueda = await buscarWeb("how to implement " + tareaOriginal + " in nodejs whatsapp bot");

    console.log("Mistral generando codigo...");
    try {
      const contextoMistral = `Tarea para bot WhatsApp Node.js ES Modules: ${tareaOriginal}`;
      const resMistral = await axios.post("https://api.mistral.ai/v1/chat/completions", {
        model: "mistral-small-latest",
        messages: [
          { role: "system", content: "Eres experto en Node.js ES modules. Escribe SOLO codigo JavaScript puro. Sin explicaciones, sin markdown." },
          { role: "user", content: contextoMistral + `
INFORMACION DE REFERENCIA: ${busqueda ? busqueda.slice(0, 400) : "sin resultados"}
Escribe SOLO el modulo JavaScript completo.
Comienza con los imports y termina con:
export async function ejecutar({ client, id, execAsync, esAdmin }) {}
SIN markdown, SIN backticks, SIN explicaciones.` }
        ],
        max_tokens: 1500,
        temperature: 0.2
      }, {
        headers: { "Authorization": `Bearer ${process.env.MISTRAL_API_KEY}`, "Content-Type": "application/json" },
        timeout: 30000
      });
      codigoNuevo = resMistral.data.choices[0].message.content.trim()
        .replace(/```javascript|```js|```/g, "").replace(/^\s*`+\s*$/gm, "").trim();
      console.log("Mistral genero codigo OK");
    } catch(e) {
      console.log("Mistral fallo, intentando Ollama:", e.message.slice(0, 60));
      try {
        const res = await axios.post("http://127.0.0.1:11434/api/generate", {
          model: "qwen2.5:1.5b",
          system: "Eres un experto en Node.js ES modules. Escribe SOLO codigo JavaScript puro. Sin explicaciones, sin markdown.",
          prompt: `Tarea para bot WhatsApp Node.js ES Modules: ${tareaOriginal}` + `
Tarea: ${tareaOriginal}
Escribe el modulo completo con export async function ejecutar({ client, id, execAsync, esAdmin }) {}`,
          stream: false,
          options: { num_predict: 800 }
        });
        codigoNuevo = res.data.response?.trim();
        console.log("Ollama genero codigo OK");
      } catch(e2) {
        console.log("Ollama tambien fallo:", e2.message.slice(0, 50));
      }
    }

    if (!codigoNuevo || codigoNuevo.length < 50) {
      console.log("Gemini generando codigo...");
      await client.sendMessage(id, "Usando IA avanzada para generar el codigo...");
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          contents: [{ role: "user", parts: [{ text: `Eres un modulo de un bot de WhatsApp autonomo en Raspberry Pi 4.
TAREA: ${tareaOriginal}
REFERENCIA: ${busqueda ? busqueda.slice(0, 400) : "sin resultados"}
Escribe el modulo completo comenzando con imports y terminando con export async function ejecutar.` }] }],
          generationConfig: { maxOutputTokens: 1500, temperature: 0.3 }
        }
      );
      codigoNuevo = res.data.candidates[0].content.parts[0].text.trim()
        .replace(/```javascript|```js|```/g, "").replace(/^\s*`+\s*$/gm, "").replace(/`{3,}/g, "").trim();
    }

    if (!codigoNuevo || codigoNuevo.length < 50) {
      throw new Error("No se pudo generar codigo valido");
    }

    const nombreModulo = tareaOriginal.toLowerCase()
      .replace(/[^a-z0-9]/g, "_").slice(0, 40)
      .replace(/_+/g, "_").replace(/^_|_$/g, "");

    const codigoModulo = `// Modulo auto-generado: ${tareaOriginal}
// Fecha: ${new Date().toISOString()}
import { ROOT_DIR } from '../../config/bmo.config.js';
${codigoNuevo}

export async function ejecutar({ client, id }) {
  try {
    const resultado = await (typeof monitorRAM !== 'undefined' ? monitorRAM({ client, id }) :
                            typeof main !== 'undefined' ? main() :
                            Promise.resolve("Modulo cargado pero sin funcion ejecutable"));
    return resultado;
  } catch(e) {
    await client.sendMessage(id, "Error en modulo: " + e.message);
  }
}`;

    const rutaModulo = `${ROOT_DIR}/evoluciones/` + nombreModulo + ".js";
    fs.writeFileSync(rutaModulo, codigoModulo);

    const sintaxisOk = await verificarSintaxis();
    if (!sintaxisOk) {
      throw new Error("El codigo generado tiene errores de sintaxis");
    }

    await client.sendMessage(id, "Codigo agregado correctamente. Reiniciando para aplicar cambios...");
    console.log("Reiniciando bot con nueva habilidad...");

  } catch(err) {
    console.error("Error en agenteSelfCode:", err.message);
    await restaurarRespaldo(backupPath);
    await client.sendMessage(id, "Hubo un error generando el codigo. Restaurando respaldo...");
    await autocorreccionBackground(client, id, tareaOriginal, err.message, 0);
  }
}

export async function autocorreccionBackground(client, id, tarea, error, intentoActual) {
  const MAX_INTENTOS = 3;
  if (intentoActual >= MAX_INTENTOS) {
    console.log("Max intentos alcanzado para: " + tarea);
    await client.sendMessage(id, "No pude aprender \"" + tarea + "\" despues de " + MAX_INTENTOS + " intentos. Guarde los errores para no repetirlos.");
    return;
  }

  console.log("Autocorreccion intento " + (intentoActual+1) + "/" + MAX_INTENTOS + " para: " + tarea);

  try {
    const contextoPrevio = obtenerContextoErrores(tarea);
    const res = await axios.post("http://127.0.0.1:11434/api/generate", {
      model: "qwen2.5:1.5b",
      system: "Eres experto en Node.js. Genera funciones JavaScript correctas. Responde SOLO con codigo, sin explicaciones ni markdown.",
      prompt: `Tarea: ${tarea}
Error anterior: ${error}
${contextoPrevio}
Genera una funcion JavaScript async que resuelva esta tarea correctamente, evitando el error anterior.
Comienza con: async function`,
      stream: false,
      options: { num_predict: 600 }
    });

    const nuevoCodigo = res.data.response?.trim()
      .replace(/```javascript|```js|```/g, "").trim();

    if (!nuevoCodigo || nuevoCodigo.length < 30) {
      throw new Error("Codigo generado invalido");
    }

    const nombreHabilidad = tarea.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30);
    const resultado = await aprenderHabilidad(nombreHabilidad, nuevoCodigo);

    if (resultado.exito) {
      await client.sendMessage(id, "Aprendi de mis errores y lo logre! Habilidad: " + nombreHabilidad);
      registrarAccion("exitosa");
    } else {
      guardarError(tarea, resultado.error, nuevoCodigo);
      registrarAccion("error_post_cambio");
      setTimeout(() => autocorreccionBackground(client, id, tarea, resultado.error, intentoActual + 1), 5000);
    }
  } catch(err) {
    guardarError(tarea, err.message, null);
    setTimeout(() => autocorreccionBackground(client, id, tarea, err.message, intentoActual + 1), 5000);
  }
}

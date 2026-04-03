// core/web_search.js
import axios from 'axios';

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

export async function buscarConSearXNG(query) {
  try {
    const res = await axios.get("http://localhost:8080/search", {
      params: { q: query, format: "json" },
      timeout: 10000
    });
    const resultados = res.data.results || [];
    if (resultados.length === 0) return null;
    return resultados.slice(0, 3).map(r => `${r.title}: ${r.content}`).join("\n");
  } catch(err) {
    console.log("SearXNG fallo: " + err.message.slice(0, 80));
    return null;
  }
}

export async function buscarConBrave(query) {
  try {
    const res = await axios.get("https://api.search.brave.com/res/v1/web/search", {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": BRAVE_API_KEY
      },
      params: { q: query, count: 3 },
      timeout: 10000
    });
    const resultados = res.data.web?.results || [];
    if (resultados.length === 0) return null;
    return resultados.slice(0, 3).map(r => `${r.title}: ${r.description}`).join("\n");
  } catch(err) {
    console.log("Brave fallo: " + err.message.slice(0, 80));
    return null;
  }
}

export async function buscarWeb(query) {
  console.log("Buscando con SearXNG: " + query);
  const resultadoSearX = await buscarConSearXNG(query);
  if (resultadoSearX) {
    console.log("SearXNG exitoso");
    return resultadoSearX;
  }
  try {
    console.log("SearXNG fallo, intentando Brave: " + query);
    const resultadoBrave = await buscarConBrave(query);
    if (resultadoBrave) return resultadoBrave;
  } catch(err) {
    console.error("Error Brave:", err.message.slice(0, 80));
  }
  return 'Sin resultados disponibles para: ' + query;
}

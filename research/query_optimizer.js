// Agrupa subtemas similares y genera máximo 3 queries optimizadas
// Sin LLM — lógica determinista para no gastar tokens

const SIMILITUD_THRESHOLD = 0.35;

// Palabras clave que indican el mismo cluster temático
const CLUSTERS = [
    { nombre: 'impacto_beneficios', palabras: ['impacto','beneficio','ventaja','mejora','eficien','rendimiento','resultado','logro'] },
    { nombre: 'tendencias_herramientas', palabras: ['tendencia','futuro','herramienta','plataforma','tecnolog','emergente','innovaci','nueva'] },
    { nombre: 'etica_social', palabras: ['etic','social','equidad','sesgo','discrimin','privacidad','dato','seguridad','derecho'] },
    { nombre: 'acceso_educacion', palabras: ['acceso','accesibil','inclusiv','brecha','desigual','rural','marginad'] },
    { nombre: 'aprendizaje', palabras: ['aprendizaje','personaliz','adaptativ','alumno','estudiante','docente','aula','enseñanza'] },
];

function normalizar(texto) {
    return texto.toLowerCase()
        .replace(/[áàä]/g,'a').replace(/[éèë]/g,'e')
        .replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u')
        .replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}

function detectarCluster(texto) {
    const norm = normalizar(texto);
    let mejorCluster = null;
    let mejorScore = 0;
    for (const cluster of CLUSTERS) {
        const score = cluster.palabras.filter(p => norm.includes(p)).length;
        if (score > mejorScore) { mejorScore = score; mejorCluster = cluster.nombre; }
    }
    return mejorCluster || 'general';
}

function agruparPorCluster(subtemas) {
    const grupos = {};
    for (const subtema of subtemas) {
        const cluster = detectarCluster(subtema);
        if (!grupos[cluster]) grupos[cluster] = [];
        grupos[cluster].push(subtema);
    }
    return grupos;
}

function construirQuery(subtemas, contexto = '') {
    const texto = subtemas.join(' ');

    // Preservar términos especiales que no deben fragmentarse
    const terminosEspeciales = [
        /precio del dólar/i, /tipo de cambio/i, /dólar hoy/i, /bitcoin/i,
        /ethereum/i, /peso mexicano/i, /mxn/i, /usd\/mxn/i, /bolsa de valores/i,
        /temperatura en/i, /clima en/i, /tiempo en/i
    ];
    for (const regex of terminosEspeciales) {
        if (regex.test(texto)) {
            // Retornar query limpia preservando el término
            const match = texto.match(regex)?.[0] || '';
            const extra = contexto ? ' ' + contexto : '';
            // Agregar año actual para búsquedas de precios
            const esFinanciero = /precio|dólar|bitcoin|tipo de cambio|bolsa/i.test(texto);
            return texto.replace(/BMO,?\s*/i, '').trim() + (esFinanciero ? ' ' + new Date().getFullYear() : '') + extra;
        }
    }

    // Lógica original para queries generales
    // Strip de frases de tarea antes de extraer keywords
    const textoLimpio = texto
        .replace(/\b(crea|crear|genera|generar|hace|hacer|escribe|escribir|elabora|elaborar|redacta|redactar|diseña|diseñar|arma|armar)\b[^,.]*(documento|word|docx|excel|pdf|presentacion|reporte|informe|tabla|lista)[^,.]*/gi, '')
        .replace(/\b(y\s+)?(crea|genera|hace|escribe|elabora|redacta)\b.*/gi, '')
        .trim() || texto;
    const stopWords = new Set(['de','la','el','en','los','las','con','por','para','sobre','del','que','una','uno','y','e','o','u','a','busca','buscar','crea','crear','genera','generar','hace','hacer','escribe','escribir','elabora','redacta']);
    const palabras = textoLimpio
        .toLowerCase()
        .replace(/[^a-záéíóúüñ\s]/g, ' ')
        .split(/\s+/)
        .filter(p => p.length > 3 && !stopWords.has(p));

    const freq = {};
    for (const p of palabras) freq[p] = (freq[p] || 0) + 1;

    const topPalabras = Object.entries(freq)
        .sort((a,b) => b[1]-a[1])
        .slice(0, 6)
        .map(([p]) => p);

    const query = topPalabras.join(' ') + (contexto ? ' ' + contexto : '');
    return query.slice(0, 120);
}

export function optimizarQueries(subtemas, contextoGeneral = '') {
    if (!subtemas || !subtemas.length) return [];
    subtemas = subtemas.filter(s => s && typeof s === 'string');
    if (!subtemas.length) return [];

    console.log(`[QUERY_OPTIMIZER] Recibidos ${subtemas.length} subtemas`);

    // Deduplicar subtemas muy similares
    const unicos = [];
    for (const s of subtemas) {
        const normS = normalizar(s);
        const yaExiste = unicos.some(u => {
            const normU = normalizar(u);
            const palabrasS = new Set(normS.split(' ').filter(p => p.length > 3));
            const palabrasU = new Set(normU.split(' ').filter(p => p.length > 3));
            const comunes = [...palabrasS].filter(p => palabrasU.has(p)).length;
            const total = Math.max(palabrasS.size, palabrasU.size);
            return total > 0 && comunes / total > SIMILITUD_THRESHOLD;
        });
        if (!yaExiste) unicos.push(s);
    }
    console.log(`[QUERY_OPTIMIZER] ${unicos.length} subtemas únicos tras deduplicación`);

    // Si ya son 3 o menos, optimizar cada uno directamente
    if (unicos.length <= 3) {
        const queries = unicos.map(s => construirQuery([s], contextoGeneral));
        console.log(`[QUERY_OPTIMIZER] Generó ${queries.length} queries finales`);
        return queries;
    }

    // Agrupar por cluster temático
    const grupos = agruparPorCluster(unicos);
    const claves = Object.keys(grupos);

    let queries = [];

    if (claves.length >= 3) {
        // Tomar los 3 clusters más grandes
        const top3 = claves
            .sort((a,b) => grupos[b].length - grupos[a].length)
            .slice(0, 3);
        queries = top3.map(k => construirQuery(grupos[k], contextoGeneral));
    } else {
        // Menos de 3 clusters — construir una query por cluster
        queries = claves.map(k => construirQuery(grupos[k], contextoGeneral));
        // Si solo hay 1-2, agregar query general
        if (queries.length < 2) {
            queries.push(construirQuery(unicos, contextoGeneral));
        }
    }

    // Limpiar y limitar
    queries = [...new Set(queries)]
        .filter(q => q.trim().length > 5)
        .slice(0, 3);

    console.log(`[QUERY_OPTIMIZER] Generó ${queries.length} queries finales:`);
    queries.forEach((q, i) => console.log(`  ${i+1}. ${q}`));

    return queries;
}

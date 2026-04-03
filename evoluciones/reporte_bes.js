import fs from 'fs';

// Estado del reporte en memoria por usuario
const reportesSesion = new Map();

export function test() { return true; }

export async function ejecutar({ client, id, msg, sesion }) {
    const texto = (sesion?.mensajeOriginal || sesion?.ultimoMensaje || '').toLowerCase().trim();
    const estado = reportesSesion.get(id) || { registros: [], fecha: new Date().toLocaleDateString('es-MX') };

    // Comando para generar reporte final
    if (/genera.*reporte|reporte.*final|dame.*reporte|exportar.*reporte/i.test(texto)) {
        if (!estado.registros.length) {
            await client.sendMessage(id, '❌ No hay activaciones registradas aún.');
            return true;
        }
        const reporte = generarReporte(estado);
        await client.sendMessage(id, reporte);
        // Limpiar sesión
        reportesSesion.delete(id);
        return true;
    }

    // Comando para ver registros actuales
    if (/cuántos|cuantos|ver registros|mis activaciones/i.test(texto)) {
        if (!estado.registros.length) {
            await client.sendMessage(id, '📋 No hay activaciones registradas aún.');
            return true;
        }
        await client.sendMessage(id, `📋 Tienes *${estado.registros.length}* activación(es) registrada(s).\n\nEscribe *genera reporte* para ver el reporte completo.`);
        return true;
    }

    // Comando para limpiar sesión
    if (/limpiar.*reporte|nueva.*sesion|borrar.*activaciones/i.test(texto)) {
        reportesSesion.delete(id);
        await client.sendMessage(id, '🗑️ Sesión de reporte limpiada.');
        return true;
    }

    return false;
}

export async function procesarImagenBES({ client, id, mediaData, mimetype, caption, axiosInst, geminiKey, geminiModel }) {
    await client.sendMessage(id, '🔍 Analizando activación BES...');

    try {
        // Usar Gemini Vision — mismo método que opción 3
        const GEMINI_KEY = geminiKey || process.env.GEMINI_API_KEY;
        const GEMINI_MDL = geminiModel || process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        const axios = axiosInst;
        
        const prompt = `Esta es una captura del sistema BES de activaciones Telcel México.
Extrae EXACTAMENTE estos campos y devuelve SOLO JSON válido sin texto adicional:
{"numero_celular":"número de 10 dígitos del campo Número Activación","iccid":"número largo del campo ICCID que empieza con 8952","imei":"número de 15 dígitos del campo IMEI, si no existe pon No aplica","producto":"nombre del producto"}`;

        const geminiRes = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MDL}:generateContent?key=${GEMINI_KEY}`,
            { contents: [{ role: 'user', parts: [
                { inline_data: { mime_type: mimetype, data: mediaData } },
                { text: prompt }
            ]}], generationConfig: { maxOutputTokens: 300, temperature: 0.1 } }
        );
        const resultado = geminiRes.data.candidates[0].content.parts[0].text.trim();

        // Parsear resultado
        let datos = {};
        try {
            const limpio = resultado.replace(/```json|```/g, '').trim();
            const match = limpio.match(/\{[\s\S]*\}/);
            if (match) datos = JSON.parse(match[0]);
        } catch(e) {
            datos = extraerManual(resultado);
        }

        // Parsear caption — puede incluir marca y datos extra
        // Ejemplo: "Samsung A07, recarga 100, registro si, boletin no, portabilidad no"
        const captionLower = (caption || '').toLowerCase();
        
        // Extraer marca — todo antes de la primera coma o el caption completo si no hay coma
        const partesCaption = (caption || '').split(',').map(p => p.trim());
        const marca = partesCaption[0] || 'No especificada';
        
        // Extraer datos del caption
        const recargaM = captionLower.match(/recarga[:\s]+\$?(\d+)/);
        const registroM = captionLower.match(/registro[:\s]+(si|no|sí)/);
        const boletinM = captionLower.match(/boletin[:\s]+(si|no|sí)/);
        const portabilidadM = captionLower.match(/portabilidad[:\s]+(si|no|sí)/);
        
        const recargaCaption = recargaM ? `$${recargaM[1]}` : '';
        const registroCaption = registroM ? (registroM[1] === 'si' || registroM[1] === 'sí' ? 'Sí' : 'No') : 'No';
        const boletinCaption = boletinM ? (boletinM[1] === 'si' || boletinM[1] === 'sí' ? 'Sí' : 'No') : 'No';
        const portabilidadCaption = portabilidadM ? (portabilidadM[1] === 'si' || portabilidadM[1] === 'sí' ? 'Sí' : 'No') : 'No';

        // Aplicar condiciones automáticas
        const tieneIMEI = datos.imei && datos.imei !== 'No aplica' && datos.imei !== 'null' && datos.imei !== null;
        const amigo = tieneIMEI ? 'Kit' : 'Chip';

        // Crear registro
        const registro = {
            marca,
            imei: tieneIMEI ? datos.imei : 'No aplica',
            sim: datos.iccid || '',
            numero: datos.numero_celular || '',
            amigo,
            recarga: recargaCaption,
            registrado: registroCaption,
            boletin63: boletinCaption,
            portabilidad: portabilidadCaption
        };

        // Guardar en sesión
        const estado = reportesSesion.get(id) || { registros: [], fecha: new Date().toLocaleDateString('es-MX') };
        estado.registros.push(registro);
        reportesSesion.set(id, estado);

        // Mostrar entrada generada
        const entrada = formatearEntrada(registro, estado.registros.length);
        await client.sendMessage(id, entrada);

        return true;
    } catch(e) {
        console.log('[BES] Gemini falló:', e.message.slice(0,80), '— intentando OCR pytesseract...');
        try {
            // Fallback: OCR con pytesseract
            const { execAsync } = await import('../core/context.js');
            const fs = await import('fs');
            const tmpImg = `/tmp/bes_img_${Date.now()}.jpg`;
            fs.default.writeFileSync(tmpImg, Buffer.from(mediaData, 'base64'));

            const { stdout } = await execAsync(`python3 /home/ruben/wa-ollama/evoluciones/ocr_bes.py ${tmpImg}`, { timeout: 30000 });
            fs.default.unlinkSync(tmpImg);

            let datos = {};
            try { datos = JSON.parse(stdout.trim()); } catch(e2) { datos = {}; }

            const captionLower = (caption || '').toLowerCase();
            const partesCaption = (caption || '').split(',').map(p => p.trim());
            const marca = partesCaption[0] || 'No especificada';
            const recargaM = captionLower.match(/recarga[:\s]+(\$?\d+)/);
            const registroM = captionLower.match(/registro[:\s]+(si|no|sí)/);
            const boletinM = captionLower.match(/boletin[:\s]+(si|no|sí)/);
            const portabilidadM = captionLower.match(/portabilidad[:\s]+(si|no|sí)/);
            const tieneIMEI = datos.imei && datos.imei !== 'No aplica' && datos.imei !== 'null';

            const registro = {
                marca,
                imei: tieneIMEI ? datos.imei : 'No aplica',
                sim: datos.iccid || '',
                numero: datos.numero_celular || '',
                amigo: tieneIMEI ? 'Kit' : 'Chip',
                recarga: recargaM ? `$${recargaM[1]}` : '',
                registrado: registroM ? (registroM[1].startsWith('s') ? 'Sí' : 'No') : 'No',
                boletin63: boletinM ? (boletinM[1].startsWith('s') ? 'Sí' : 'No') : 'No',
                portabilidad: portabilidadM ? (portabilidadM[1].startsWith('s') ? 'Sí' : 'No') : 'No'
            };

            const estado = reportesSesion.get(id) || { registros: [], fecha: new Date().toLocaleDateString('es-MX') };
            estado.registros.push(registro);
            reportesSesion.set(id, estado);
            await client.sendMessage(id, formatearEntrada(registro, estado.registros.length) + '\n_(via moondream)_');
        } catch(e2) {
            await client.sendMessage(id, `❌ Error analizando imagen: ${e.message.slice(0,100)}`);
        }
        return true;
    }
}

export async function procesarActivacionBESTexto({ client, id, texto }) {
    const lineas = texto.split(/\n/).map(l => l.trim()).filter(Boolean);
    const registros = [];
    let i = 0;

    while (i < lineas.length) {
        // Detectar bloque: marca, IMEI, ICCID, número, recarga, registro
        const imeiIdx = lineas.findIndex((l, idx) => idx >= i && /^\d{15}$/.test(l));
        if (imeiIdx === -1) break;

        const marca = lineas.slice(i, imeiIdx).find(l => !/^\d+$/.test(l) && !/recarga|registro|boletin|portabilidad/i.test(l)) || 'No especificada';
        const imei = lineas[imeiIdx];
        const iccid = lineas[imeiIdx + 1] || '';
        const numero = lineas[imeiIdx + 2] || '';

        const resto = lineas.slice(imeiIdx + 3, imeiIdx + 8).join(' ').toLowerCase();
        const recargaM = resto.match(/recarga[:\s]*(\$?\d+)/);
        const registroM = resto.match(/registro[:\s]*(si|no|sí)/);
        const boletinM = resto.match(/boletin[:\s]*(si|no|sí)/);
        const portabilidadM = resto.match(/portabilidad[:\s]*(si|no|sí)/);

        registros.push({
            marca: marca.replace(/,.*/, '').trim(),
            imei,
            sim: iccid,
            numero,
            amigo: 'Kit',
            recarga: recargaM ? `$${recargaM[1].replace('$','')}` : '',
            registrado: registroM ? (registroM[1].startsWith('s') ? 'Sí' : 'No') : 'No',
            boletin63: boletinM ? (boletinM[1].startsWith('s') ? 'Sí' : 'No') : 'No',
            portabilidad: portabilidadM ? (portabilidadM[1].startsWith('s') ? 'Sí' : 'No') : 'No'
        });

        // Buscar siguiente bloque
        const siguienteIMEI = lineas.findIndex((l, idx) => idx > imeiIdx && /^\d{15}$/.test(l));
        i = siguienteIMEI === -1 ? lineas.length : siguienteIMEI - 1;
        if (siguienteIMEI === -1) break;
    }

    if (!registros.length) {
        await client.sendMessage(id, '❌ No pude extraer activaciones del texto.');
        return;
    }

    const estado = reportesSesion.get(id) || { registros: [], fecha: new Date().toLocaleDateString('es-MX') };
    for (const reg of registros) {
        estado.registros.push(reg);
        await client.sendMessage(id, formatearEntrada(reg, estado.registros.length));
    }
    reportesSesion.set(id, estado);
}

function extraerManual(texto) {
    const datos = {};
    const numM = texto.match(/(\d{10})/);
    if (numM) datos.numero_celular = numM[1];
    const iccidM = texto.match(/8952\d{15,18}/);
    if (iccidM) datos.iccid = iccidM[0];
    const imeiM = texto.match(/\b\d{15}\b/);
    if (imeiM) datos.imei = imeiM[0];
    return datos;
}

function formatearEntrada(r, num) {
    return `✅ *Activación #${num} registrada*

Marca: ${r.marca}
IMEI: ${r.imei}
SIM: ${r.sim}
Número: ${r.numero}
AMIGO: ${r.amigo}
Recarga: ${r.recarga || '___'}
Se registró: ${r.registrado || '___'}
Boletín 63: ${r.boletin63 || '___'}
Portabilidad: ${r.portabilidad || '___'}

_Envía otra foto o escribe *genera reporte* para terminar_`;
}

function generarReporte(estado) {
    const fecha = estado.fecha;
    let reporte = `📋 *REPORTE DE ACTIVACIONES*\nFecha: ${fecha}\n\n`;
    reporte += '━'.repeat(30) + '\n\n';

    estado.registros.forEach((r, i) => {
        reporte += `*${i + 1}. ${r.marca}*\n`;
        reporte += `IMEI: ${r.imei}\n`;
        reporte += `SIM: ${r.sim}\n`;
        reporte += `Número: ${r.numero}\n`;
        reporte += `Recarga: ${r.recarga || '___'}\n`;
        reporte += `AMIGO: ${r.amigo}\n`;
        reporte += `Se registró la línea: ${r.registrado || '___'}\n`;
        reporte += `Boletín 63: ${r.boletin63 || '___'}\n`;
        reporte += `Portabilidad: ${r.portabilidad || '___'}\n\n`;
    });

    reporte += `━`.repeat(30) + '\n';
    reporte += `Total: *${estado.registros.length}* activación(es)`;
    return reporte;
}

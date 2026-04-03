import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const TEMP_DIR = '/home/ruben/wa-ollama/temp_files';
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Estado de conversaciones activas - persistido en archivo
const SESIONES_FILE = '/home/ruben/wa-ollama/temp_files/doc_sesiones.json';

function cargarSesiones() {
  try {
    if (fs.existsSync(SESIONES_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESIONES_FILE, 'utf8'));
      return new Map(Object.entries(data));
    }
  } catch(e) {}
  return new Map();
}

function guardarSesiones(map) {
  try {
    const obj = Object.fromEntries(map);
    fs.writeFileSync(SESIONES_FILE, JSON.stringify(obj), 'utf8');
  } catch(e) {}
}

const sesionesDocumento = cargarSesiones();

const TIPOS_DOCUMENTO = {
  'carta de recomendacion': {
    nombre: 'Carta de Recomendación Laboral',
    campos: [
      { key: 'nombre_recomendado', pregunta: '👤 ¿Cuál es el nombre completo de la persona a recomendar?' },
      { key: 'nombre_recomendador', pregunta: '✍️ ¿Cuál es tu nombre completo (quien recomienda)?' },
      { key: 'cargo_recomendador', pregunta: '💼 ¿Cuál es tu cargo o puesto?' },
      { key: 'empresa_recomendador', pregunta: '🏢 ¿En qué empresa o institución trabajas?' },
      { key: 'tiempo_conocido', pregunta: '📅 ¿Cuánto tiempo conoces a esta persona?' },
      { key: 'cargo_recomendado', pregunta: '💼 ¿Qué cargo desempeñó la persona recomendada?' },
      { key: 'cualidades', pregunta: '⭐ ¿Cuáles son sus principales cualidades o logros? (describe brevemente)' },
      { key: 'destino', pregunta: '📋 ¿A quién va dirigida la carta? (empresa, institución o "A quien corresponda")' },
    ]
  },
  'carta de presentacion': {
    nombre: 'Carta de Presentación',
    campos: [
      { key: 'nombre', pregunta: '👤 ¿Cuál es tu nombre completo?' },
      { key: 'puesto', pregunta: '💼 ¿Para qué puesto estás aplicando?' },
      { key: 'empresa', pregunta: '🏢 ¿A qué empresa va dirigida?' },
      { key: 'experiencia', pregunta: '📋 ¿Cuántos años de experiencia tienes y en qué área?' },
      { key: 'habilidades', pregunta: '⭐ ¿Cuáles son tus principales habilidades?' },
      { key: 'motivacion', pregunta: '💡 ¿Por qué quieres trabajar en esa empresa?' },
    ]
  },
  'contrato': {
    nombre: 'Contrato de Servicios',
    campos: [
      { key: 'cliente', pregunta: '👤 ¿Cuál es el nombre del cliente?' },
      { key: 'proveedor', pregunta: '👤 ¿Cuál es el nombre del proveedor/prestador?' },
      { key: 'servicio', pregunta: '🔧 ¿Qué servicio se va a prestar?' },
      { key: 'monto', pregunta: '💰 ¿Cuál es el monto acordado?' },
      { key: 'duracion', pregunta: '📅 ¿Cuál es la duración del contrato?' },
      { key: 'ciudad', pregunta: '📍 ¿En qué ciudad se firma el contrato?' },
    ]
  },
  'factura': {
    nombre: 'Factura',
    campos: [
      { key: 'empresa', pregunta: '🏢 ¿Nombre de tu empresa o negocio?' },
      { key: 'cliente', pregunta: '👤 ¿Nombre del cliente?' },
      { key: 'concepto', pregunta: '📋 ¿Concepto o descripción del servicio/producto?' },
      { key: 'monto', pregunta: '💰 ¿Monto total?' },
      { key: 'fecha', pregunta: '📅 ¿Fecha de la factura? (o escribe "hoy")' },
    ]
  }
};

function detectarTipoDocumento(mensaje) {
  const m = mensaje.toLowerCase();
  if (m.includes('recomendacion') || m.includes('recomendación')) return 'carta de recomendacion';
  if (m.includes('presentacion') || m.includes('presentación')) return 'carta de presentacion';
  if (m.includes('contrato')) return 'contrato';
  if (m.includes('factura')) return 'factura';
  if (m.includes('carta')) return 'carta de recomendacion'; // default carta
  return null;
}

function generarContenidoCarta(tipo, datos) {
  const fecha = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  
  if (tipo === 'carta de recomendacion') {
    return `${datos.ciudad || 'Ciudad de México'}, ${fecha}

${datos.destino}

Estimados señores:

Por medio de la presente, yo ${datos.nombre_recomendador}, ${datos.cargo_recomendador} de ${datos.empresa_recomendador}, me permito recomendar ampliamente al Sr./Sra. ${datos.nombre_recomendado}.

He tenido el privilegio de conocer a ${datos.nombre_recomendado} durante ${datos.tiempo_conocido}, tiempo durante el cual se desempeñó como ${datos.cargo_recomendado}.

Durante este tiempo he podido constatar que ${datos.nombre_recomendado} es una persona ${datos.cualidades}.

Por lo anterior, recomiendo ampliamente a ${datos.nombre_recomendado} para cualquier oportunidad laboral que se le presente, ya que estoy convencido/a de que será un activo valioso para cualquier organización.

Quedo a sus órdenes para cualquier referencia adicional.

Atentamente,


_______________________________
${datos.nombre_recomendador}
${datos.cargo_recomendador}
${datos.empresa_recomendador}`;
  }

  if (tipo === 'carta de presentacion') {
    return `${fecha}

${datos.empresa}

Estimados señores:

Mi nombre es ${datos.nombre} y me dirijo a ustedes con gran interés en formar parte de su equipo en el puesto de ${datos.puesto}.

Cuento con ${datos.experiencia}, lo que me ha permitido desarrollar habilidades como ${datos.habilidades}.

Me motiva aplicar a ${datos.empresa} porque ${datos.motivacion}.

Estoy convencido/a de que puedo aportar significativamente a su organización. Quedo a su disposición para una entrevista.

Atentamente,

${datos.nombre}`;
  }

  if (tipo === 'contrato') {
    return `CONTRATO DE PRESTACIÓN DE SERVICIOS

En ${datos.ciudad}, siendo el ${fecha}, comparecen:

CLIENTE: ${datos.cliente}
PROVEEDOR: ${datos.proveedor}

CLÁUSULAS:

PRIMERA - OBJETO: El proveedor se compromete a prestar el siguiente servicio: ${datos.servicio}

SEGUNDA - DURACIÓN: El presente contrato tendrá una duración de ${datos.duracion}.

TERCERA - MONTO: El cliente pagará al proveedor la cantidad de ${datos.monto} por los servicios prestados.

CUARTA - Las partes acuerdan resolver cualquier controversia de manera amistosa.

Firman de conformidad:


_______________________________          _______________________________
${datos.cliente}                              ${datos.proveedor}
CLIENTE                                   PROVEEDOR`;
  }

  if (tipo === 'factura') {
    const fechaDoc = datos.fecha === 'hoy' ? fecha : datos.fecha;
    return `FACTURA

Empresa: ${datos.empresa}
Fecha: ${fechaDoc}

CLIENTE: ${datos.cliente}

CONCEPTO: ${datos.concepto}

TOTAL: ${datos.monto}

Gracias por su preferencia.
${datos.empresa}`;
  }
}

async function generarPDF(contenido, nombreArchivo) {
  const txtPath = `${TEMP_DIR}/${nombreArchivo}.txt`;
  const psPath = `${TEMP_DIR}/${nombreArchivo}.ps`;
  const pdfPath = `${TEMP_DIR}/${nombreArchivo}.pdf`;
  
  fs.writeFileSync(txtPath, contenido, 'utf8');
  
  try {
    await execAsync(`enscript -p "${psPath}" "${txtPath}" 2>/dev/null`);
    await execAsync(`ps2pdf "${psPath}" "${pdfPath}"`);
    if (fs.existsSync(pdfPath)) return pdfPath;
  } catch(e) {
    console.error('[PDF] enscript error:', e.message);
  }
  
  // Fallback: texto plano con extensión pdf
  fs.copyFileSync(txtPath, pdfPath);
  return pdfPath;
}

async function generarWord(contenido, nombreArchivo) {
  const txtPath = `${TEMP_DIR}/${nombreArchivo}.txt`;
  const docxPath = `${TEMP_DIR}/${nombreArchivo}.docx`;
  
  fs.writeFileSync(txtPath, contenido, 'utf8');
  
  try {
    await execAsync(`libreoffice --headless --convert-to docx "${txtPath}" --outdir "${TEMP_DIR}" 2>/dev/null`);
  } catch(e) {
    fs.copyFileSync(txtPath, docxPath);
  }
  return docxPath;
}

export async function ejecutar({ client, id, sesion }) {
  const mensaje = (sesion?.mensajeOriginal || sesion?.ultimoMensaje || '').toLowerCase().trim();
  const sesionActiva = sesionesDocumento.get(id);

  // Si hay sesión activa, procesar respuesta
  if (sesionActiva) {
    // Cancelar sesión
    if (/^cancelar$|^salir$|^cancel$|^stop$/i.test(mensaje.trim())) {
      sesionesDocumento.delete(id); guardarSesiones(sesionesDocumento);
      await client.sendMessage(id, '❌ Documento cancelado.');
      return true;
    }
    const { tipo, campos, campoActual, datos } = sesionActiva;

    // Respuesta al campo actual
    if (campoActual < campos.length) {
      datos[campos[campoActual].key] = sesion?.mensajeOriginal || sesion?.ultimoMensaje;
      const siguiente = campoActual + 1;

      if (siguiente < campos.length) {
        // Siguiente pregunta
        sesionesDocumento.set(id, { ...sesionActiva, campoActual: siguiente, datos }); guardarSesiones(sesionesDocumento);
        await client.sendMessage(id, campos[siguiente].pregunta);
        return true;
      } else {
        // Todos los datos recopilados - preguntar formato
        sesionesDocumento.set(id, { ...sesionActiva, campoActual: siguiente, datos, esperandoFormato: true }); guardarSesiones(sesionesDocumento);
        await client.sendMessage(id, '📄 ¿En qué formato quieres el documento?\n\n1️⃣ *PDF*\n2️⃣ *Word* (.docx)\n\nResponde *PDF* o *Word*');
        return true;
      }
    }

    // Esperando formato
    if (sesionActiva.esperandoFormato) {
      const formato = mensaje.includes('pdf') || mensaje.includes('1') ? 'pdf' : mensaje.includes('word') || mensaje.includes('2') ? 'word' : null;
      
      if (!formato) {
        await client.sendMessage(id, 'Por favor responde *PDF* o *Word*');
        return true;
      }

      await client.sendMessage(id, '⏳ Generando tu documento...');
      
      const contenido = generarContenidoCarta(tipo, sesionActiva.datos);
      const nombreArchivo = `${tipo.replace(/ /g, '_')}_${Date.now()}`;
      
      try {
        let archivoPath;
        if (formato === 'pdf') {
          archivoPath = await generarPDF(contenido, nombreArchivo);
        } else {
          archivoPath = await generarWord(contenido, nombreArchivo);
        }

        const pkg = await import('whatsapp-web.js');
        const MessageMedia = pkg.default.MessageMedia || pkg.MessageMedia;
        const media = MessageMedia.fromFilePath(archivoPath);
        await client.sendMessage(id, media, { caption: `✅ Aquí está tu *${TIPOS_DOCUMENTO[tipo].nombre}* en formato ${formato.toUpperCase()}` });
        
      } catch(e) {
        // Si falla el archivo, enviar como texto
        await client.sendMessage(id, `✅ *${TIPOS_DOCUMENTO[tipo].nombre}*\n\n\`\`\`${contenido}\`\`\``);
      }

      sesionesDocumento.delete(id); guardarSesiones(sesionesDocumento);
      return true;
    }
  }

  // Detectar si es solicitud de nuevo documento
  const esDocumento = /carta|contrato|factura/i.test(mensaje);
  if (!esDocumento) return false;

  const tipo = detectarTipoDocumento(mensaje);
  if (!tipo) {
    await client.sendMessage(id, '📄 ¿Qué documento quieres crear?\n\n1️⃣ Carta de recomendación\n2️⃣ Carta de presentación\n3️⃣ Contrato de servicios\n4️⃣ Factura');
    return true;
  }

  const config = TIPOS_DOCUMENTO[tipo];
  sesionesDocumento.set(id, { tipo, campos: config.campos, campoActual: 0, datos: {}, esperandoFormato: false }); guardarSesiones(sesionesDocumento);
  
  await client.sendMessage(id, `📝 Vamos a crear tu *${config.nombre}*.\n\nTe haré algunas preguntas. Puedes escribir *cancelar* en cualquier momento.\n\n${config.campos[0].pregunta}`);
  return true;
}

export function test() { return true; }

// Laboratorio de pruebas BMO
// Ejecutar con: node ~/wa-ollama/sandbox/laboratorio.js
import fs from 'fs';
import { execSync } from 'child_process';

const LOG_FILE = '/home/ruben/wa-ollama/sandbox/resultados.json';

function cargarResultados() {
  if (!fs.existsSync(LOG_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(LOG_FILE)); }
  catch { return []; }
}

function guardarResultado(experimento) {
  const resultados = cargarResultados();
  resultados.unshift({ ...experimento, fecha: new Date().toISOString() });
  fs.writeFileSync(LOG_FILE, JSON.stringify(resultados.slice(0, 50), null, 2));
}

export async function probarModulo(codigo, descripcion = "experimento") {
  const resultado = { descripcion, codigo: codigo.slice(0, 200), exito: false, error: null, salida: null };
  
  const archivoTemp = '/home/ruben/wa-ollama/sandbox/temp_experimento.js';
  
  try {
    // Verificar sintaxis primero
    fs.writeFileSync(archivoTemp, codigo);
    execSync('node --check ' + archivoTemp, { timeout: 5000 });
    resultado.exito = true;
    resultado.salida = "Sintaxis correcta";
  } catch(e) {
    resultado.error = e.message.slice(0, 200);
    resultado.salida = "Error de sintaxis";
  } finally {
    if (fs.existsSync(archivoTemp)) fs.unlinkSync(archivoTemp);
  }
  
  guardarResultado(resultado);
  return resultado;
}

export function listarExperimentos() {
  return cargarResultados();
}

export function aprobarModulo(nombreOrigen, nombreDestino) {
  const origen = '/home/ruben/wa-ollama/sandbox/' + nombreOrigen;
  const destino = '/home/ruben/wa-ollama/evoluciones/' + nombreDestino;
  if (!fs.existsSync(origen)) return { ok: false, error: 'No existe en sandbox' };
  fs.copyFileSync(origen, destino);
  return { ok: true, mensaje: 'Modulo aprobado y movido a evoluciones' };
}

const validateModule = (moduleName, moduleContent) => {
  try {
    // Validar nombre de módulo
    if (!/^[a-z0-9_]+$/.test(moduleName)) {
      throw new Error('Nombre de módulo inválido');
    }
    
    // Validar JSON
    const parsed = JSON.parse(moduleContent);
    if (typeof parsed !== 'object') {
      throw new Error('Contenido no es JSON válido');
    }
    
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

// Usar en el flujo de generación de módulos

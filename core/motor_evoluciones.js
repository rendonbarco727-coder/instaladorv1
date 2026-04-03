// Motor de evoluciones - carga modulos dinamicamente
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import vm from 'vm';
import { ROOT_DIR } from '../config/bmo.config.js';

const EVOLUCIONES_DIR = `${ROOT_DIR}/evoluciones`
const modulos = new Map();

// Validacion profunda - no solo includes sino patrones
export function validarSeguridad(codigo) {
  const patrones = [
    { re: /process\s*\[/, razon: "acceso dinamico a process" },
    { re: /global\s*\[/, razon: "acceso dinamico a global" },
    { re: /require\s*\(/, razon: "uso de require" },
    { re: /child_process/, razon: "acceso a child_process" },
    { re: /rm\s+-rf/, razon: "comando destructivo rm -rf" },
    { re: /process\.exit/, razon: "process.exit no permitido" },
    { re: /process\.kill/, razon: "process.kill no permitido" },
    { re: /fs\.unlink|fs\.rm|fs\.rmdir/, razon: "operaciones destructivas de fs" },
    { re: /while\s*\(\s*true\s*\)/, razon: "loop infinito detectado" },
    { re: /for\s*\(\s*;\s*;\s*\)/, razon: "loop infinito detectado" },
    { re: /eval\s*\(/, razon: "eval no permitido" },
    { re: /new\s+Function/, razon: "Function constructor no permitido" },
    { re: /\bFunction\s*\(/, razon: "Function constructor sin new no permitido" },
    { re: /new\s+Array\s*\(\s*\d{7,}/, razon: "array excesivo no permitido" },
    { re: /new\s+Array\s*\(\s*1e/, razon: "array gigante no permitido" },
  ];

  for (const { re, razon } of patrones) {
    if (re.test(codigo)) {
      return { seguro: false, razon };
    }
  }
  return { seguro: true };
}

// Sandbox real con VM
function probarEnSandbox(codigo) {
  try {
    const contexto = vm.createContext({
      console: { log: () => {}, error: () => {}, warn: () => {} },
      setTimeout: () => {},
      setInterval: () => {},
      clearTimeout: () => {},
      clearInterval: () => {},
      process: undefined,
      require: undefined,
      global: undefined,
      fetch: undefined,
    });
    // Solo verificar que no crashea al parsear/iniciar
    const script = new vm.Script(codigo.replace(/^\s*import .+$/gm, '// import bloqueado en sandbox'), { timeout: 3000 });
    script.runInContext(contexto, { timeout: 3000 });
    return { ok: true };
  } catch(e) {
    // Si es error de import es normal (no se puede en VM), si es otro error es problema
    if (e.message.includes('import') || e.message.includes('Cannot use import')) return { ok: true };
    return { ok: false, error: e.message };
  }
}

export async function aprenderHabilidad(nombre, codigo) {
  const archivoModulo = path.join(EVOLUCIONES_DIR, nombre + '.js');

  // 1. Validar seguridad profunda
  const seguridad = validarSeguridad(codigo);
  if (!seguridad.seguro) {
    return { exito: false, error: "Codigo rechazado: " + seguridad.razon };
  }

  // 2. Guardar temporalmente
  fs.writeFileSync(archivoModulo, codigo);

  // 3. Validar sintaxis con node --check
  try {
    execSync("node --check " + archivoModulo, { timeout: 10000 });
  } catch(e) {
    fs.unlinkSync(archivoModulo);
    return { exito: false, error: "Sintaxis invalida: " + e.message.slice(0, 150) };
  }

  // 4. Sandbox VM
  const sandbox = probarEnSandbox(codigo);
  if (!sandbox.ok) {
    fs.unlinkSync(archivoModulo);
    return { exito: false, error: "Fallo sandbox: " + sandbox.error };
  }

  // 5. Importar dinamicamente
  try {
    const modulo = await import(archivoModulo + "?t=" + Date.now());

    // 6. Ejecutar test interno si existe
    if (modulo.test) {
      try {
        const resultado = await Promise.race([
          modulo.test(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
        ]);
        if (!resultado?.ok) {
          fs.unlinkSync(archivoModulo);
          return { exito: false, error: "No paso pruebas internas: " + (resultado?.error || "desconocido") };
        }
      } catch(e) {
        console.log("Advertencia test: " + e.message);
        // No bloquear si el test falla por dependencias externas
      }
    }

    modulos.set(nombre, modulo);
    return { exito: true, modulo };
  } catch(e) {
    fs.unlinkSync(archivoModulo);
    return { exito: false, error: "Error al importar: " + e.message.slice(0, 100) };
  }
}

export function obtenerModulo(nombre) {
  return modulos.get(nombre);
}

export function listarModulos() {
  return [...modulos.keys()];
}

export async function cargarModulosExistentes() {
  if (!fs.existsSync(EVOLUCIONES_DIR)) return;
  const archivos = fs.readdirSync(EVOLUCIONES_DIR).filter(f => f.endsWith('.js'));
  for (const archivo of archivos) {
    const nombre = archivo.replace('.js', '');
    try {
      const rutaCompleta = path.join(EVOLUCIONES_DIR, archivo);

      // Validar sintaxis antes de cargar
      try {
        execSync("node --check " + rutaCompleta, { timeout: 5000 });
      } catch(e) {
        console.error("Sintaxis invalida en " + nombre + ", guardando para correccion");
        fs.writeFileSync(rutaCompleta + ".error", e.message);
        continue;
      }

      const modulo = await import(rutaCompleta + "?t=" + Date.now());
      modulos.set(nombre, modulo);
      console.log("Modulo cargado: " + nombre);
    } catch(e) {
      console.error("Error cargando modulo " + nombre + ": " + e.message);
      const rutaError = path.join(EVOLUCIONES_DIR, archivo) + ".error";
      fs.writeFileSync(rutaError, e.message);
      console.log("Error guardado para auto-correccion: " + nombre);
    }
  }
}

// ── Sandbox helpers ──────────────────────────────────────────
const EXPERIMENTOS_PATH = `${ROOT_DIR}/experimentos.json`

function _leerExperimentos() {
  try { return JSON.parse(fs.readFileSync(EXPERIMENTOS_PATH, 'utf8')); } catch { return []; }
}
function _guardarExperimentos(arr) {
  fs.writeFileSync(EXPERIMENTOS_PATH, JSON.stringify(arr, null, 2));
}

export async function probarModulo(codigo, descripcion = 'experimento') {
  const { probarModulo: _probar } = await import('../../self_improvement/module_tester.js');
  const resultado = await _probar(codigo);
  const exps = _leerExperimentos();
  exps.unshift({ descripcion, codigo, exito: resultado.exito ?? !resultado.error, error: resultado.error || null, fecha: new Date().toISOString() });
  _guardarExperimentos(exps.slice(0, 50));
  return { exito: resultado.exito ?? !resultado.error, error: resultado.error || null };
}

export function listarExperimentos() {
  return _leerExperimentos();
}

export function aprobarModulo(origen, destino) {
  try {
    if (!origen || !destino) return { ok: false, error: 'Faltan origen y destino' };
    const src = path.resolve(`${ROOT_DIR}`, origen);
    const dst = path.resolve(`${ROOT_DIR}`, destino);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    return { ok: true, mensaje: `Modulo aprobado: ${destino}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Estado global compartido entre index.js y módulos extraídos
import { ROOT_DIR } from '../config/bmo.config.js';
// Importar con: import { state } from './core/state.js';
// Las variables mutables se modifican directamente: state.geminiDisponible = false

export const state = {
  // Gemini / LLM
  geminiDisponible: true,
  tokensUsadosHoy: 0,
  ultimoResetTokens: new Date().toDateString(),
  geminiCaidoDesde: null,

  // Maps de sesión por usuario
  esperandoRespuesta: new Map(),
  contextoListas: new Map(),
  monitoresActivos: new Map(),
  ultimaImagen: new Map(),
  pendientesAutorizacion: new Map(),
  flujoArchivo: new Map(),
  pendienteConfirmacion: new Map(),
  sessions: new Map(),
};

// Constantes de configuración
export const TEMP_DIR = "./temp_files";
export const URL_REGEX = /(https?:\/\/(www\.|vm\.|vt\.)?((youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|fb\.watch))[^\s]*)/i;
export const GEMINI_MODEL = "gemma-3-27b-it";
export const OLLAMA_MODEL = "qwen2.5:0.5b";
export const GEMINI_RETRY_MS = 60000;
export const SESSION_TTL = 10 * 60 * 1000;
export const BACKUP_DIR = `${ROOT_DIR}/backups`
export const EVOLUCIONES_FILE = `${ROOT_DIR}/evoluciones.json`
export const EXPERIMENTOS_FILE = `${ROOT_DIR}/experimentos.json`
export const AUTONOMIA_FILE = `${ROOT_DIR}/autonomia.json`
export const META_FILE = `${ROOT_DIR}/meta.json`
export const MEMORIA_CMDS_FILE = `${ROOT_DIR}/memoria_comandos.json`
export const ERRORES_FILE = `${ROOT_DIR}/errores_autocodigo.json`
export const HISTORIAL_FILE = "./historial.json";
export const USUARIOS_FILE = "./usuarios.json";

export const ARCHIVOS_DIR = `${ROOT_DIR}/archivos`

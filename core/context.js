// core/context.js — Dependencias compartidas centralizadas
import { promisify } from 'util';
import { exec } from 'child_process';

export const execAsync = promisify(exec);

// IDs de administradores autorizados
export const ADMIN_IDS = [
  '527351838760',
  '100365164921028',
  '528123716915',
];

export function esAutorizado(id) {
  return ADMIN_IDS.some(admin => id === admin || id === admin + "@c.us" || id === admin + "@lid");
}

export function esUsuarioAdmin(id) {
  return esAutorizado(id);
}

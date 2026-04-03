import { readFileSync, writeFileSync } from 'fs';

const STATE_FILE = '/tmp/bmo_active_docs.json';

function loadState() {
  try { return new Map(Object.entries(JSON.parse(readFileSync(STATE_FILE,'utf8')))); }
  catch { return new Map(); }
}

function saveState(map) {
  try { writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(map))); } catch {}
}

const TTL_MS = 2 * 60 * 60 * 1000; // 2 horas

class PersistentMap {
  constructor() { this._map = loadState(); }
  get(k) {
    const entry = this._map.get(k);
    if (!entry) return undefined;
    // Soporte legacy (string sin timestamp)
    if (typeof entry === 'string') return entry;
    if (Date.now() - entry.ts > TTL_MS) {
      this._map.delete(k);
      saveState(this._map);
      return undefined;
    }
    return entry.v;
  }
  set(k,v) { this._map.set(k, { v, ts: Date.now() }); saveState(this._map); }
  has(k) { return this.get(k) !== undefined; }
  delete(k) { this._map.delete(k); saveState(this._map); }
}

export const activeDocuments = new PersistentMap();

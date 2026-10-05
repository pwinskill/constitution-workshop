// Shared test fixtures.

import { readFileSync } from 'node:fs';
import { normaliseConfig } from '../js/data.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));

// The real data files, as the app would load them (always demo/local mode).
export function realConfig(overrides = {}) {
  const workshop = { ...read('workshop.json'), storage: { supabaseUrl: '', supabaseKey: '' }, ...overrides };
  return normaliseConfig(workshop, read('cases.json'), read('participants.json'));
}

// Browser-style localStorage for modules that use it.
export function installLocalStorage() {
  const map = new Map();
  const shim = {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, configurable: true, writable: true });
  return map;
}

export function response(code, caseId, decision, extra = {}) {
  return { participant_code: code, case_id: caseId, decision, rationale: `${code} on ${caseId}`, tags: [], confidence: null, ...extra };
}

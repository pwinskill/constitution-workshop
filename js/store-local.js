// Demo-mode storage: everything lives in this browser's localStorage, one key
// per record. Other tabs in the same browser see changes immediately (via the
// `storage` event), so you can open a facilitator tab and several participant
// tabs side by side to try the whole workshop on one machine.

const TABLES = ['participants', 'responses', 'principles', 'votes'];

const keyOf = {
  participants: (r) => r.code,
  responses: (r) => `${r.participant_code}::${r.case_id}`,
  principles: (r) => r.id,
  votes: (r) => `${r.principle_id}::${r.version}::${r.participant_code}`,
};

export function createLocalStore(workshop) {
  const prefix = `cw:${workshop}:db:`;
  const memory = new Map();
  let persistent = true;
  try {
    localStorage.setItem(`${prefix}__probe`, '1');
    localStorage.removeItem(`${prefix}__probe`);
  } catch {
    persistent = false;
  }

  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());
  globalThis.addEventListener?.('storage', (event) => {
    if (!event.key || event.key.startsWith(prefix)) notify();
  });

  function allKeys() {
    if (!persistent) return [...memory.keys()];
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return keys;
  }

  function read(table) {
    const start = `${prefix}${table}:`;
    const rows = [];
    for (const key of allKeys()) {
      if (!key?.startsWith(start)) continue;
      try {
        rows.push(JSON.parse(persistent ? localStorage.getItem(key) : memory.get(key)));
      } catch {
        // skip unreadable rows
      }
    }
    return rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  function get(table, id) {
    const key = `${prefix}${table}:${id}`;
    const value = persistent ? localStorage.getItem(key) : memory.get(key);
    return value ? JSON.parse(value) : null;
  }

  function put(table, row) {
    const key = `${prefix}${table}:${keyOf[table](row)}`;
    const value = JSON.stringify(row);
    if (persistent) localStorage.setItem(key, value);
    else memory.set(key, value);
  }

  function remove(table, id) {
    const key = `${prefix}${table}:${id}`;
    if (persistent) localStorage.removeItem(key);
    else memory.delete(key);
  }

  const now = () => new Date().toISOString();

  function upsert(table, row, { ignoreExisting = false } = {}) {
    const existing = get(table, keyOf[table](row));
    if (existing && ignoreExisting) return existing;
    const merged = { ...existing, ...row, workshop, created_at: existing?.created_at || now(), updated_at: now() };
    put(table, merged);
    notify();
    return merged;
  }

  return {
    kind: 'local',
    label: persistent ? 'Demo mode: saved in this browser only' : 'Demo mode: not saved (browser storage is blocked)',
    persistent,

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    pendingCount: () => 0,
    lastError: () => null,
    readOk: () => true,
    flush: async () => {},

    async listParticipants() {
      return read('participants');
    },
    async listResponses({ participant } = {}) {
      const rows = read('responses');
      return participant ? rows.filter((r) => r.participant_code === participant) : rows;
    },
    async listPrinciples() {
      return read('principles');
    },
    async listVotes({ participant } = {}) {
      const rows = read('votes');
      return participant ? rows.filter((r) => r.participant_code === participant) : rows;
    },

    async addParticipant(person) {
      return { row: upsert('participants', person, { ignoreExisting: true }), queued: false };
    },
    async removeParticipant(code) {
      remove('participants', code);
      notify();
    },
    async saveResponse(response) {
      return { row: upsert('responses', response), queued: false };
    },
    async addPrinciple(principle) {
      return { row: upsert('principles', principle, { ignoreExisting: true }), queued: false };
    },
    async updatePrinciple(id, patch) {
      const existing = get('principles', id);
      if (!existing) throw new Error('That principle no longer exists.');
      return upsert('principles', { ...existing, ...patch, id });
    },
    async deletePrinciple(id) {
      remove('principles', id);
      for (const vote of read('votes')) {
        if (vote.principle_id === id) remove('votes', keyOf.votes(vote));
      }
      notify();
    },
    async saveVote(vote) {
      if (!get('principles', vote.principle_id)) throw new Error('That principle no longer exists.');
      return { row: upsert('votes', vote), queued: false };
    },

    async check() {
      return TABLES.map((table) => ({
        table,
        ok: true,
        message: persistent ? `${read(table).length} rows in this browser` : 'In memory only',
      }));
    },

    // Demo-mode only: wipe everything for this workshop id in this browser.
    async clearAll() {
      for (const key of allKeys()) {
        if (!key?.startsWith(prefix)) continue;
        if (persistent) localStorage.removeItem(key);
        else memory.delete(key);
      }
      notify();
    },

    // Demo-mode only: bulk insert (used by the demo-data generator).
    async importRows(table, rows) {
      for (const row of rows) put(table, { workshop, created_at: now(), updated_at: now(), ...row });
      notify();
    },
  };
}

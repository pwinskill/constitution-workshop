// Shared storage for the real workshop: a Supabase project, reached through its
// REST API with plain fetch() (no client library needed).
//
// Participant writes (answers, votes, proposals) go through an "outbox" kept in
// localStorage: if the Wi-Fi drops, nothing typed is lost; it is retried every
// few seconds until the server accepts it. Every such write is idempotent (an
// upsert on a natural key, or an insert with a client-generated id), so
// retrying is always safe.

import { storage, uuid } from './util.js';

const PAGE = 1000; // Supabase returns at most 1000 rows per request by default.
const TABLES = ['participants', 'responses', 'principles', 'votes'];

export class StoreError extends Error {
  constructor(message, { status = 0, network = false, detail = null } = {}) {
    super(message);
    this.status = status;
    this.network = network;
    this.detail = detail;
  }
}

function explain(status, detail) {
  const code = detail?.code || '';
  const message = detail?.message || '';
  if (status === 401 || status === 403 || code === '42501') {
    return `The database refused access (HTTP ${status}). Check supabaseKey in data/workshop.json, and that supabase/schema.sql has been run.`;
  }
  if (code === 'PGRST205' || code === '42P01' || /does not exist|could not find the table/i.test(message)) {
    return 'A workshop table is missing. Run supabase/schema.sql in the Supabase SQL editor.';
  }
  if (code === 'PGRST204' || /column/i.test(message)) {
    return `The database tables don't match this version of the app (${message}). Re-run supabase/schema.sql.`;
  }
  return message ? `Database error: ${message}` : `Database error (HTTP ${status}).`;
}

const networkError = (err) =>
  new StoreError(
    err?.name === 'AbortError' ? 'The database took too long to respond.' : "Couldn't reach the database. Check the internet connection.",
    { network: true },
  );

const responseKey = (r) => `${r.participant_code}::${r.case_id}`;
const voteKey = (r) => `${r.principle_id}::${r.version}::${r.participant_code}`;

export function createSupabaseStore({ url, key, workshop, timeout: defaultTimeout = 12000 }) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1/`;
  // New-style keys (sb_publishable_...) go in the apikey header only; legacy
  // anon keys are JWTs and are also sent as a bearer token.
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const ws = `workshop=eq.${encodeURIComponent(workshop)}`;
  const OUTBOX = `cw:${workshop}:outbox`;
  const cacheKey = (name) => `cw:${workshop}:cache:${name}`;

  let lastError = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  // The timeout covers the whole exchange, including reading the body, so a
  // connection that stalls half-way can never hang the page.
  async function request(method, path, { body, prefer, timeout = defaultTimeout } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      let res;
      let text;
      try {
        res = await fetch(base + path, {
          method,
          headers: prefer ? { ...headers, Prefer: prefer } : headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
          cache: 'no-store',
        });
        text = await res.text();
      } catch (err) {
        throw networkError(err);
      }
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) {
        throw new StoreError(explain(res.status, data), {
          status: res.status,
          network: res.status >= 500 || res.status === 429,
          detail: data,
        });
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function listAll(table, filter = '', order = 'created_at.asc') {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await request(
        'GET',
        `${table}?select=*&${ws}${filter}&order=${order}&limit=${PAGE}&offset=${offset}`,
      );
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  function upsert(table, row, onConflict, ignore = false) {
    return request('POST', `${table}?on_conflict=${onConflict}`, {
      body: row,
      prefer: `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=representation`,
    });
  }

  // ---- read cache (participant pages) -------------------------------------
  // Participant pages keep a copy of their last successful reads, so a reload
  // during a Wi-Fi drop still shows their own answers and the principles.

  let readOk = true;
  async function cachedRead(name, cache, read) {
    try {
      const rows = await read();
      readOk = true;
      if (cache) storage.set(cacheKey(name), rows);
      return rows;
    } catch (err) {
      if (err.network) readOk = false;
      const copy = cache && err.network ? storage.get(cacheKey(name)) : null;
      if (copy) return copy;
      throw err;
    }
  }

  // After a queued write reaches the server, fold it into any cached copy.
  const CACHED = {
    responses: (row) => [`responses:${row.participant_code}`, responseKey],
    votes: (row) => [`votes:${row.participant_code}`, voteKey],
    principles: () => ['principles', (r) => r.id],
    participants: () => ['participants', (r) => r.code],
  };
  function rememberWritten(table, row) {
    const [name, keyFn] = CACHED[table](row);
    const cached = storage.get(cacheKey(name));
    if (!Array.isArray(cached)) return;
    const previous = cached.find((r) => keyFn(r) === keyFn(row));
    storage.set(cacheKey(name), [...cached.filter((r) => keyFn(r) !== keyFn(row)), { ...previous, ...row }]);
  }

  // ---- outbox -------------------------------------------------------------
  // Kept in localStorage so it survives a reload; if the browser won't allow
  // that (blocked site data, full storage), it falls back to memory so writes
  // are still sent rather than silently dropped.

  let memoryOutbox = null;
  const readOutbox = () => memoryOutbox ?? storage.get(OUTBOX, []);
  function writeOutbox(items) {
    if (memoryOutbox === null && storage.set(OUTBOX, items)) return;
    memoryOutbox = items;
  }

  function enqueue(op) {
    writeOutbox([...readOutbox().filter((item) => item.key !== op.key), op]);
  }

  let flushing = null;
  let flushAgain = false;
  function flush() {
    if (flushing) {
      flushAgain = true; // something was queued mid-flush: do another pass
      return flushing;
    }
    flushing = (async () => {
      let error = null;
      do {
        flushAgain = false;
        error = null;
        for (const op of readOutbox()) {
          try {
            const rows = await upsert(op.table, op.row, op.onConflict, op.ignore);
            if (rows?.[0]) rememberWritten(op.table, rows[0]);
          } catch (err) {
            if (err.status !== 409) {
              error = err;
              if (err.network) break; // offline: try everything again later
              continue; // config problem: keep it and surface the error
            }
            // 409: the row can never be written (e.g. its principle was deleted); drop it.
          }
          // Remove this op unless it was replaced by a newer version meanwhile.
          writeOutbox(readOutbox().filter((item) => !(item.key === op.key && item.stamp === op.stamp)));
        }
      } while (flushAgain && !error?.network);
      lastError = error;
    })().finally(() => {
      flushing = null;
      notify();
    });
    return flushing;
  }

  async function queuedWrite(key, table, row, onConflict, ignore = false) {
    const stamp = `${Date.now()}-${Math.random()}`;
    enqueue({ key, stamp, table, row, onConflict, ignore });
    await flush();
    const queued = readOutbox().some((item) => item.key === key);
    return { row, queued };
  }

  // Show not-yet-synced writes to the person who made them.
  function withPending(table, rows, keyFn, filter = () => true) {
    const pending = readOutbox().filter((op) => op.table === table && filter(op.row));
    if (!pending.length) return rows;
    const map = new Map(rows.map((r) => [keyFn(r), r]));
    for (const op of pending) map.set(keyFn(op.row), { ...map.get(keyFn(op.row)), ...op.row });
    return [...map.values()];
  }

  // Keep retrying in the background.
  const retry = setInterval(() => {
    if (readOutbox().length) flush();
  }, 8000);
  retry.unref?.(); // (Node only: don't keep test processes alive)
  globalThis.addEventListener?.('online', () => flush());
  if (readOutbox().length) flush();

  const now = () => new Date().toISOString();

  return {
    kind: 'supabase',
    label: 'Supabase (shared)',
    persistent: true,

    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    pendingCount: () => readOutbox().length,
    lastError: () => lastError,
    readOk: () => readOk,
    flush,

    async listParticipants({ cache = false } = {}) {
      const rows = await cachedRead('participants', cache, () => listAll('participants'));
      return withPending('participants', rows, (r) => r.code);
    },
    async listResponses({ participant, cache = false } = {}) {
      const filter = participant ? `&participant_code=eq.${encodeURIComponent(participant)}` : '';
      const rows = await cachedRead(`responses:${participant || '*'}`, cache, () => listAll('responses', filter));
      return withPending('responses', rows, responseKey, (r) => !participant || r.participant_code === participant);
    },
    async listPrinciples({ cache = false } = {}) {
      const rows = await cachedRead('principles', cache, () => listAll('principles'));
      return withPending('principles', rows, (r) => r.id);
    },
    async listVotes({ participant, cache = false } = {}) {
      const filter = participant ? `&participant_code=eq.${encodeURIComponent(participant)}` : '';
      const rows = await cachedRead(`votes:${participant || '*'}`, cache, () => listAll('votes', filter));
      return withPending('votes', rows, voteKey, (r) => !participant || r.participant_code === participant);
    },

    addParticipant(person) {
      const row = { workshop, code: person.code, name: person.name, cases: person.cases, guest: Boolean(person.guest) };
      return queuedWrite(`participants:${row.code}`, 'participants', row, 'workshop,code', true);
    },
    async removeParticipant(code) {
      await request('DELETE', `participants?${ws}&code=eq.${encodeURIComponent(code)}`);
    },
    saveResponse(response) {
      const row = {
        workshop,
        participant_code: response.participant_code,
        case_id: response.case_id,
        decision: response.decision,
        rationale: response.rationale || '',
        tags: response.tags || [],
        other_tag: response.other_tag || null,
        confidence: response.confidence ?? null,
        updated_at: now(),
      };
      return queuedWrite(`responses:${responseKey(row)}`, 'responses', row, 'workshop,participant_code,case_id');
    },
    addPrinciple(principle) {
      const row = { ...principle, workshop, updated_at: now() };
      return queuedWrite(`principles:${row.id}`, 'principles', row, 'id', true);
    },
    async updatePrinciple(id, patch) {
      const rows = await request('PATCH', `principles?id=eq.${encodeURIComponent(id)}`, {
        body: { ...patch, updated_at: now() },
        prefer: 'return=representation',
      });
      if (!rows?.length) throw new StoreError('That principle no longer exists.');
      return rows[0];
    },
    async deletePrinciple(id) {
      await request('DELETE', `principles?id=eq.${encodeURIComponent(id)}`);
    },
    saveVote(vote) {
      const row = {
        workshop,
        principle_id: vote.principle_id,
        version: vote.version,
        participant_code: vote.participant_code,
        vote: vote.vote,
        comment: vote.comment || null,
        updated_at: now(),
      };
      return queuedWrite(`votes:${voteKey(row)}`, 'votes', row, 'principle_id,version,participant_code');
    },

    // Setup-tab connection test: read every table, then write (and delete) a
    // test row in each one, in a separate workshop space so nothing leaks into
    // the real results.
    async check() {
      const results = [];
      for (const table of TABLES) {
        try {
          const rows = await request('GET', `${table}?select=*&${ws}&limit=1`);
          results.push({ table: `${table}: read`, ok: Array.isArray(rows), message: 'OK' });
        } catch (err) {
          results.push({ table: `${table}: read`, ok: false, message: err.message });
        }
      }
      const probe = `${workshop}--connection-test`;
      const principleId = uuid();
      const writes = {
        participants: () => upsert('participants', { workshop: probe, code: 'probe', name: 'Connection test', cases: [], guest: true }, 'workshop,code'),
        responses: () => upsert('responses', { workshop: probe, participant_code: 'probe', case_id: 'probe', decision: 'probe', rationale: '', tags: [] }, 'workshop,participant_code,case_id'),
        principles: () => upsert('principles', { id: principleId, workshop: probe, text: 'Connection test', category: 'unsorted', position: 0, status: 'proposed', version: 1 }, 'id'),
        votes: () => upsert('votes', { workshop: probe, principle_id: principleId, version: 1, participant_code: 'probe', vote: 'agree' }, 'principle_id,version,participant_code'),
      };
      for (const table of TABLES) {
        try {
          await writes[table]();
          results.push({ table: `${table}: write`, ok: true, message: 'OK' });
        } catch (err) {
          results.push({ table: `${table}: write`, ok: false, message: err.message });
        }
      }
      for (const table of ['votes', 'principles', 'responses', 'participants']) {
        try {
          await request('DELETE', `${table}?workshop=eq.${encodeURIComponent(probe)}`);
        } catch {
          // Leftover test rows live in their own workshop space; harmless.
        }
      }
      return results;
    },
  };
}

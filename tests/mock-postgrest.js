// An in-memory imitation of the small part of Supabase's REST API (PostgREST)
// that the app uses, for tests. Mirrors supabase/schema.sql: primary keys,
// unique constraints, the votes -> principles foreign key, column checks and
// the key rules (publishable keys must not be sent as a bearer token).
//
//   const mock = await startMockPostgrest({ key: 'sb_publishable_test' });
//   ... mock.url, mock.tables, mock.requests, mock.failNext(n), mock.offline = true
//   await mock.close();

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const SCHEMA = {
  participants: {
    columns: ['workshop', 'code', 'name', 'cases', 'guest', 'created_at'],
    defaults: { cases: () => [], guest: () => false, created_at: () => new Date().toISOString() },
    unique: [['workshop', 'code']],
  },
  responses: {
    columns: ['id', 'workshop', 'participant_code', 'case_id', 'decision', 'rationale', 'tags', 'other_tag', 'confidence', 'created_at', 'updated_at'],
    defaults: { id: () => randomUUID(), rationale: () => '', tags: () => [], other_tag: () => null, confidence: () => null, created_at: () => new Date().toISOString(), updated_at: () => new Date().toISOString() },
    unique: [['id'], ['workshop', 'participant_code', 'case_id']],
    check: (row) => row.confidence == null || (row.confidence >= 1 && row.confidence <= 5),
  },
  principles: {
    columns: ['id', 'workshop', 'text', 'category', 'position', 'status', 'version', 'source_case_id', 'proposed_by', 'created_at', 'updated_at'],
    defaults: { id: () => randomUUID(), category: () => 'unsorted', position: () => 0, status: () => 'proposed', version: () => 1, source_case_id: () => null, proposed_by: () => null, created_at: () => new Date().toISOString(), updated_at: () => new Date().toISOString() },
    unique: [['id']],
    check: (row) => ['proposed', 'voting', 'ratified', 'parked'].includes(row.status),
  },
  votes: {
    columns: ['id', 'workshop', 'principle_id', 'version', 'participant_code', 'vote', 'comment', 'created_at', 'updated_at'],
    defaults: { id: () => randomUUID(), comment: () => null, created_at: () => new Date().toISOString(), updated_at: () => new Date().toISOString() },
    unique: [['id'], ['principle_id', 'version', 'participant_code']],
  },
};

const REQUIRED = {
  participants: ['workshop', 'code', 'name'],
  responses: ['workshop', 'participant_code', 'case_id', 'decision'],
  principles: ['workshop', 'text'],
  votes: ['workshop', 'principle_id', 'version', 'participant_code', 'vote'],
};

function parseFilters(params) {
  const filters = [];
  for (const [key, value] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    const m = /^(eq|neq|gt|lt)\.(.*)$/s.exec(value);
    if (!m) throw { status: 400, body: { code: 'PGRST100', message: `failed to parse filter (${value})` } };
    filters.push({ column: key, op: m[1], value: m[2] });
  }
  return filters;
}

function matches(row, filters) {
  return filters.every(({ column, op, value }) => {
    const v = row[column] == null ? null : String(row[column]);
    if (op === 'eq') return v === value;
    if (op === 'neq') return v !== value;
    if (op === 'gt') return v > value;
    if (op === 'lt') return v < value;
    return false;
  });
}

export async function startMockPostgrest({ key = 'sb_publishable_test', port = 0 } = {}) {
  const tables = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]));
  const requests = [];
  const state = { failures: 0, offline: false };

  const keyOf = (table, row, cols) => cols.map((c) => JSON.stringify(row[c])).join('|');

  function validate(table, row) {
    const schema = SCHEMA[table];
    for (const col of Object.keys(row)) {
      if (!schema.columns.includes(col)) {
        throw { status: 400, body: { code: 'PGRST204', message: `Could not find the '${col}' column of '${table}' in the schema cache` } };
      }
    }
    for (const col of REQUIRED[table]) {
      if (row[col] == null) throw { status: 400, body: { code: '23502', message: `null value in column "${col}" violates not-null constraint` } };
    }
    if (schema.check && !schema.check(row)) throw { status: 400, body: { code: '23514', message: `new row for relation "${table}" violates check constraint` } };
    if (table === 'votes' && !tables.principles.some((p) => p.id === row.principle_id)) {
      throw { status: 409, body: { code: '23503', message: 'insert or update on table "votes" violates foreign key constraint' } };
    }
  }

  function findConflict(table, row, ignoreIndex = -1) {
    for (const cols of SCHEMA[table].unique) {
      const k = keyOf(table, row, cols);
      const index = tables[table].findIndex((r, i) => i !== ignoreIndex && keyOf(table, r, cols) === k);
      if (index !== -1) return { index, cols };
    }
    return null;
  }

  function insert(table, body, { onConflict, resolution }) {
    const schema = SCHEMA[table];
    const rows = Array.isArray(body) ? body : [body];
    const out = [];
    if (onConflict) {
      const cols = onConflict.split(',');
      if (!schema.unique.some((u) => u.length === cols.length && u.every((c) => cols.includes(c)))) {
        throw { status: 400, body: { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } };
      }
    }
    for (const incoming of rows) {
      const full = { ...Object.fromEntries(Object.entries(schema.defaults).map(([c, fn]) => [c, fn()])), ...incoming };
      validate(table, full);
      const cols = onConflict ? onConflict.split(',') : null;
      const existingIndex = cols ? tables[table].findIndex((r) => keyOf(table, r, cols) === keyOf(table, full, cols)) : -1;
      if (existingIndex !== -1 && resolution === 'ignore-duplicates') continue;
      if (existingIndex !== -1 && resolution === 'merge-duplicates') {
        const merged = { ...tables[table][existingIndex], ...incoming };
        validate(table, merged);
        tables[table][existingIndex] = merged;
        out.push(merged);
        continue;
      }
      if (findConflict(table, full)) {
        throw { status: 409, body: { code: '23505', message: `duplicate key value violates unique constraint on "${table}"` } };
      }
      tables[table].push(full);
      out.push(full);
    }
    return out;
  }

  function cascadeDelete(table, removed) {
    if (table !== 'principles') return;
    const ids = new Set(removed.map((p) => p.id));
    tables.votes = tables.votes.filter((v) => !ids.has(v.principle_id));
  }

  const server = createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    };
    const send = (status, body) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') return send(204);

    let raw = '';
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, 'http://localhost');

    // Test control, for driving the mock from a browser session:
    //   /__control?offline=1   drop every connection until /__control?offline=0
    //   /__control?fail=2      answer the next two requests with HTTP 503
    if (url.pathname === '/__control') {
      if (url.searchParams.has('offline')) state.offline = url.searchParams.get('offline') === '1';
      if (url.searchParams.has('fail')) state.failures = Number(url.searchParams.get('fail'));
      return send(200, { offline: state.offline, failures: state.failures });
    }

    requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body: raw ? JSON.parse(raw) : null });

    if (state.offline) {
      req.socket.destroy();
      return;
    }
    if (state.failures > 0) {
      state.failures--;
      return send(503, { message: 'Service unavailable (simulated)' });
    }

    const apikey = req.headers.apikey;
    const auth = req.headers.authorization;
    if (apikey !== key) return send(401, { message: 'Invalid API key' });
    if (key.startsWith('sb_') && auth) return send(401, { message: 'Publishable keys must not be sent as a bearer token' });

    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (!m || !SCHEMA[m[1]]) return send(404, { code: 'PGRST205', message: `Could not find the table 'public.${m?.[1]}' in the schema cache` });
    const table = m[1];
    const prefer = req.headers.prefer || '';
    const returnRows = prefer.includes('return=representation');

    try {
      const params = url.searchParams;
      const filters = parseFilters(params);
      if (req.method === 'GET') {
        let rows = tables[table].filter((r) => matches(r, filters));
        const order = params.get('order');
        if (order) {
          const keys = order.split(',').map((o) => o.split('.'));
          rows = rows.slice().sort((a, b) => {
            for (const [col, dir] of keys) {
              const x = String(a[col] ?? '');
              const y = String(b[col] ?? '');
              if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
            }
            return 0;
          });
        }
        const offset = Number(params.get('offset') || 0);
        const limit = params.has('limit') ? Number(params.get('limit')) : Infinity;
        return send(200, rows.slice(offset, offset + limit));
      }
      if (req.method === 'POST') {
        const resolution = /resolution=(merge-duplicates|ignore-duplicates)/.exec(prefer)?.[1];
        const out = insert(table, JSON.parse(raw), { onConflict: params.get('on_conflict'), resolution });
        return returnRows ? send(201, out) : send(201);
      }
      if (req.method === 'PATCH') {
        const patch = JSON.parse(raw);
        const out = [];
        tables[table].forEach((row, i) => {
          if (!matches(row, filters)) return;
          const merged = { ...row, ...patch };
          validate(table, merged);
          if (findConflict(table, merged, i)) throw { status: 409, body: { code: '23505', message: 'duplicate key' } };
          tables[table][i] = merged;
          out.push(merged);
        });
        return returnRows ? send(200, out) : send(204);
      }
      if (req.method === 'DELETE') {
        const removed = tables[table].filter((r) => matches(r, filters));
        tables[table] = tables[table].filter((r) => !matches(r, filters));
        cascadeDelete(table, removed);
        return returnRows ? send(200, removed) : send(204);
      }
      return send(405, { message: 'Method not allowed' });
    } catch (err) {
      if (err?.status) return send(err.status, err.body);
      return send(500, { message: String(err?.message || err) });
    }
  });

  await new Promise((resolve) => server.listen(port, 'localhost', resolve));
  const address = server.address();
  return {
    url: `http://localhost:${address.port}`,
    key,
    tables,
    requests,
    failNext(n = 1) {
      state.failures = n;
    },
    set offline(value) {
      state.offline = value;
    },
    reset() {
      for (const t of Object.keys(tables)) tables[t].length = 0;
      requests.length = 0;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

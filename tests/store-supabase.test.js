// The Supabase adapter against an imitation of the Supabase REST API.

import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './helpers.js';
import { startMockPostgrest } from './mock-postgrest.js';

installLocalStorage();
const { createSupabaseStore } = await import('../js/store-supabase.js');

let mock;
before(async () => {
  mock = await startMockPostgrest({ key: 'sb_publishable_test' });
});
after(() => mock.close());
beforeEach(() => {
  mock.reset();
  mock.offline = false;
  localStorage.clear();
});

const make = (opts = {}) => createSupabaseStore({ url: mock.url, key: mock.key, workshop: 'ws1', ...opts });
const answer = (code, caseId, decision = 'core', extra = {}) => ({
  participant_code: code,
  case_id: caseId,
  decision,
  rationale: 'because',
  tags: ['evidence'],
  confidence: 3,
  ...extra,
});

test('publishable keys are sent only as apikey; legacy JWT keys also as a bearer token', async () => {
  await make().listResponses();
  const req = mock.requests.at(-1);
  assert.equal(req.headers.apikey, 'sb_publishable_test');
  assert.equal(req.headers.authorization, undefined);

  const legacy = await startMockPostgrest({ key: 'eyJhbGciOiJIUzI1NiJ9.legacy.key' });
  try {
    await createSupabaseStore({ url: legacy.url, key: legacy.key, workshop: 'ws1' }).listResponses();
    assert.equal(legacy.requests.at(-1).headers.authorization, `Bearer ${legacy.key}`);
  } finally {
    await legacy.close();
  }
});

test('responses upsert on (workshop, participant, case) and keep created_at', async () => {
  const store = make();
  const first = await store.saveResponse(answer('amara', 'case-a', 'core'));
  assert.equal(first.queued, false);
  const createdAt = mock.tables.responses[0].created_at;
  await store.saveResponse(answer('amara', 'case-a', 'no', { rationale: 'changed my mind' }));
  await store.saveResponse(answer('ben', 'case-a', 'extension'));

  assert.equal(mock.tables.responses.length, 2);
  const amara = mock.tables.responses.find((r) => r.participant_code === 'amara');
  assert.equal(amara.decision, 'no');
  assert.equal(amara.rationale, 'changed my mind');
  assert.equal(amara.created_at, createdAt);
  assert.deepEqual(amara.tags, ['evidence']);

  const mine = await store.listResponses({ participant: 'amara' });
  assert.equal(mine.length, 1);
  assert.equal((await store.listResponses()).length, 2);
});

test('rows from other workshops are invisible', async () => {
  await make({ workshop: 'dry-run' }).saveResponse(answer('amara', 'case-a'));
  assert.equal((await make().listResponses()).length, 0);
  assert.equal((await make({ workshop: 'dry-run' }).listResponses()).length, 1);
});

test('principles: idempotent insert, update, delete cascades to votes', async () => {
  const store = make();
  const principle = { id: '11111111-1111-4111-8111-111111111111', text: 'Be general.', category: 'scope', position: 1, status: 'proposed', version: 1, source_case_id: null, proposed_by: 'facilitator' };
  await store.addPrinciple(principle);
  await store.addPrinciple(principle); // a retry must not duplicate it
  assert.equal(mock.tables.principles.length, 1);

  const updated = await store.updatePrinciple(principle.id, { status: 'voting', text: 'Be general enough.', version: 2 });
  assert.equal(updated.status, 'voting');
  assert.equal(updated.version, 2);

  await store.saveVote({ principle_id: principle.id, version: 2, participant_code: 'amara', vote: 'agree' });
  await store.saveVote({ principle_id: principle.id, version: 2, participant_code: 'amara', vote: 'amend', comment: 'Wording?' });
  await store.saveVote({ principle_id: principle.id, version: 2, participant_code: 'ben', vote: 'disagree' });
  const votes = await store.listVotes();
  assert.equal(votes.length, 2);
  assert.equal(votes.find((v) => v.participant_code === 'amara').vote, 'amend');
  assert.equal((await store.listVotes({ participant: 'ben' })).length, 1);

  await store.deletePrinciple(principle.id);
  assert.equal(mock.tables.principles.length, 0);
  assert.equal(mock.tables.votes.length, 0);
  await assert.rejects(store.updatePrinciple(principle.id, { status: 'ratified' }), /no longer exists/);
});

test('participants: first join wins, later joins keep the locked cases', async () => {
  const store = make();
  await store.addParticipant({ code: 'amara', name: 'Amara', cases: ['a', 'b'] });
  await store.addParticipant({ code: 'amara', name: 'Amara', cases: ['c', 'd'] });
  const people = await store.listParticipants();
  assert.equal(people.length, 1);
  assert.deepEqual(people[0].cases, ['a', 'b']);
});

test('offline writes are kept, shown to their author, and synced when back online', async () => {
  const store = make();
  mock.offline = true;
  const result = await store.saveResponse(answer('amara', 'case-a', 'experimental'));
  assert.equal(result.queued, true);
  assert.equal(store.pendingCount(), 1);
  assert.equal(store.lastError()?.network, true);
  assert.equal(mock.tables.responses.length, 0);

  mock.offline = false;
  const mine = await store.listResponses({ participant: 'amara' });
  assert.equal(mine.length, 1, 'pending answer is visible to its author');
  assert.equal(mine[0].decision, 'experimental');

  await store.flush();
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.lastError(), null);
  assert.equal(mock.tables.responses.length, 1);
});

test('a newer answer replaces an older unsynced one', async () => {
  const store = make();
  mock.offline = true;
  await store.saveResponse(answer('amara', 'case-a', 'core'));
  await store.saveResponse(answer('amara', 'case-a', 'no'));
  assert.equal(store.pendingCount(), 1);
  mock.offline = false;
  await store.flush();
  assert.equal(mock.tables.responses.length, 1);
  assert.equal(mock.tables.responses[0].decision, 'no');
});

test('server errors (503) are retried; the outbox survives a page reload', async () => {
  mock.failNext(1);
  const result = await make().saveVote({ principle_id: 'nope', version: 1, participant_code: 'a', vote: 'agree' });
  assert.equal(result.queued, true);
  // "Reload": a fresh store instance reads the same localStorage outbox.
  const reloaded = make();
  assert.equal(reloaded.pendingCount(), 1);
  await reloaded.flush();
  // The principle doesn't exist (409 foreign key): the vote is dropped, not retried forever.
  assert.equal(reloaded.pendingCount(), 0);
});

test('a wrong key gives a helpful error and keeps the write queued', async () => {
  const store = make({ key: 'sb_publishable_wrong' });
  await assert.rejects(store.listResponses(), /refused access.*supabaseKey/);
  const result = await store.saveResponse(answer('amara', 'case-a'));
  assert.equal(result.queued, true);
  assert.match(store.lastError().message, /supabaseKey/);
});

test('connection check reads and writes every table, then cleans up', async () => {
  const results = await make().check();
  assert.equal(results.length, 8);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  for (const table of ['participants', 'responses', 'principles', 'votes']) assert.equal(mock.tables[table].length, 0, table);
});

test('the connection check reports a table the key cannot write to', async () => {
  const results = await make({ key: 'sb_publishable_wrong' }).check();
  assert.ok(results.every((r) => !r.ok));
});

test('a response body that stalls half-way times out instead of hanging', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.write('[{"id":'); // ...and never finish
  });
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const store = createSupabaseStore({ url: `http://localhost:${server.address().port}`, key: 'sb_publishable_test', workshop: 'ws1', timeout: 400 });
  const started = Date.now();
  await assert.rejects(store.listPrinciples(), (err) => err.network === true);
  assert.ok(Date.now() - started < 5000);
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

test('if localStorage refuses writes, the outbox still sends them', async () => {
  const realSet = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  try {
    const result = await make().saveResponse(answer('amara', 'case-a'));
    assert.equal(result.queued, false);
    assert.equal(mock.tables.responses.length, 1);
  } finally {
    localStorage.setItem = realSet;
  }
});

test('synced writes are added to the read cache, so an offline reload still shows them', async () => {
  const store = make();
  await store.listResponses({ participant: 'amara', cache: true }); // cache: []
  await store.saveResponse(answer('amara', 'case-a', 'core'));
  mock.offline = true;
  const reloaded = make();
  const mine = await reloaded.listResponses({ participant: 'amara', cache: true });
  assert.equal(mine.length, 1);
  assert.equal(mine[0].decision, 'core');
  assert.equal(reloaded.readOk(), false);
});

test('a dropped write (409) does not leave an error behind', async () => {
  const store = make();
  await store.saveVote({ principle_id: '00000000-0000-4000-8000-000000000000', version: 1, participant_code: 'a', vote: 'agree' });
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.lastError(), null);
});

test('lists page through more than 1000 rows', async () => {
  for (let i = 0; i < 1203; i++) {
    mock.tables.votes.push({ id: `v${i}`, workshop: 'ws1', principle_id: 'p', version: 1, participant_code: `p${i}`, vote: 'agree', created_at: new Date(1e12 + i).toISOString() });
  }
  const votes = await make().listVotes();
  assert.equal(votes.length, 1203);
  assert.equal(new Set(votes.map((v) => v.id)).size, 1203);
});

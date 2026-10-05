// Demo-mode storage should behave like the Supabase tables.

import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorage } from './helpers.js';

installLocalStorage();
const { createLocalStore } = await import('../js/store-local.js');

beforeEach(() => localStorage.clear());

test('responses upsert per participant and case, keeping created_at', async () => {
  const store = createLocalStore('ws1');
  const { row } = await store.saveResponse({ participant_code: 'a', case_id: 'c1', decision: 'core' });
  await store.saveResponse({ participant_code: 'a', case_id: 'c1', decision: 'no' });
  const rows = await store.listResponses();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'no');
  assert.equal(rows[0].created_at, row.created_at);
  assert.equal((await store.listResponses({ participant: 'b' })).length, 0);
});

test('participants keep the first assignment; workshops are separate', async () => {
  const store = createLocalStore('ws1');
  await store.addParticipant({ code: 'a', name: 'A', cases: ['1'] });
  await store.addParticipant({ code: 'a', name: 'A', cases: ['2'] });
  assert.deepEqual((await store.listParticipants())[0].cases, ['1']);
  assert.equal((await createLocalStore('ws2').listParticipants()).length, 0);
});

test('deleting a principle removes its votes; voting on a missing principle fails', async () => {
  const store = createLocalStore('ws1');
  await store.addPrinciple({ id: 'p1', text: 'x', category: 'scope', position: 1, status: 'voting', version: 1 });
  await store.saveVote({ principle_id: 'p1', version: 1, participant_code: 'a', vote: 'agree' });
  await store.saveVote({ principle_id: 'p1', version: 1, participant_code: 'a', vote: 'amend' });
  assert.equal((await store.listVotes()).length, 1);
  await store.updatePrinciple('p1', { status: 'ratified' });
  assert.equal((await store.listPrinciples())[0].status, 'ratified');
  await store.deletePrinciple('p1');
  assert.equal((await store.listVotes()).length, 0);
  await assert.rejects(store.saveVote({ principle_id: 'p1', version: 1, participant_code: 'a', vote: 'agree' }));
});

test('clearAll only clears this workshop', async () => {
  const a = createLocalStore('ws1');
  const b = createLocalStore('ws2');
  await a.saveResponse({ participant_code: 'a', case_id: 'c1', decision: 'core' });
  await b.saveResponse({ participant_code: 'a', case_id: 'c1', decision: 'core' });
  await a.clearAll();
  assert.equal((await a.listResponses()).length, 0);
  assert.equal((await b.listResponses()).length, 1);
});

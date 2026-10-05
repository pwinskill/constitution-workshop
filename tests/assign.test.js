import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignGuest, coverageCounts, currentAssignments, planAssignments } from '../js/assign.js';
import { realConfig } from './helpers.js';

const config = realConfig();
const caseIds = config.cases.map((c) => c.id);
// The shipped participants.json is empty (people type their names), so use a made-up list.
const roster = Array.from({ length: 16 }, (_, i) => ({ code: `person-${i + 1}`, name: `Person ${i + 1}` }));

test('every participant gets the configured number of distinct cases', () => {
  const plan = planAssignments(roster, caseIds, config.assignment);
  assert.equal(plan.size, roster.length);
  for (const cases of plan.values()) {
    assert.equal(cases.length, config.assignment.perParticipant);
    assert.equal(new Set(cases).size, cases.length);
    for (const c of cases) assert.ok(caseIds.includes(c));
  }
});

test('coverage is balanced: case review counts differ by at most one', () => {
  for (const people of [5, 9, 16, 23]) {
    const list = Array.from({ length: people }, (_, i) => ({ code: `p${i}` }));
    for (const k of [3, 4, 5]) {
      const plan = planAssignments(list, caseIds, { perParticipant: k, seed: 7 });
      const counts = [...coverageCounts(plan, caseIds).values()];
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${people} people x ${k} cases: ${counts}`);
    }
  }
});

test('the plan is deterministic and appending people does not change earlier assignments', () => {
  const a = planAssignments(roster, caseIds, config.assignment);
  const b = planAssignments(roster, caseIds, config.assignment);
  assert.deepEqual([...a.entries()], [...b.entries()]);

  const longer = [...roster, { code: 'late-arrival', name: 'Late arrival' }];
  const c = planAssignments(longer, caseIds, config.assignment);
  for (const person of roster) assert.deepEqual(c.get(person.code), a.get(person.code));
});

test('fixed assignments from the roster are respected and counted', () => {
  const withFixed = [{ code: 'fixed', cases: [caseIds[0], caseIds[1]] }, ...roster];
  const plan = planAssignments(withFixed, caseIds, config.assignment);
  assert.deepEqual(plan.get('fixed'), [caseIds[0], caseIds[1]]);
});

test('locked assignments override the plan', () => {
  const plan = planAssignments(roster, caseIds, config.assignment);
  const current = currentAssignments(plan, [{ code: roster[0].code, cases: ['x'] }]);
  assert.deepEqual(current.get(roster[0].code), ['x']);
  assert.deepEqual(current.get(roster[1].code), plan.get(roster[1].code));
});

test('with no list, people joining one at a time still get balanced coverage', () => {
  for (const k of [3, 4, 6]) {
    const assigned = new Map();
    for (let n = 1; n <= 20; n++) {
      const code = `joiner-${n}`;
      const cases = assignGuest(code, caseIds, assigned, { perParticipant: k, seed: 7 });
      assert.equal(new Set(cases).size, k);
      assigned.set(code, cases);
      const counts = [...coverageCounts(assigned, caseIds).values()];
      assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${n} people x ${k} cases: ${counts}`);
    }
  }
});

test('guests get the least-covered cases', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const current = new Map([['p1', ['a', 'b', 'c']], ['p2', ['a', 'b']], ['p3', ['a']]]);
  assert.deepEqual(assignGuest('g', ids, current, { perParticipant: 2, seed: 1 }).sort(), ['d', 'e']);
  assert.deepEqual(assignGuest('g', ids, current, { perParticipant: 3, seed: 1 }).sort(), ['c', 'd', 'e']);
});

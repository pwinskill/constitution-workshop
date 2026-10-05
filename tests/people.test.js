import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPerson } from '../js/people.js';

const joined = [
  { code: 'ross-b2c3', name: 'Ross', created_at: '2026-10-05T10:05:00Z' },
  { code: 'ross-a1b2', name: 'Ross', created_at: '2026-10-05T10:01:00Z' },
  { code: 'jose-k9k9', name: 'José', created_at: '2026-10-05T10:02:00Z' },
  { code: 'p-xyz', name: '!!!', created_at: '2026-10-05T10:03:00Z' },
];

test('a name that more than one person joined with returns all of them, oldest first', () => {
  const { person, matches } = matchPerson('ross', joined);
  assert.equal(person, null);
  assert.deepEqual(matches.map((p) => p.code), ['ross-a1b2', 'ross-b2c3']);
});

test('a personal code joins directly', () => {
  assert.equal(matchPerson('ross-b2c3', joined).person.code, 'ross-b2c3');
  assert.equal(matchPerson('  ROSS-B2C3 ', joined).person.code, 'ross-b2c3');
});

test('capitals and accents are ignored when comparing names; blank input matches nobody', () => {
  assert.deepEqual(matchPerson('JOSE', joined).matches.map((p) => p.code), ['jose-k9k9']);
  assert.deepEqual(matchPerson('   ', joined), { person: null, matches: [] });
  assert.deepEqual(matchPerson('Ross B', joined), { person: null, matches: [] });
});

test('names that are only symbols are still told apart', () => {
  assert.deepEqual(matchPerson('!!!', joined).matches.map((p) => p.code), ['p-xyz']);
  assert.deepEqual(matchPerson('???', joined).matches, []);
});

test('a listed name joins directly, even if a guest has the same name', () => {
  const people = [{ code: 'amara', name: 'Amara' }, { code: 'amara-zz11', name: 'Amara', created_at: '2026-10-05T10:00:00Z' }];
  const { person, matches } = matchPerson('Amara', people, new Set(['amara']));
  assert.equal(person.code, 'amara');
  assert.deepEqual(matches, []);
});

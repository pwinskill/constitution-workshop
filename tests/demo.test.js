import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coverageCounts, planAssignments } from '../js/assign.js';
import { generateDemo } from '../js/demo.js';
import { realConfig } from './helpers.js';

const config = realConfig();
const caseIds = config.cases.map((c) => c.id);

test('with no names list, the demo brings its own people and shares cases out evenly', () => {
  assert.equal(config.roster.length, 0);
  const demo = generateDemo(config, new Map());
  const names = demo.participants.map((p) => p.name);
  assert.ok(names.includes('Ross') && names.includes('Macdonald'));
  assert.equal(new Set(demo.participants.map((p) => p.code)).size, demo.participants.length);
  const assigned = new Map(demo.participants.map((p) => [p.code, p.cases]));
  const counts = [...coverageCounts(assigned, caseIds).values()];
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, String(counts));
  assert.ok(Math.min(...counts) >= config.assignment.minReviews);
  const codes = new Set(demo.participants.map((p) => p.code));
  assert.ok(demo.responses.length > 0 && demo.responses.every((r) => codes.has(r.participant_code)));
  assert.ok(demo.votes.every((v) => codes.has(v.participant_code)));
});

test('with a names list, the demo uses those people and their planned cases', () => {
  const listed = realConfig();
  listed.roster = [{ code: 'ross', name: 'Ross', cases: null }, { code: 'macdonald', name: 'Macdonald', cases: null }];
  const plan = planAssignments(listed.roster, caseIds, listed.assignment);
  const demo = generateDemo(listed, plan);
  assert.deepEqual(demo.participants.map((p) => p.name), ['Ross', 'Macdonald']);
  assert.deepEqual(demo.participants[0].cases, plan.get('ross'));
  assert.ok(demo.participants.every((p) => p.guest === false));
});

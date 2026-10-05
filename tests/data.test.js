import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseConfig } from '../js/data.js';
import { suggestionsFor } from '../js/suggest.js';
import { realConfig } from './helpers.js';

test('the shipped data files load cleanly', () => {
  const config = realConfig();
  assert.deepEqual(config.warnings, []);
  assert.ok(config.cases.length >= 5);
  assert.ok(config.assignment.perParticipant <= config.cases.length);
  assert.ok(config.cases.every((c) => c.title && c.summary), 'every case has a title and summary');
  assert.ok(config.cases.every((c) => c.suggestedPrinciple), 'every case has a suggested principle');
  const sections = new Set(config.categories.map((c) => c.id));
  assert.ok(config.cases.every((c) => sections.has(c.suggestedSection)), 'every suggestion names a real section');
  assert.equal(config.decisions.map((d) => d.label).join(' '), 'CORE EXTENSION EXPERIMENTAL NO');
  assert.equal(config.backend, 'local');
  assert.equal(new Set(config.roster.map((p) => p.code)).size, config.roster.length);
});

test('every section of the constitution has at least one suggested principle', () => {
  const config = realConfig();
  for (const section of config.categories) {
    assert.ok(suggestionsFor(config, [], section.id).length, `nothing suggests a principle for "${section.heading}"`);
  }
});

test('section suggestions must be text; schedule times and the minimum reviewers are checked', () => {
  const config = normaliseConfig({
    categories: [{ id: 'a', suggestedPrinciple: '  Padded.  ' }, { id: 'b', suggestedPrinciple: ['x', 'y'] }, { id: 'c' }],
    schedule: { _readme: 'notes', review: 10, discuss: -5, tidy: 0, vote: 'soon' },
    assignment: { minReviewsPerCase: 2.5 },
  });
  assert.deepEqual(config.categories.map((c) => c.suggestedPrinciple), ['Padded.', '', '']);
  assert.deepEqual(config.schedule, { review: 10, discuss: 30, tidy: 0, vote: 20, finish: 5 });
  assert.equal(config.assignment.minReviews, 3);
  const warnings = config.warnings.join('\n');
  for (const expected of [/"b" section/, /schedule\.discuss/, /schedule\.vote/, /minReviewsPerCase/]) assert.match(warnings, expected);
  assert.doesNotMatch(warnings, /schedule\.(review|tidy|_readme)/);
  assert.equal(normaliseConfig({ assignment: { minReviewsPerCase: 0 } }).assignment.minReviews, 0);
});

test('Supabase is used only when both URL and key are set, and ?backend=local overrides', () => {
  const storage = { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'sb_publishable_x' };
  assert.equal(normaliseConfig({ storage }).backend, 'supabase');
  assert.equal(normaliseConfig({ storage: { ...storage, supabaseKey: '' } }).backend, 'local');
  assert.equal(normaliseConfig({ storage }, {}, {}, new URLSearchParams('backend=local')).backend, 'local');
});

test('?ws= overrides the workshop id', () => {
  assert.equal(normaliseConfig({ id: 'real' }, {}, {}, new URLSearchParams('ws=Dry Run')).id, 'dry-run');
});

test('cases marked "active": false are left out, and numbering skips them', () => {
  const config = normaliseConfig(
    { assignment: { casesPerParticipant: 5 } },
    { cases: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B', active: false }, { id: 'c', title: 'C', active: true }] },
    { participants: [{ name: 'Sam', cases: ['a', 'b'] }] },
  );
  assert.deepEqual(config.cases.map((c) => [c.id, c.number]), [['a', 1], ['c', 2]]);
  assert.deepEqual(config.inactiveCases.map((c) => c.id), ['b']);
  assert.equal(config.assignment.perParticipant, 2, 'capped at the number of cases in use');
  assert.deepEqual(config.roster[0].cases, ['a']);
  assert.ok(config.warnings.some((w) => w.includes('switched off')));
});

test('suggested principles are optional; unknown sections fall back to unsorted with a warning', () => {
  const config = normaliseConfig(
    { categories: [{ id: 'scope', label: 'Scope' }] },
    { cases: [{ id: 'a', title: 'A', suggestedPrinciple: '  Keep it lean. ', suggestedSection: 'nope' }, { id: 'b', title: 'B' }] },
  );
  assert.equal(config.cases[0].suggestedPrinciple, 'Keep it lean.');
  assert.equal(config.cases[0].suggestedSection, 'unsorted');
  assert.equal(config.cases[1].suggestedPrinciple, '');
  assert.ok(config.warnings.some((w) => w.includes('nope')));
});

test('problems in the data files become warnings, not crashes', () => {
  const config = normaliseConfig(
    {},
    { cases: [{ id: 'a', title: 'A' }, { id: 'a', title: 'Duplicate' }, { title: 'No id' }] },
    { participants: [{ name: 'Sam' }, { name: 'sam' }, { name: 'Kim', cases: ['a', 'missing'] }] },
  );
  assert.equal(config.cases.length, 3);
  assert.equal(new Set(config.cases.map((c) => c.id)).size, 3);
  assert.equal(new Set(config.roster.map((p) => p.code)).size, 3);
  assert.deepEqual(config.roster[2].cases, ['a']);
  assert.ok(config.warnings.length >= 4);
});

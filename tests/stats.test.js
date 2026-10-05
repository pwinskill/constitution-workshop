import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caseStats, disagreementIndex, disagreementLevel, pseudonyms, sortByDisagreement, allCaseStats, tallyVotes } from '../js/stats.js';
import { realConfig, response } from './helpers.js';

const config = realConfig();
const [first, second] = config.cases;

test('disagreement index: chance that two random reviewers differ', () => {
  assert.equal(disagreementIndex([5, 0, 0, 0]), 0);
  assert.equal(disagreementIndex([1, 1, 1, 1]), 1);
  assert.equal(disagreementIndex([3, 3, 0, 0]), 1 - 12 / 30);
  assert.equal(disagreementIndex([1, 0, 0, 0]), null);
  assert.equal(disagreementIndex([0, 0, 0, 0]), null);
});

test('levels use thresholds and need a minimum number of answers', () => {
  const t = { high: 0.55, some: 0.3, minResponses: 3 };
  assert.equal(disagreementLevel(0.6, t, 5), 'high');
  assert.equal(disagreementLevel(0.4, t, 5), 'some');
  assert.equal(disagreementLevel(0.1, t, 5), 'low');
  assert.equal(disagreementLevel(1, t, 2), 'none');
  assert.equal(disagreementLevel(null, t, 0), 'none');
});

test('caseStats counts decisions, tags by decision, and confidence', () => {
  const responses = [
    response('a', first.id, 'core', { tags: ['evidence', 'performance'], confidence: 4 }),
    response('b', first.id, 'core', { tags: ['evidence'], confidence: 2 }),
    response('c', first.id, 'no', { tags: ['maintainability', 'other'], other_tag: 'Funding', confidence: 5 }),
    response('d', second.id, 'extension'),
    response('e', first.id, 'not-a-decision'),
  ];
  const s = caseStats(first, responses, config);
  assert.equal(s.n, 3);
  assert.deepEqual(s.counts, { core: 2, extension: 0, experimental: 0, no: 1 });
  assert.deepEqual(s.topDecisions, ['core']);
  assert.equal(s.tags[0].tag.id, 'evidence');
  assert.deepEqual(s.tags[0].byDecision, { core: 2, extension: 0, experimental: 0, no: 0 });
  assert.deepEqual(s.otherTexts, ['Funding']);
  assert.equal(s.confidence.mean, 11 / 3);
  assert.deepEqual(s.confidence.hist, [0, 1, 0, 1, 1]);
  assert.equal(s.confidence.byDecision.core, 3);
  assert.equal(s.rationales.length, 3);
});

test('sorting puts the most contested cases first and unlabelled ones last', () => {
  const responses = [
    ...['a', 'b', 'c'].map((p) => response(p, first.id, 'core')),
    response('a', second.id, 'core'),
    response('b', second.id, 'no'),
    response('c', second.id, 'extension'),
    response('a', config.cases[2].id, 'core'),
    response('b', config.cases[2].id, 'no'),
  ];
  const sorted = sortByDisagreement(allCaseStats(config, responses));
  assert.equal(sorted[0].case.id, second.id);
  assert.equal(sorted[1].case.id, first.id);
  const third = sorted.findIndex((s) => s.case.id === config.cases[2].id);
  assert.ok(third > 1, 'a 1-1 split with two answers is not labelled');
});

test('votes are tallied per wording version, with history', () => {
  const p = { id: 'p1', version: 2, text: 'x' };
  const votes = [
    { principle_id: 'p1', version: 1, participant_code: 'a', vote: 'agree' },
    { principle_id: 'p1', version: 1, participant_code: 'b', vote: 'disagree' },
    { principle_id: 'p1', version: 2, participant_code: 'a', vote: 'agree' },
    { principle_id: 'p1', version: 2, participant_code: 'b', vote: 'agree' },
    { principle_id: 'p1', version: 2, participant_code: 'c', vote: 'amend', comment: '  say "most"  ' },
    { principle_id: 'other', version: 2, participant_code: 'a', vote: 'disagree' },
  ];
  const t = tallyVotes(p, votes, config);
  assert.deepEqual(t.counts, { agree: 2, amend: 1, disagree: 0 });
  assert.equal(t.n, 3);
  assert.equal(t.agreeShare, 2 / 3);
  assert.equal(t.meetsThreshold, true); // 2 of 3 shows as 67%, which meets 0.67
  const oneOfTwo = tallyVotes({ id: 'p1', version: 1 }, votes, config);
  assert.equal(oneOfTwo.meetsThreshold, false); // 1 of 2 = 50%
  assert.deepEqual(t.comments.map((c) => c.comment), ['say "most"']);
  assert.deepEqual(t.history, [{ version: 1, counts: { agree: 1, amend: 0, disagree: 1 }, n: 2 }]);
});

test('pseudonyms are stable and unrelated to input order', () => {
  const a = pseudonyms(['zoe', 'amy', 'bob'], 'ws');
  const b = pseudonyms(['bob', 'zoe', 'amy', 'amy'], 'ws');
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  assert.deepEqual([...a.values()].sort(), ['R01', 'R02', 'R03']);
});

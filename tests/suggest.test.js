import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestionsFor } from '../js/suggest.js';

const config = {
  categories: [{ id: 'purpose', suggestedPrinciple: 'Own rule.' }, { id: 'scope', suggestedPrinciple: '' }, { id: 'usability' }],
  cases: [
    { id: 'a', suggestedSection: 'scope', suggestedPrinciple: 'Scope rule A.' },
    { id: 'b', suggestedSection: 'scope', suggestedPrinciple: 'Scope rule B.' },
    { id: 'c', suggestedSection: 'purpose', suggestedPrinciple: 'Purpose rule from a case.' },
    { id: 'd', suggestedSection: 'usability', suggestedPrinciple: '' },
  ],
};

test("a section's own suggestion comes first, then its cases', in case order", () => {
  assert.deepEqual(suggestionsFor(config, [], 'purpose'), [
    { text: 'Own rule.', caseId: '' },
    { text: 'Purpose rule from a case.', caseId: 'c' },
  ]);
  assert.deepEqual(suggestionsFor(config, [], 'scope').map((s) => s.caseId), ['a', 'b']);
  assert.deepEqual(suggestionsFor(config, [], 'usability'), []); // a case with no text offers nothing
  assert.deepEqual(suggestionsFor(config, [], 'no-such-section'), []);
});

test('a rule already captured, even if dropped since, is not offered again (give or take capitals, spaces, a full stop)', () => {
  const principles = [{ text: '  scope   RULE a ', status: 'parked' }];
  assert.deepEqual(suggestionsFor(config, principles, 'scope').map((s) => s.caseId), ['b']);
  assert.deepEqual(suggestionsFor(config, [{ text: 'Own rule' }], 'purpose').map((s) => s.caseId), ['c']);
});

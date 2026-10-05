import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupJson, caseRecordMarkdown, constitutionMarkdown, principlesCsv, responsesCsv } from '../js/export.js';
import { realConfig, response } from './helpers.js';

const config = realConfig();

const principles = [
  { id: 'a', text: 'Second in scope.', category: 'scope', position: 2, status: 'ratified', version: 1 },
  { id: 'b', text: 'First in scope.', category: 'scope', position: 1, status: 'ratified', version: 1 },
  { id: 'c', text: 'Still being argued about.', category: 'evidence', position: 1, status: 'voting', version: 1 },
  { id: 'd', text: 'Not sure where this goes.', category: 'unsorted', position: 1, status: 'proposed', version: 1 },
  { id: 'e', text: 'Line one\nline two', category: 'governance', position: 1, status: 'ratified', version: 2 },
];
const votes = [
  { principle_id: 'b', version: 1, participant_code: 'x', vote: 'agree' },
  { principle_id: 'b', version: 1, participant_code: 'y', vote: 'amend' },
  { principle_id: 'c', version: 1, participant_code: 'x', vote: 'disagree' },
];

test('constitution has every heading in order, ratified principles only, sorted by position', () => {
  const md = constitutionMarkdown(config, principles, votes);
  const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(headings, config.categories.map((c) => c.heading));
  assert.deepEqual(headings.slice(0, 9), [
    'Purpose',
    'Scope',
    'Scientific standards',
    'Validation',
    'Technical standards',
    'Performance and complexity',
    'Usability',
    'Maintenance and ownership',
    'Governance and decision-making',
  ]);
  assert.ok(md.startsWith('# malariasimulation constitution\n'));
  assert.ok(md.indexOf('1. First in scope.') < md.indexOf('2. Second in scope.'));
  assert.ok(!md.includes('Still being argued about.'));
  assert.ok(md.includes('1. Line one\n   line two'), 'multi-line principles stay inside their list item');
  assert.ok(md.includes('*No principles agreed yet.*'));
  assert.ok(!md.includes('agree ·'), 'no tallies unless asked');
});

test('ratified principles without a (known) section are kept, not dropped', () => {
  const extra = [
    { id: 'u1', text: 'Ratified straight from Unsorted.', category: 'unsorted', position: 1, status: 'ratified', version: 1 },
    { id: 'u2', text: 'In a section that was later removed.', category: 'gone', position: 2, status: 'ratified', version: 1 },
  ];
  const md = constitutionMarkdown(config, [...principles, ...extra], votes);
  assert.ok(md.includes('## Not yet categorised\n\n1. Ratified straight from Unsorted.\n2. In a section that was later removed.'));
});

test('constitution options: vote tallies and an appendix of unratified proposals', () => {
  const md = constitutionMarkdown(config, principles, votes, { includeTallies: true, includeUnratified: true });
  assert.ok(md.includes('1. First in scope. *(1 agree · 1 amend · 0 disagree)*'));
  assert.ok(md.includes('## Appendix: proposals not yet agreed'));
  assert.ok(md.includes('- Still being argued about. *(voting open; 0 agree · 0 amend · 1 disagree)*'));
  assert.ok(md.includes('### Not yet categorised'));
});

test('case record is anonymised and includes every rationale', () => {
  const [c1] = config.cases;
  const responses = [
    response('secret-name', c1.id, 'core', { rationale: 'Because | evidence', tags: ['evidence'], confidence: 4 }),
    response('other-person', c1.id, 'no', { rationale: 'Too costly', tags: ['other'], other_tag: 'Funding' }),
  ];
  const md = caseRecordMarkdown(config, responses);
  assert.ok(!md.includes('secret-name') && !md.includes('other-person'));
  assert.ok(md.includes('Because | evidence'));
  assert.ok(md.includes('Other: Funding'));
  assert.ok(md.includes(`| 1 | ${c1.title} | 2 | 1 | 0 | 0 | 1 | 1.00 |`));
});

test('CSV quoting and anonymisation', () => {
  const [c1] = config.cases;
  const csv = responsesCsv(config, [response('secret', c1.id, 'core', { rationale: 'He said "no", then\nyes', tags: ['a', 'b'] })]);
  const [header, row] = csv.trim().split('\n', 2);
  assert.ok(header.startsWith('workshop,case_number,case_id'));
  assert.ok(!csv.includes('secret'));
  assert.ok(row.includes(',R01,core,CORE,a;b,'));
  assert.ok(csv.includes('"He said ""no"", then\nyes"'));

  const pcsv = principlesCsv(config, principles, votes);
  assert.ok(pcsv.split('\n')[0].includes('votes_agree,votes_amend,votes_disagree'));
});

test('backup JSON round-trips', () => {
  const data = { participants: [], responses: [response('a', 'x', 'core')], principles, votes };
  const parsed = JSON.parse(backupJson(config, data));
  assert.equal(parsed.workshop, config.id);
  assert.equal(parsed.principles.length, principles.length);
  assert.equal(parsed.responses[0].participant_code, 'a');
});

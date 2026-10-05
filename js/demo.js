// Demo data for trying the facilitator views before the workshop (demo mode only).

import { assignGuest } from './assign.js';
import { seededRandom, slugify, uuid } from './util.js';

// Example people for when participants.json lists nobody (people then type
// their own names when they join).
const DEMO_NAMES = ['Ross', 'Macdonald', 'Amara', 'Ben', 'Chiara', 'Dev', 'Esi', 'Femi', 'Grace', 'Hugo', 'Ines', 'Jun', 'Kofi', 'Lena', 'Nadia', 'Priya'];

// How the group might plausibly split on each seeded case: weights for
// [core, extension, experimental, no]. Unknown cases get random weights.
const PROFILES = {
  'bespoke-intervention': [0.1, 0.5, 0.2, 0.2],
  'alternative-immunity': [0.3, 0.05, 0.5, 0.15],
  'new-output': [0.45, 0.45, 0, 0.1],
  'mosquito-behaviour': [0.35, 0.15, 0.4, 0.1],
  'drug-resistance': [0.3, 0.3, 0.35, 0.05],
  'performance-refactor': [0.85, 0, 0.1, 0.05],
  'unvalidated-mechanism': [0.05, 0.15, 0.75, 0.05],
  'country-parameters': [0.05, 0.8, 0, 0.15],
  'complex-intervention': [0.5, 0.2, 0.25, 0.05],
  'breaking-change': [0.3, 0.05, 0.35, 0.3],
  'external-contribution': [0.15, 0.4, 0.2, 0.25],
  'scenario-builder': [0.15, 0.7, 0.05, 0.1],
  'weak-evidence-intervention': [0.15, 0.15, 0.6, 0.1],
  'not-who-approved': [0.35, 0.2, 0.35, 0.1],
  'ai-written-code': [0.4, 0.05, 0.3, 0.25],
};

const TAG_WEIGHTS = [
  { evidence: 3, generalisability: 3, usability: 2, performance: 1, validation: 1, reproducibility: 1 },
  { generalisability: 3, maintainability: 3, ownership: 2, usability: 1 },
  { validation: 4, evidence: 3, maintainability: 1, reproducibility: 1 },
  { maintainability: 3, performance: 2, 'backwards-compatibility': 2, evidence: 1, ownership: 2 },
];

const RATIONALES = [
  [
    'General enough that most users will benefit, and the evidence is solid.',
    'This is exactly what the core model is for.',
    'The cost is small compared with the realism we gain.',
    'Leaving it out would push people to maintain forks.',
    'We will need this for policy questions sooner or later.',
  ],
  [
    'Useful, but too specific to one project; a companion package keeps the core lean.',
    'Better as a separate package that depends on malariasimulation.',
    'Data like this goes stale; it should live with the site files, not the model.',
    'Fine to build, but the owners should maintain it outside the core.',
  ],
  [
    'Promising, but it needs independent validation before users rely on it.',
    'Put it behind an option and revisit once a second project has used it.',
    'The science is not settled enough for the default model yet.',
    'Needs tests against independent data first.',
  ],
  [
    'The maintenance burden outweighs the benefit.',
    'Breaks too many existing analyses for what it offers.',
    'Nobody would own this once the author moves on.',
    'The evidence is too thin to justify maintaining it.',
  ],
];

const PRINCIPLES = [
  ['scope', 'New mechanisms must be sufficiently general to justify long-term inclusion in the core model.', 'ratified'],
  ['evidence', 'Mechanisms in the core model should be supported by peer-reviewed evidence or independent validation.', 'voting'],
  ['performance', 'A feature that slows every simulation must justify its cost for most users, or be optional.', 'voting'],
  ['maintenance', 'Every feature in the core model needs a named custodian in the core team.', 'ratified'],
  ['validation', 'Changes that alter default outputs must include a comparison against the previous release.', 'proposed'],
  ['technical', 'Breaking changes are batched into major releases and come with a migration guide.', 'proposed'],
  ['governance', 'Contested proposals are decided at a regular review meeting and recorded in a public decision log.', 'proposed'],
  ['unsorted', 'Country-specific data belongs in companion packages, not in the core model.', 'proposed'],
];

function pick(weights, rand) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

export function generateDemo(config, assignments, { seed = 11, completion = 0.85 } = {}) {
  const rand = seededRandom(seed);
  const decisions = config.decisions;
  const tagIds = new Set(config.tags.map((t) => t.id));
  const casesById = new Map(config.cases.map((c) => [c.id, c]));

  const participants = [];
  const responses = [];
  let t = Date.now() - 40 * 60 * 1000;
  const stamp = () => new Date((t += 20000 + Math.floor(rand() * 40000))).toISOString();

  const people = config.roster.length ? config.roster.map((p) => ({ ...p, cases: assignments.get(p.code) || [] })) : demoPeople(config);
  for (const person of people) {
    const { cases } = person;
    participants.push({ code: person.code, name: person.name, cases, guest: !config.roster.length, created_at: stamp() });
    for (const caseId of cases) {
      if (!casesById.has(caseId) || rand() > completion) continue;
      const weights = (PROFILES[caseId] || decisions.map(() => 0.2 + rand())).slice(0, decisions.length);
      while (weights.length < decisions.length) weights.push(0.2);
      const d = pick(weights, rand);
      const tagWeights = Object.entries(TAG_WEIGHTS[d % TAG_WEIGHTS.length]).filter(([id]) => tagIds.has(id));
      const tags = [];
      const count = 1 + Math.floor(rand() * Math.min(3, tagWeights.length));
      while (tags.length < count && tagWeights.length) {
        const i = pick(tagWeights.map(([, w]) => w), rand);
        tags.push(tagWeights[i][0]);
        tagWeights.splice(i, 1);
      }
      const bank = RATIONALES[d % RATIONALES.length];
      const created = stamp();
      responses.push({
        participant_code: person.code,
        case_id: caseId,
        decision: decisions[d].id,
        rationale: bank[Math.floor(rand() * bank.length)],
        tags,
        other_tag: null,
        confidence: config.review.askConfidence ? 2 + Math.floor(rand() * 4) : null,
        created_at: created,
        updated_at: created,
      });
    }
  }

  const categoryIds = new Set(['unsorted', ...config.categories.map((c) => c.id)]);
  const principles = PRINCIPLES.filter(([category]) => categoryIds.has(category)).map(([category, text, status], i) => ({
    id: uuid(),
    text,
    category,
    position: i + 1,
    status,
    version: 1,
    source_case_id: null,
    proposed_by: i === PRINCIPLES.length - 1 ? people[0]?.code || 'participant' : 'facilitator',
    created_at: stamp(),
  }));

  const votes = [];
  const voteIds = config.votes.map((v) => v.id);
  for (const p of principles.filter((x) => x.status !== 'proposed')) {
    for (const person of people) {
      if (rand() > 0.8) continue;
      const v = pick(p.status === 'ratified' ? [0.85, 0.12, 0.03] : [0.55, 0.3, 0.15], rand);
      const vote = voteIds[Math.min(v, voteIds.length - 1)];
      votes.push({
        principle_id: p.id,
        version: 1,
        participant_code: person.code,
        vote,
        comment: vote === voteIds[1] && rand() < 0.5 ? 'Could we say "most users" rather than all?' : null,
        created_at: stamp(),
      });
    }
  }

  return { participants, responses, principles, votes };
}

// The demo people join one after another, each getting the least-covered cases, as real people would.
function demoPeople(config) {
  const caseIds = config.cases.map((c) => c.id);
  const assigned = new Map();
  return DEMO_NAMES.map((name) => {
    const code = slugify(name);
    const cases = assignGuest(code, caseIds, assigned, config.assignment);
    assigned.set(code, cases);
    return { code, name, cases };
  });
}

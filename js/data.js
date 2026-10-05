// Loads the editable data files (data/*.json) and turns them into one config
// object with sensible defaults. Problems in the files become `warnings`, shown
// on the facilitator's Setup tab, rather than crashing the app.

import { slugify } from './util.js';

const DEFAULT_DECISIONS = [
  { id: 'core', label: 'CORE', description: 'Merge into malariasimulation' },
  { id: 'extension', label: 'EXTENSION', description: 'Belongs elsewhere in the malariaverse' },
  { id: 'experimental', label: 'EXPERIMENTAL', description: 'Potentially core, but not ready' },
  { id: 'no', label: 'NO', description: 'Should not be maintained in this ecosystem' },
];

const DEFAULT_VOTES = [
  { id: 'agree', label: 'Agree' },
  { id: 'amend', label: 'Amend' },
  { id: 'disagree', label: 'Disagree' },
];

export const UNSORTED = { id: 'unsorted', label: 'Unsorted', heading: null, prompt: 'New proposals without a category. Move them into a section.' };

async function fetchJson(path) {
  let res;
  try {
    res = await fetch(path, { cache: 'no-cache' });
  } catch {
    throw new Error(
      `Couldn't load ${path}. If you opened the HTML file directly from disk, serve the folder over HTTP instead (see README).`,
    );
  }
  if (!res.ok) throw new Error(`Couldn't load ${path} (HTTP ${res.status}).`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON. ${err.message}`);
  }
}

export async function loadConfig(base = 'data/') {
  const [workshop, casesFile, rosterFile] = await Promise.all([
    fetchJson(`${base}workshop.json`),
    fetchJson(`${base}cases.json`),
    fetchJson(`${base}participants.json`),
  ]);
  return normaliseConfig(workshop, casesFile, rosterFile, new URLSearchParams(globalThis.location?.search || ''));
}

export function normaliseConfig(workshop = {}, casesFile = {}, rosterFile = {}, params = new URLSearchParams()) {
  const warnings = [];

  // Storage: Supabase when configured, otherwise this-browser demo mode.
  const storageCfg = workshop.storage || {};
  const supabaseUrl = String(storageCfg.supabaseUrl || '').trim();
  const supabaseKey = String(storageCfg.supabaseKey || '').trim();
  const forceLocal = params.get('backend') === 'local';
  const backend = !forceLocal && supabaseUrl && supabaseKey ? 'supabase' : 'local';

  const decisions = (workshop.decisions?.length ? workshop.decisions : DEFAULT_DECISIONS).map((d, i) => ({
    id: String(d.id),
    label: d.label || d.id,
    description: d.description || '',
    color: d.color || null,
    slot: i + 1,
  }));

  const voteList = workshop.votes?.length ? workshop.votes : DEFAULT_VOTES;
  const votes = voteList.map((v, i) => ({
    id: String(v.id),
    label: v.label || v.id,
    hint: v.hint || '',
    tone: i === 0 ? 'pos' : i === voteList.length - 1 ? 'neg' : 'mid',
  }));

  const tags = (workshop.tags || []).map((t) => ({
    id: String(t.id),
    label: t.label || t.id,
    freeText: Boolean(t.freeText),
  }));

  const categories = (workshop.categories || []).map((c) => ({
    id: String(c.id),
    label: c.label || c.id,
    heading: c.heading || c.label || c.id,
    prompt: c.prompt || '',
  }));
  if (!categories.length) warnings.push('workshop.json has no principle categories.');

  // Cases ("active": false switches a case off without deleting it)
  const seenCases = new Set();
  const cases = [];
  const inactiveCases = [];
  for (const [i, raw] of (casesFile.cases || []).entries()) {
    if (raw.active === false) {
      inactiveCases.push({ id: String(raw.id || ''), title: raw.title || `Case ${i + 1}` });
      continue;
    }
    let id = slugify(raw.id || raw.title || `case-${i + 1}`);
    if (!raw.id) warnings.push(`Case ${i + 1} ("${raw.title || 'untitled'}") has no id; using "${id}".`);
    if (seenCases.has(id)) {
      warnings.push(`Duplicate case id "${id}"; renamed to "${id}-${i + 1}".`);
      id = `${id}-${i + 1}`;
    }
    seenCases.add(id);
    const suggestedPrinciple = typeof raw.suggestedPrinciple === 'string' ? raw.suggestedPrinciple.trim() : '';
    let suggestedSection = 'unsorted';
    if (raw.suggestedSection && categories.some((c) => c.id === raw.suggestedSection)) suggestedSection = raw.suggestedSection;
    else if (raw.suggestedSection) warnings.push(`Case "${id}" suggests the unknown section "${raw.suggestedSection}".`);
    cases.push({
      id,
      number: cases.length + 1,
      title: raw.title || `Case ${i + 1}`,
      summary: raw.summary || '',
      upsides: Array.isArray(raw.upsides) ? raw.upsides : [],
      downsides: Array.isArray(raw.downsides) ? raw.downsides : [],
      link: /^https?:\/\//i.test(raw.link || '') ? raw.link : null,
      suggestedPrinciple,
      suggestedSection,
    });
  }
  if (!cases.length) warnings.push('cases.json has no cases.');

  // Roster
  const seenCodes = new Set();
  const roster = [];
  for (const [i, raw] of (rosterFile.participants || []).entries()) {
    const name = String(raw.name || '').trim() || `Participant ${i + 1}`;
    let code = slugify(raw.code || name);
    if (seenCodes.has(code)) {
      warnings.push(`Two participants share the code "${code}"; the second is "${code}-${i + 1}". Give them explicit codes.`);
      code = `${code}-${i + 1}`;
    }
    seenCodes.add(code);
    let fixed = null;
    if (Array.isArray(raw.cases)) {
      fixed = raw.cases.map(String).filter((c) => {
        if (seenCases.has(c)) return true;
        const off = inactiveCases.some((x) => x.id === c);
        warnings.push(`${name} is assigned ${off ? 'case' : 'unknown case'} "${c}"${off ? ', which is switched off' : ''}; ignoring it.`);
        return false;
      });
    }
    roster.push({ code, name, cases: fixed });
  }

  const assignment = workshop.assignment || {};
  const review = workshop.review || {};
  const perParticipant = Math.max(1, Math.min(cases.length || 1, Number(assignment.casesPerParticipant) || 4));

  return {
    id: slugify(params.get('ws') || workshop.id || 'workshop'),
    title: workshop.title || 'malariasimulation constitution workshop',
    subtitle: workshop.subtitle || '',
    intro: workshop.intro || '',
    backend,
    supabase: { url: supabaseUrl, key: supabaseKey },
    facilitatorKey: String(workshop.facilitatorKey || ''),
    join: {
      showNameList: workshop.join?.showNameList !== false,
      allowGuests: workshop.join?.allowGuests !== false,
    },
    assignment: {
      perParticipant,
      seed: Number(assignment.seed) || 1,
      minReviews: Number(assignment.minReviewsPerCase) || 3,
    },
    review: {
      requireRationale: review.requireRationale !== false,
      askConfidence: review.askConfidence !== false,
      maxTags: Number(review.maxTags ?? 3) || 0,
    },
    confidenceLabels: workshop.confidence?.labels?.length === 5
      ? workshop.confidence.labels
      : ['Very unsure', 'Unsure', 'Somewhat sure', 'Sure', 'Very sure'],
    decisions,
    tags,
    votes,
    categories,
    ratifyThreshold: Number(workshop.ratification?.threshold ?? 0.67),
    disagreement: {
      high: Number(workshop.disagreement?.high ?? 0.55),
      some: Number(workshop.disagreement?.some ?? 0.3),
      minResponses: Number(workshop.disagreement?.minResponses ?? 3),
    },
    export: {
      title: workshop.export?.title || 'malariasimulation constitution',
      preamble: workshop.export?.preamble || '',
    },
    // Suggested minutes for each facilitator step (0 hides that step's timer).
    schedule: { review: 15, discuss: 30, tidy: 5, vote: 20, ...(workshop.schedule || {}) },
    cases,
    inactiveCases,
    roster,
    warnings,
  };
}

// Lookup helpers
export function byId(list) {
  return new Map(list.map((item) => [item.id, item]));
}

export function categoryList(config) {
  return [UNSORTED, ...config.categories];
}

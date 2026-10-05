// Sharing cases out between participants.
//
// Goals, in priority order:
//   1. every case gets a similar number of reviewers;
//   2. the same pairs of cases don't always travel together, so each person's
//      set is a different mix;
//   3. the result is deterministic for a given roster and seed, so every device
//      computes the same plan.
//
// The plan is computed from the roster alone. Once a participant opens the app
// their cases are locked in storage, so later edits to the roster never change
// what someone is already working on.

import { hashString, seededRandom, shuffle } from './util.js';

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function lexLess(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

function record(cases, coverage, pairs) {
  for (const c of cases) coverage.set(c, (coverage.get(c) || 0) + 1);
  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      const key = pairKey(cases[i], cases[j]);
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
}

// Pick k cases: least-reviewed first, then the ones that have been paired
// least often with what's already chosen, then a seeded random tie-break.
export function pickCases(caseIds, k, coverage, pairs, rand) {
  const n = Math.min(k, caseIds.length);
  const jitter = new Map(caseIds.map((id) => [id, rand()]));
  const chosen = [];
  while (chosen.length < n) {
    let best = null;
    let bestScore = null;
    for (const id of caseIds) {
      if (chosen.includes(id)) continue;
      const pairScore = chosen.reduce((s, c) => s + (pairs.get(pairKey(c, id)) || 0), 0);
      const score = [coverage.get(id) || 0, pairScore, jitter.get(id)];
      if (best === null || lexLess(score, bestScore)) {
        best = id;
        bestScore = score;
      }
    }
    chosen.push(best);
  }
  // Vary the order people work through their cases, so that anyone who runs
  // out of time doesn't always leave the same case unreviewed.
  return shuffle(chosen, rand);
}

// roster: [{ code, cases? }] in file order. Returns Map(code -> [caseId]).
export function planAssignments(roster, caseIds, { perParticipant = 4, seed = 1 } = {}) {
  const coverage = new Map(caseIds.map((id) => [id, 0]));
  const pairs = new Map();
  const plan = new Map();
  const valid = new Set(caseIds);

  // Fixed assignments from the roster file count first.
  for (const person of roster) {
    if (Array.isArray(person.cases) && person.cases.length) {
      const cases = person.cases.filter((c) => valid.has(c));
      plan.set(person.code, cases);
      record(cases, coverage, pairs);
    }
  }

  const rand = seededRandom(seed);
  for (const person of roster) {
    if (plan.has(person.code)) continue;
    const cases = pickCases(caseIds, perParticipant, coverage, pairs, rand);
    plan.set(person.code, cases);
    record(cases, coverage, pairs);
  }
  return plan;
}

// Everyone's current cases: locked (already joined) wins over the plan.
export function currentAssignments(plan, joined) {
  const out = new Map(plan);
  for (const person of joined) out.set(person.code, person.cases || []);
  return out;
}

// Cases for someone who isn't on the roster: the least-covered ones right now.
export function assignGuest(code, caseIds, assignments, { perParticipant = 4, seed = 1 } = {}) {
  const coverage = new Map(caseIds.map((id) => [id, 0]));
  const pairs = new Map();
  for (const cases of assignments.values()) record(cases, coverage, pairs);
  const rand = seededRandom((hashString(code) ^ seed) >>> 0);
  return pickCases(caseIds, perParticipant, coverage, pairs, rand);
}

export function coverageCounts(assignments, caseIds) {
  const coverage = new Map(caseIds.map((id) => [id, 0]));
  for (const cases of assignments.values()) {
    for (const c of cases) if (coverage.has(c)) coverage.set(c, coverage.get(c) + 1);
  }
  return coverage;
}

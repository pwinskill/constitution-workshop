// Summaries for the facilitator dashboard and the exports. Pure functions only.

import { hashString, sum } from './util.js';

// Chance that two different reviewers, picked at random, chose different
// options: 0 when everyone agrees, 1 when no two people agree. Undefined
// (null) with fewer than two responses.
export function disagreementIndex(counts) {
  const n = sum(counts);
  if (n < 2) return null;
  const same = sum(counts.map((c) => c * (c - 1)));
  return 1 - same / (n * (n - 1));
}

// With only one or two answers any split looks dramatic, so a case needs
// `minResponses` answers before it gets a label.
export function disagreementLevel(value, { high, some, minResponses = 3 }, n = Infinity) {
  if (value == null || n < minResponses) return 'none';
  if (value >= high) return 'high';
  if (value >= some) return 'some';
  return 'low';
}

export const LEVEL_LABELS = {
  high: 'High disagreement',
  some: 'Some disagreement',
  low: 'Broad agreement',
  none: 'Too few responses',
};

// Stable, meaningless order for rationales (so the list doesn't reveal who
// answered first, and doesn't jump around as new answers arrive).
const shuffleKey = (r) => hashString(`${r.participant_code}|${r.case_id}`);

export function caseStats(caseItem, responses, config) {
  const decisionIds = config.decisions.map((d) => d.id);
  const rows = responses.filter((r) => r.case_id === caseItem.id && decisionIds.includes(r.decision));
  const n = rows.length;

  const counts = Object.fromEntries(decisionIds.map((id) => [id, 0]));
  for (const r of rows) counts[r.decision]++;
  const countList = decisionIds.map((id) => counts[id]);
  const disagreement = disagreementIndex(countList);
  const level = disagreementLevel(disagreement, config.disagreement, n);

  const topCount = Math.max(0, ...countList);
  const topDecisions = n ? decisionIds.filter((id) => counts[id] === topCount) : [];

  // Reason tags, split by the decision they were cited for.
  const tags = config.tags
    .map((tag) => {
      const byDecision = Object.fromEntries(decisionIds.map((id) => [id, 0]));
      for (const r of rows) if ((r.tags || []).includes(tag.id)) byDecision[r.decision]++;
      return { tag, total: sum(Object.values(byDecision)), byDecision };
    })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.total - a.total || config.tags.indexOf(a.tag) - config.tags.indexOf(b.tag));

  const otherTexts = rows.map((r) => (r.other_tag || '').trim()).filter(Boolean);

  // Confidence (1-5), overall and per decision.
  const withConfidence = rows.filter((r) => r.confidence >= 1 && r.confidence <= 5);
  const hist = [1, 2, 3, 4, 5].map((v) => withConfidence.filter((r) => Number(r.confidence) === v).length);
  const mean = (list) => (list.length ? sum(list.map((r) => Number(r.confidence))) / list.length : null);
  const confidenceByDecision = Object.fromEntries(
    decisionIds.map((id) => [id, mean(withConfidence.filter((r) => r.decision === id))]),
  );

  const rationales = rows
    .map((r) => ({
      decision: r.decision,
      text: (r.rationale || '').trim(),
      tags: r.tags || [],
      otherTag: (r.other_tag || '').trim(),
      confidence: r.confidence >= 1 && r.confidence <= 5 ? Number(r.confidence) : null,
      order: shuffleKey(r),
    }))
    .sort((a, b) => a.order - b.order);

  return {
    case: caseItem,
    n,
    counts,
    disagreement,
    level,
    topDecisions,
    topShare: n ? topCount / n : null,
    tags,
    otherTexts,
    confidence: { n: withConfidence.length, mean: mean(withConfidence), hist, byDecision: confidenceByDecision },
    rationales,
  };
}

export function allCaseStats(config, responses) {
  return config.cases.map((c) => caseStats(c, responses, config));
}

// Most disagreement first; cases with too few answers go last.
export function sortByDisagreement(statsList) {
  const key = (s) => (s.level === 'none' ? -1 : s.disagreement);
  return statsList.slice().sort((a, b) => key(b) - key(a) || b.n - a.n || a.case.number - b.case.number);
}

// Reason tags across every case, split by decision.
export function overallTagStats(config, responses) {
  const decisionIds = config.decisions.map((d) => d.id);
  const rows = responses.filter((r) => decisionIds.includes(r.decision));
  return config.tags
    .map((tag) => {
      const byDecision = Object.fromEntries(decisionIds.map((id) => [id, 0]));
      for (const r of rows) if ((r.tags || []).includes(tag.id)) byDecision[r.decision]++;
      return { tag, total: sum(Object.values(byDecision)), byDecision };
    })
    .sort((a, b) => b.total - a.total);
}

export function decisionTotals(config, responses) {
  const counts = Object.fromEntries(config.decisions.map((d) => [d.id, 0]));
  for (const r of responses) if (r.decision in counts) counts[r.decision]++;
  return counts;
}

// Votes on one principle, counting only votes on its current wording.
export function tallyVotes(principle, votes, config) {
  const optionIds = config.votes.map((v) => v.id);
  const tally = (version) => {
    const list = votes.filter((v) => v.principle_id === principle.id && Number(v.version) === Number(version));
    const counts = Object.fromEntries(optionIds.map((id) => [id, 0]));
    for (const v of list) if (v.vote in counts) counts[v.vote]++;
    return { list, counts, n: sum(Object.values(counts)) };
  };

  const current = tally(principle.version);
  const agreeId = optionIds[0];
  const agreeShare = current.n ? current.counts[agreeId] / current.n : null;
  const history = [];
  for (let v = 1; v < principle.version; v++) {
    const past = tally(v);
    if (past.n) history.push({ version: v, counts: past.counts, n: past.n });
  }
  return {
    counts: current.counts,
    n: current.n,
    agreeShare,
    // Compared as whole percentages, as displayed: 2 of 3 is "67%" and meets a 0.67 threshold.
    meetsThreshold: current.n > 0 && Math.round(agreeShare * 100) >= Math.round(config.ratifyThreshold * 100),
    comments: current.list
      .filter((v) => (v.comment || '').trim())
      .map((v) => ({ vote: v.vote, comment: v.comment.trim(), order: hashString(`${v.participant_code}|${v.principle_id}`) }))
      .sort((a, b) => a.order - b.order),
    history,
  };
}

// Stable pseudonyms (R01, R02, ...) for exports; order is unrelated to names.
export function pseudonyms(codes, salt = '') {
  const unique = [...new Set(codes)].sort((a, b) => hashString(salt + a) - hashString(salt + b) || a.localeCompare(b));
  const width = String(unique.length).length < 2 ? 2 : String(unique.length).length;
  return new Map(unique.map((code, i) => [code, `R${String(i + 1).padStart(width, '0')}`]));
}

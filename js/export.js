// Export builders: the constitution (Markdown), the case record (Markdown),
// CSV tables for analysis in R, and a full JSON backup. Pure functions only.

import { byId } from './data.js';
import { allCaseStats, pseudonyms, tallyVotes } from './stats.js';
import { formatDateTime } from './util.js';

const STATUS_LABELS = { proposed: 'not voted on', voting: 'voting open', ratified: 'adopted', parked: 'dropped' };

function longDate(date) {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Keep multi-line text inside a Markdown list item.
function listItemText(text, indent = 3) {
  return String(text).trim().replace(/\r?\n+/g, `\n${' '.repeat(indent)}`);
}

function voteSummary(tally, config) {
  return config.votes.map((v) => `${tally.counts[v.id]} ${v.label.toLowerCase()}`).join(' · ');
}

export function sortPrinciples(principles) {
  return principles.slice().sort((a, b) => a.position - b.position || String(a.created_at).localeCompare(String(b.created_at)));
}

// Principles whose category isn't (or is no longer) in the config count as unsorted.
export function categoryOf(config, principle) {
  return config.categories.some((c) => c.id === principle.category) ? principle.category : 'unsorted';
}

export function unsortedRatified(config, principles) {
  return principles.filter((p) => p.status === 'ratified' && categoryOf(config, p) === 'unsorted');
}

export function constitutionMarkdown(config, principles, votes, { includeTallies = false, includeUnratified = false, date = new Date() } = {}) {
  const lines = [`# ${config.export.title}`, ''];
  lines.push(`*Draft agreed at the ${config.title}, ${longDate(date)}.*`, '');
  if (config.export.preamble) lines.push(config.export.preamble, '');

  const sorted = sortPrinciples(principles);
  const numbered = (items) =>
    items.map((p, i) => {
      let item = `${i + 1}. ${listItemText(p.text)}`;
      if (includeTallies) {
        const tally = tallyVotes(p, votes, config);
        if (tally.n) item += ` *(${voteSummary(tally, config)})*`;
      }
      return item;
    });

  for (const category of config.categories) {
    lines.push(`## ${category.heading}`, '');
    const ratified = sorted.filter((p) => p.status === 'ratified' && categoryOf(config, p) === category.id);
    if (ratified.length) lines.push(...numbered(ratified), '');
    else lines.push('*No principles agreed yet.*', '');
  }

  // Ratified but never given a section: keep them rather than lose them.
  const homeless = sortPrinciples(unsortedRatified(config, principles));
  if (homeless.length) lines.push('## Not yet categorised', '', ...numbered(homeless), '');

  if (includeUnratified) {
    const open = sorted.filter((p) => p.status !== 'ratified');
    lines.push('---', '', '## Appendix: proposals not yet agreed', '');
    if (!open.length) lines.push('*None.*', '');
    const groups = [{ id: 'unsorted', heading: 'Not yet categorised' }, ...config.categories];
    for (const category of groups) {
      const items = open.filter((p) => categoryOf(config, p) === category.id);
      if (!items.length) continue;
      lines.push(`### ${category.heading}`, '');
      for (const p of items) {
        const tally = tallyVotes(p, votes, config);
        const notes = [STATUS_LABELS[p.status] || p.status];
        if (tally.n) notes.push(voteSummary(tally, config));
        lines.push(`- ${listItemText(p.text, 2)} *(${notes.join('; ')})*`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

const escapeCell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ');

export function caseRecordMarkdown(config, responses, { date = new Date() } = {}) {
  const decisions = config.decisions;
  const tagsById = byId(config.tags);
  const stats = allCaseStats(config, responses);
  const people = new Set(responses.map((r) => r.participant_code));
  const lines = [
    '# Case decisions and rationale',
    '',
    `${config.title} · exported ${formatDateTime(date)} · ${responses.length} responses from ${people.size} participants.`,
    '',
    'Rationales are anonymised. *Disagreement* is the chance that two randomly chosen reviewers of a case chose different options (0 = unanimous, 1 = no two agree).',
    '',
    '## Summary',
    '',
    `| # | Case | Responses | ${decisions.map((d) => d.label).join(' | ')} | Disagreement |`,
    `|---|---|---|${decisions.map(() => '---').join('|')}|---|`,
  ];
  for (const s of stats) {
    const dis = s.disagreement == null ? '–' : s.disagreement.toFixed(2);
    lines.push(`| ${s.case.number} | ${escapeCell(s.case.title)} | ${s.n} | ${decisions.map((d) => s.counts[d.id]).join(' | ')} | ${dis} |`);
  }
  lines.push('');

  for (const s of stats) {
    lines.push(`## ${s.case.number}. ${s.case.title}`, '');
    if (s.case.summary) lines.push(`> ${s.case.summary}`, '');
    if (!s.n) {
      lines.push('*No responses.*', '');
      continue;
    }
    const dis = s.disagreement == null ? 'n/a' : s.disagreement.toFixed(2);
    lines.push(`**Decisions (${s.n}):** ${decisions.map((d) => `${d.label} ${s.counts[d.id]}`).join(' · ')}. Disagreement ${dis}.`, '');
    if (s.tags.length) {
      const tagText = s.tags.map((t) => `${t.tag.label} (${t.total})`).join(', ');
      lines.push(`**Factors cited:** ${tagText}.`, '');
    }
    if (s.otherTexts.length) lines.push(`**Other factors:** ${s.otherTexts.join('; ')}.`, '');
    if (s.confidence.n) lines.push(`**Mean confidence:** ${s.confidence.mean.toFixed(1)} / 5 (${s.confidence.n} answers).`, '');

    for (const d of decisions) {
      const items = s.rationales.filter((r) => r.decision === d.id);
      if (!items.length) continue;
      lines.push(`### ${d.label}`, '');
      for (const r of items) {
        const meta = [];
        if (r.tags.length) meta.push(r.tags.map((t) => (t === 'other' && r.otherTag ? `Other: ${r.otherTag}` : tagsById.get(t)?.label || t)).join(', '));
        if (r.confidence) meta.push(`confidence ${r.confidence}/5`);
        const text = r.text ? listItemText(r.text, 2) : '*(no rationale given)*';
        lines.push(`- ${text}${meta.length ? ` *(${meta.join('; ')})*` : ''}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trim()}\n`;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header, rows) {
  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function responsesCsv(config, responses) {
  const cases = byId(config.cases);
  const decisions = byId(config.decisions);
  const names = pseudonyms(responses.map((r) => r.participant_code), config.id);
  const rows = responses
    .slice()
    .sort((a, b) => (cases.get(a.case_id)?.number ?? 999) - (cases.get(b.case_id)?.number ?? 999) || names.get(a.participant_code).localeCompare(names.get(b.participant_code)))
    .map((r) => [
      config.id,
      cases.get(r.case_id)?.number ?? '',
      r.case_id,
      cases.get(r.case_id)?.title ?? '',
      names.get(r.participant_code),
      r.decision,
      decisions.get(r.decision)?.label ?? r.decision,
      (r.tags || []).join(';'),
      r.other_tag || '',
      r.confidence ?? '',
      r.rationale || '',
      r.created_at || '',
      r.updated_at || '',
    ]);
  return toCsv(
    ['workshop', 'case_number', 'case_id', 'case_title', 'respondent', 'decision', 'decision_label', 'tags', 'other_tag', 'confidence', 'rationale', 'created_at', 'updated_at'],
    rows,
  );
}

export function principlesCsv(config, principles, votes) {
  const categories = byId(config.categories);
  const rows = sortPrinciples(principles).map((p) => {
    const tally = tallyVotes(p, votes, config);
    return [
      config.id,
      p.category,
      categories.get(p.category)?.heading ?? '',
      p.status,
      p.version,
      p.text,
      ...config.votes.map((v) => tally.counts[v.id]),
      p.source_case_id || '',
      p.proposed_by === 'facilitator' ? 'facilitator' : 'participant',
      p.created_at || '',
    ];
  });
  return toCsv(
    ['workshop', 'category', 'heading', 'status', 'round', 'text', ...config.votes.map((v) => `votes_${v.id}`), 'source_case', 'proposed_by', 'created_at'],
    rows,
  );
}

export function backupJson(config, data) {
  return `${JSON.stringify(
    {
      app: 'malariasimulation-constitution-workshop',
      format: 1,
      exported_at: new Date().toISOString(),
      workshop: config.id,
      settings: {
        decisions: config.decisions,
        tags: config.tags,
        categories: config.categories,
        votes: config.votes,
      },
      cases: config.cases,
      participants: data.participants,
      responses: data.responses,
      principles: data.principles,
      votes: data.votes,
    },
    null,
    2,
  )}\n`;
}

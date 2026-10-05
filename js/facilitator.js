// Facilitator app: a guided, step-by-step run of the workshop.
//
//   1 Get ready -> 2 Review -> 3 Discuss -> 4 Tidy -> 5 Vote -> 6 Finish
//
// Each step is one page with one job, a short "what to do now" note, an
// optional timer and a Next button. Checks and admin (connection test, roster,
// coverage, demo data) live on a separate Setup page, out of the way.

import { coverageCounts, currentAssignments, planAssignments } from './assign.js';
import { byId, categoryList, loadConfig } from './data.js';
import { generateDemo } from './demo.js';
import { backupJson, caseRecordMarkdown, constitutionMarkdown, principlesCsv, responsesCsv, sortPrinciples, unsortedRatified } from './export.js';
import { html, raw } from './html.js';
import { allCaseStats, LEVEL_LABELS, overallTagStats, sortByDisagreement, tallyVotes } from './stats.js';
import { createStore } from './store.js';
import {
  createRenderer,
  decisionVars,
  delegate,
  errorScreen,
  installTooltips,
  legend,
  lengthBar,
  logo,
  meter,
  sparkleBurst,
  sparkles,
  stackedBar,
  syncBadge,
  toast,
  voteVars,
} from './ui.js';
import { copyText, download, pct, plural, storage, uuid } from './util.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);

const SCALES = [0.85, 1, 1.15, 1.3, 1.5, 1.75];

const STEPS = [
  { id: 'ready', label: 'Get ready', title: 'Get ready' },
  { id: 'review', label: 'Review', title: 'Everyone reviews their cases', timer: true },
  { id: 'discuss', label: 'Discuss', title: 'Discuss the most contested cases', timer: true },
  { id: 'tidy', label: 'Tidy', title: 'Tidy up the principles', timer: true },
  { id: 'vote', label: 'Vote', title: 'Vote on the principles', timer: true },
  { id: 'finish', label: 'Finish', title: 'Finish and save' },
];

const STATUS = { proposed: 'Not voted on yet', voting: 'Voting open', ratified: 'Adopted', parked: 'Dropped' };

const F = {
  config: null,
  store: null,
  plan: new Map(),
  joined: [],
  responses: [],
  principles: [],
  votes: [],
  loaded: false,
  unlocked: false,
  keyError: '',
  online: true,
  signature: '',
  drag: null,
  ui: {
    scale: storage.get('cw:facilitator:scale', 1),
    hideTips: storage.get('cw:facilitator:hide-tips', false),
    revealedSeeds: new Set(), // cases whose suggested principle is showing
    sectionSeeds: new Set(), // empty sections whose suggested principle is showing (Tidy)
    editing: null,
    editDraft: null,
    exportOpts: { includeTallies: true, includeUnratified: false },
    check: null,
  },
};

let casesById = new Map();
let categoryIds = new Set();

const renderer = createRenderer(root, view);
const render = (opts) => renderer.render(opts);

// ---- routing ----------------------------------------------------------------------

const stepKey = () => `cw:${F.config.id}:facilitator-step`;

function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'setup') return { name: 'setup' };
  const step = STEPS.find((s) => s.id === name);
  return { name: step ? step.id : 'ready', arg: arg ? decodeURIComponent(arg) : null };
}

window.addEventListener('hashchange', () => {
  F.ui.editing = null;
  F.ui.editDraft = null;
  const r = route();
  if (F.config && r.name !== 'setup') storage.set(stepKey(), r.name);
  render({ force: true });
  window.scrollTo(0, 0);
});

// ---- derived data -------------------------------------------------------------------

const assignments = () => currentAssignments(F.plan, F.joined);
const categoryOf = (p) => (categoryIds.has(p.category) ? p.category : 'unsorted');
const principlesIn = (category) => sortPrinciples(F.principles.filter((p) => categoryOf(p) === category));
const maxPosition = (category) => F.principles.filter((p) => categoryOf(p) === category).reduce((m, p) => Math.max(m, Number(p.position) || 0), 0);
const categoryLabel = (p) => (categoryList(F.config).find((c) => c.id === categoryOf(p)) || {}).label;
const threshold = () => Math.round(F.config.ratifyThreshold * 100);

// Discussion order: most disagreement first.
const orderedStats = () => sortByDisagreement(allCaseStats(F.config, F.responses));

function bySectionOrder(list) {
  const order = new Map(categoryList(F.config).map((c, i) => [c.id, i]));
  return list.slice().sort((a, b) => order.get(categoryOf(a)) - order.get(categoryOf(b)) || a.position - b.position || String(a.created_at).localeCompare(String(b.created_at)));
}

function reviewProgress() {
  const current = assignments();
  const answered = new Set(F.responses.map((r) => `${r.participant_code}::${r.case_id}`));
  const people = F.joined.map((person) => {
    const cases = current.get(person.code) || [];
    return { person, total: cases.length, done: cases.filter((c) => answered.has(`${person.code}::${c}`)).length };
  });
  const assigned = people.reduce((s, p) => s + p.total, 0);
  const done = people.reduce((s, p) => s + p.done, 0);
  return { people, assigned, done, extra: F.responses.length - done };
}

// ---- shared bits ----------------------------------------------------------------------

const decisionSegments = (counts) => F.config.decisions.map((d) => ({ label: d.label, value: counts[d.id] || 0, vars: decisionVars(d) }));
const decisionLegend = () => legend(F.config.decisions.map((d) => ({ label: d.label, vars: decisionVars(d) })));

const ICONS = {
  high: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 14.5V8.5M8 8.5 3 2.5M8 8.5l5-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  some: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor"/></svg>',
  low: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  none: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

function levelBadge(s) {
  return html`<span class="level-badge level-${s.level}">${raw(ICONS[s.level])}${LEVEL_LABELS[s.level]}</span>`;
}

function confidenceDots(value) {
  if (!value) return '';
  return html`<span class="conf" title="Confidence ${value} of 5" aria-label="Confidence ${value} of 5">${[1, 2, 3, 4, 5].map((i) => html`<i class="${i <= value ? 'on' : ''}"></i>`)}</span>`;
}

function participantUrl(code) {
  const url = new URL('./', location.href);
  if (params.get('ws')) url.searchParams.set('ws', params.get('ws'));
  if (params.get('backend')) url.searchParams.set('backend', params.get('backend'));
  if (code) url.searchParams.set('p', code);
  return url.toString();
}

// For reading off the projector and typing in: browsers add the https:// themselves.
const displayUrl = (url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

// ---- timers (per step, kept in this browser) ---------------------------------------------

const timerKey = () => `cw:${F.config.id}:facilitator-timers`;
const minutesFor = (stepId) => Number(F.config.schedule?.[stepId]) || 0;

function timerState(stepId) {
  const saved = storage.get(timerKey(), {})[stepId];
  return saved || { remaining: minutesFor(stepId) * 60000, endsAt: null };
}

function saveTimer(stepId, state) {
  const all = storage.get(timerKey(), {});
  all[stepId] = state;
  storage.set(timerKey(), all);
}

const timeLeft = (t) => (t.endsAt ? t.endsAt - Date.now() : t.remaining);

function formatTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function timerWidget(stepId) {
  const minutes = minutesFor(stepId);
  if (!minutes) return '';
  const t = timerState(stepId);
  const left = timeLeft(t);
  const running = Boolean(t.endsAt);
  const untouched = !running && t.remaining === minutes * 60000;
  return html`<div class="timer ${left <= 0 ? 'up' : ''} ${running ? 'running' : ''}" id="step-timer" data-step="${stepId}">
    <span class="timer-label" id="step-timer-label">${left <= 0 ? "Time's up" : `Suggested: ${minutes} min`}</span>
    <span class="timer-time" id="step-timer-time">${formatTime(left)}</span>
    <button class="btn btn-small ${running ? 'btn-secondary' : 'btn-primary'}" data-action="timer" data-op="${running ? 'pause' : 'start'}" data-step="${stepId}">${running ? 'Pause' : untouched ? 'Start timer' : 'Resume'}</button>
    ${untouched ? '' : html`<button class="icon-btn" data-action="timer" data-op="reset" data-step="${stepId}" title="Reset the timer" aria-label="Reset the timer">↺</button>`}
  </div>`;
}

// Tick the visible timer without re-rendering the page.
setInterval(() => {
  const el = document.getElementById('step-timer');
  if (!el || !F.config) return;
  const left = timeLeft(timerState(el.dataset.step));
  const time = document.getElementById('step-timer-time');
  if (time) time.textContent = formatTime(left);
  if (left <= 0 && !el.classList.contains('up')) {
    el.classList.add('up');
    const label = document.getElementById('step-timer-label');
    if (label) label.textContent = "Time's up";
  }
}, 1000);

// ---- page frame ------------------------------------------------------------------------------

function view() {
  if (!F.unlocked) return keyGate();
  const r = route();
  let body = html`<p class="muted">Loading…</p>`;
  if (F.loaded) {
    if (r.name === 'setup') body = setupView();
    else if (r.name === 'review') body = reviewView();
    else if (r.name === 'discuss') body = discussView(r.arg);
    else if (r.name === 'tidy') body = tidyView();
    else if (r.name === 'vote') body = voteView();
    else if (r.name === 'finish') body = finishView();
    else body = readyView();
  }
  return html`${header(r)}<main class="page page-wide" id="main">${body}</main>`;
}

function keyGate() {
  return html`<main class="join">
    <section class="join-card card">
      ${sparkles(8, { seed: 13 })}
      <div class="join-logo">${logo(56)}</div>
      <p class="eyebrow">${F.config?.title || ''}</p>
      <h1>Facilitator view</h1>
      <form class="join-form" data-submit="unlock">
        <label for="fkey">Facilitator key</label>
        <div class="input-row">
          <input id="fkey" name="key" type="password" autocomplete="off" required>
          <button class="btn btn-primary" type="submit">Open</button>
        </div>
        ${F.keyError ? html`<p class="form-error" role="alert">${F.keyError}</p>` : ''}
      </form>
      <p class="muted small">Taking part? Use the <a href="${participantUrl()}">participant page</a> instead.</p>
    </section>
  </main>`;
}

function header(r) {
  const index = STEPS.findIndex((s) => s.id === r.name);
  const open = F.principles.filter((p) => p.status === 'voting').length;
  return html`<header class="topbar">
    ${sparkles(12, { seed: 3, white: true, size: [5, 10] })}
    <div class="topbar-inner">
      <a class="brand" href="#/ready">${logo()}<span class="brand-text"><span class="brand-name">malariasimulation</span><span class="brand-sub">constitution workshop · facilitator</span></span></a>
      <nav class="stepper" aria-label="Workshop steps">
        ${STEPS.map(
          (s, i) => html`<a class="step-link ${index > i ? 'done' : ''} ${index === i ? 'current' : ''}" href="#/${s.id}" aria-current="${index === i ? 'step' : 'false'}">
            <span class="step-num">${index > i ? '✓' : i + 1}</span><span class="step-label">${s.label}</span>${s.id === 'vote' && open ? html`<span class="tab-badge" title="Open for voting">${open}</span>` : ''}
          </a>`,
        )}
      </nav>
      <div class="topbar-right">
        <span id="sync-slot">${syncBadge(F.store, F.online)}</span>
        <span class="tool-group" role="group" aria-label="Text size">
          <button class="icon-btn" data-action="scale" data-dir="-1" title="Smaller text" aria-label="Smaller text">A−</button>
          <button class="icon-btn" data-action="scale" data-dir="1" title="Larger text (for projecting)" aria-label="Larger text">A+</button>
        </span>
        <button class="icon-btn" data-action="theme" title="Switch light/dark" aria-label="Switch light or dark theme">◐</button>
        <a class="icon-btn ${r.name === 'setup' ? 'active' : ''}" href="#/setup" title="Setup and checks" aria-label="Setup and checks">⚙</a>
      </div>
    </div>
  </header>`;
}

const GUIDE = {
  ready: () => html`Put this screen on the projector. Ask everyone to open the link below on their laptop and ${F.config.roster.length ? 'pick' : 'type'} their name. While they join (they appear under <b>Joined so far</b>), talk them through <b>What we'll do</b>.`,
  review: () => html`Everyone works through their cases on their own: where does each change belong, and why? The results stay hidden on this screen so nobody is swayed. Move on when most people have finished; anyone still going can carry on.`,
  discuss: () => html`Start at the top: these are the cases where people disagreed most. Ask someone from each side to explain their reasoning. When the group lands on a rule (“we'd only accept this if…”), click <b>Capture a principle</b>. If things stall, <b>💡 Show a suggested principle</b> gives the group a rule to test.`,
  tidy: () => html`A quick tidy before voting: give every principle a section, drop duplicates, and fix the wording. A section still empty? Ask the group for a rule, or click <b>💡 Suggest a principle</b> in that section.`,
  vote: () => html`Open voting and ask everyone to go to the <b>Principles</b> tab on their laptop. Adopt principles with clear support (${threshold()}% agree or more). If lots of people chose Amend, reword it using their suggestions: that starts a fresh vote on the new wording.`,
  finish: () => html`Download the draft constitution, and keep the workshop record for reference. You can go back to any step if you need to.`,
};

function stepPage(stepId, body) {
  const i = STEPS.findIndex((s) => s.id === stepId);
  const step = STEPS[i];
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  const tips = !F.ui.hideTips;
  return html`
    <section class="step-head">
      <div>
        <p class="eyebrow">Step ${i + 1} of ${STEPS.length}</p>
        <h1>${step.title}</h1>
      </div>
      <div class="step-tools">
        ${tips ? '' : html`<button class="btn btn-quiet btn-small" data-action="toggle-tips">Show tips</button>`}
        ${step.timer ? timerWidget(stepId) : ''}
      </div>
    </section>
    ${tips
      ? html`<div class="guide">
          <p>${GUIDE[stepId]()}</p>
          <button class="guide-hide btn-link small" data-action="toggle-tips" title="Hide these tips on every step (e.g. while projecting)">Hide tips</button>
        </div>`
      : ''}
    ${body}
    <div class="step-fill"></div>
    <nav class="step-nav" aria-label="Step navigation">
      ${prev ? html`<a class="btn btn-quiet" href="#/${prev.id}">← ${prev.label}</a>` : html`<span></span>`}
      ${next ? html`<a class="btn btn-primary btn-large" href="#/${next.id}">Next: ${next.label} →</a>` : html`<span class="muted small">That's the end of the workshop. Thank you!</span>`}
    </nav>`;
}

// ---- step 1: get ready -------------------------------------------------------------------------

// The session at a glance, worded for participants, to talk through while
// people join. Same numbers as the steps along the top; times from `schedule`.
const PLAN = {
  ready: { label: 'Join', text: () => `Open the link and ${F.config.roster.length ? 'pick' : 'type'} your name.` },
  review: { text: () => 'On your own, decide where each proposed change belongs, and why.' },
  discuss: { text: () => 'Together, we talk through the most contested cases and capture principles.' },
  tidy: { text: () => 'We sort the principles into sections.' },
  vote: { text: () => `On your laptop, vote ${orList(F.config.votes.map((v) => v.label))} on each principle.` },
  finish: { text: () => 'The adopted principles become a first draft of the constitution.' },
};

const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items[0] || '');

function planCard() {
  const minutes = (id) => Number(F.config.schedule[id]) || 0;
  return html`<section class="card plan-card">
    <h2 class="card-title">What we'll do</h2>
    <ol class="plan">
      ${STEPS.map((s, i) => {
        const time = s.id === 'ready' ? 'now' : minutes(s.id) ? `${minutes(s.id)} min` : '';
        return html`<li class="${s.id === 'ready' ? 'current' : ''}">
          <span class="plan-num" aria-hidden="true">${i + 1}</span>
          <span class="plan-title">${PLAN[s.id].label || s.label}${time ? html` <span class="plan-time">${time}</span>` : ''}</span>
          <p class="plan-text">${PLAN[s.id].text()}</p>
        </li>`;
      })}
    </ol>
  </section>`;
}

function readyView() {
  const rosterCodes = new Set(F.config.roster.map((p) => p.code));
  const joinedCodes = new Set(F.joined.map((p) => p.code));
  const waiting = F.config.roster.filter((p) => !joinedCodes.has(p.code));
  const live = F.store.kind === 'supabase';
  return stepPage(
    'ready',
    html`
      <div class="ready-grid">
        <section class="card join-panel">
          <p class="eyebrow">Link for participants</p>
          <p class="join-big">${displayUrl(participantUrl())}</p>
          <div class="btn-row">
            <button class="btn btn-secondary" data-action="copy-text" data-text="${participantUrl()}">Copy link</button>
            <a class="btn btn-quiet" href="${participantUrl()}" target="_blank" rel="noopener">Open it in a new tab ↗</a>
          </div>
        </section>
        <section class="card status-panel">
          ${!live
            ? html`<p class="status-big warn">Demo mode</p>
                <p class="muted">Answers stay in this browser only, so other laptops can't take part. Fine for practice; for the real workshop add your Supabase details (README, step 2).</p>`
            : F.online
              ? html`<p class="status-big ok">✓ Connected</p><p class="muted">Everyone's answers will appear here.</p>`
              : html`<p class="status-big bad">✕ Can't reach the database</p><p class="muted">Check the internet connection, then use ⚙ Setup → Test connection.</p>`}
          <p class="muted small">Workshop space: <code>${F.config.id}</code>${params.get('ws') ? ' (a separate practice space)' : ''}</p>
        </section>
      </div>
      ${planCard()}
      <section class="card">
        <h2 class="card-title">Joined so far: ${F.joined.length}${F.config.roster.length ? html` <span class="muted">of ${F.config.roster.length} on the list</span>` : ''}</h2>
        ${F.joined.length
          ? html`<div class="people">${F.joined.map((p) => html`<span class="person">${p.name}${rosterCodes.has(p.code) || !rosterCodes.size ? '' : html` <span class="muted small">guest</span>`}</span>`)}</div>`
          : html`<p class="muted">Nobody yet. People appear here as they open the link and join.</p>`}
        ${F.joined.length && waiting.length && waiting.length <= 12
          ? html`<p class="muted small">Not here yet: ${waiting.map((p) => p.name).join(', ')}</p>`
          : ''}
      </section>`,
  );
}

// ---- step 2: review ------------------------------------------------------------------------------

function reviewView() {
  const progress = reviewProgress();
  const share = progress.assigned ? progress.done / progress.assigned : 0;
  const finished = progress.people.filter((p) => p.total && p.done >= p.total).length;
  return stepPage(
    'review',
    html`
      <section class="card progress-hero">
        <p class="progress-big"><span class="hero-figure">${progress.done}</span><span class="muted">of ${progress.assigned || '–'} reviews done</span></p>
        <div class="progress-track big" role="progressbar" aria-valuemin="0" aria-valuemax="${progress.assigned}" aria-valuenow="${progress.done}" aria-label="Reviews done">
          <span class="progress-fill" style="width:${(100 * share).toFixed(1)}%"></span>
        </div>
        <p class="muted">${finished} of ${plural(progress.people.length, 'person', 'people')} finished${progress.extra > 0 ? ` · plus ${plural(progress.extra, 'extra review')} by people who finished early` : ''}</p>
      </section>
      ${progress.people.length
        ? html`<section class="card">
            <h2 class="card-title">Who's done</h2>
            <div class="people">${progress.people.map((p) => html`<span class="person ${p.total && p.done >= p.total ? 'finished' : ''}">${p.person.name} <b>${p.done}/${p.total}</b></span>`)}</div>
          </section>`
        : html`<div class="card empty"><p>Nobody has joined yet. Go back to step 1 and share the link.</p></div>`}
      <p class="muted small center">🔒 Results are hidden until the next step.</p>`,
  );
}

// ---- step 3: discuss -------------------------------------------------------------------------------

function discussView(arg) {
  if (!F.responses.length) {
    return stepPage('discuss', html`<div class="card empty"><p>No answers yet. Go back to step 2 while people review their cases.</p></div>`);
  }
  const ordered = orderedStats();
  const overview = arg === 'all';
  const idx = overview ? -1 : Math.max(0, ordered.findIndex((s) => s.case.id === arg));
  const s = overview ? null : ordered[idx];
  const captured = F.principles.length;

  const strip = html`<nav class="case-strip" aria-label="Cases, most disagreement first">
    <span class="muted small strip-label">Most disagreement first:</span>
    ${ordered.map(
      (x, i) => html`<a class="case-chip level-${x.level} ${!overview && x.case.id === s.case.id ? 'current' : ''}" href="#/discuss/${encodeURIComponent(x.case.id)}" data-tip="${x.case.title}">
        <span class="chip-rank">${i + 1}</span>Case ${x.case.number}</a>`,
    )}
    <a class="case-chip overview ${overview ? 'current' : ''}" href="#/discuss/all">All cases</a>
  </nav>`;

  const capture = html`<button class="btn btn-primary" data-action="new-principle" data-case="${s?.case.id || ''}">✚ Capture a principle</button>
    ${captured ? html`<a class="muted small" href="#/tidy">${plural(captured, 'principle')} captured so far</a>` : ''}`;

  if (overview) {
    return stepPage(
      'discuss',
      html`${strip}
        <div class="toolbar">
          <div class="discuss-tools">${capture}</div>
          ${decisionLegend()}
        </div>
        <div class="result-grid">${ordered.map((x) => resultCard(x))}</div>
        ${factorsPanel()}`,
    );
  }

  const prev = ordered[idx - 1];
  const next = ordered[idx + 1];
  const c = s.case;
  const seedShown = c.suggestedPrinciple && F.ui.revealedSeeds.has(c.id);
  return stepPage(
    'discuss',
    html`${strip}
      <header class="focus-head">
        <div class="focus-title">
          <p class="eyebrow">Case ${c.number} · ${plural(s.n, 'response')} · ${idx + 1} of ${ordered.length} by disagreement</p>
          <h1>${c.title}</h1>
          <p class="focus-summary">${c.summary}</p>
        </div>
        <div class="focus-side">
          ${levelBadge(s)}
          ${s.level !== 'none' ? html`<p class="hero-figure">${pct(s.disagreement)}</p><p class="muted small">chance two reviewers disagree</p>` : ''}
          <div class="discuss-tools">
            ${capture}
            ${c.suggestedPrinciple && !seedShown
              ? html`<button class="btn btn-secondary btn-small" data-action="toggle-seed" data-case="${c.id}" title="A rule the group could test against this case. Try letting people talk first.">💡 Show a suggested principle</button>`
              : ''}
          </div>
        </div>
      </header>
      ${seedShown ? seedCard(c) : ''}
      <div class="focus-grid">
        <section class="card">
          <h2 class="card-title">Where should it belong?</h2>
          ${decisionRows(s)}
        </section>
        <section class="card">
          <h2 class="card-title">What influenced the decisions</h2>
          ${tagRows(s)}
        </section>
      </div>
      <section class="block">
        <h2>Why people decided as they did</h2>
        ${rationaleColumns(s)}
      </section>
      <nav class="case-nav">
        ${prev ? html`<a class="btn btn-secondary" href="#/discuss/${encodeURIComponent(prev.case.id)}">← Previous case</a>` : html`<span></span>`}
        <span class="muted small">Tip: the ← → keys move between cases</span>
        ${next ? html`<a class="btn btn-secondary" href="#/discuss/${encodeURIComponent(next.case.id)}">Next case →</a>` : html`<a class="btn btn-secondary" href="#/discuss/all">All cases</a>`}
      </nav>`,
  );
}

// A prepared rule to test against the case (from cases.json), revealed on request.
function seedCard(c) {
  const section = F.config.categories.find((x) => x.id === c.suggestedSection);
  const captured = F.principles.some((p) => p.text.trim() === c.suggestedPrinciple);
  return html`<section class="card seed-card">
    <div class="seed-head">
      <p class="eyebrow">💡 A principle to test${section ? ` · ${section.label}` : ''}</p>
      <button class="btn-link small" data-action="toggle-seed" data-case="${c.id}">Hide</button>
    </div>
    <p class="seed-text">${c.suggestedPrinciple}</p>
    <div class="btn-row">
      ${captured
        ? html`<span class="ready">✓ Captured</span>`
        : html`<button class="btn btn-primary btn-small" data-action="capture-seed" data-case="${c.id}">Capture it</button>
            <span class="muted small">You can edit the wording before it's added.</span>`}
    </div>
    <p class="muted small seed-ask">Would the group sign up to this? What would have to change?</p>
  </section>`;
}

function resultCard(s) {
  const c = s.case;
  return html`<a class="result-card card level-${s.level}" href="#/discuss/${encodeURIComponent(c.id)}">
    <div class="rc-top">
      <span class="case-num">Case ${c.number}</span>
      ${levelBadge(s)}
    </div>
    <h3>${c.title}</h3>
    ${stackedBar(decisionSegments(s.counts), { total: s.n })}
    <div class="rc-meta">
      <span>${plural(s.n, 'response')}</span>
      ${s.level !== 'none'
        ? html`<span class="rc-dis" data-tip="Chance two reviewers disagree: ${pct(s.disagreement)}">${meter(s.disagreement, { label: 'Disagreement' })}<b>${pct(s.disagreement)}</b></span>`
        : ''}
    </div>
    ${s.tags.length ? html`<div class="rc-tags">${s.tags.slice(0, 3).map((t) => html`<span class="mini-chip">${t.tag.label} <b>${t.total}</b></span>`)}</div>` : ''}
  </a>`;
}

function factorsPanel() {
  const rows = overallTagStats(F.config, F.responses).filter((r) => r.total > 0);
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r.total));
  return html`<section class="card factors-card">
    <div class="block-head">
      <h2>Factors behind the decisions, across all cases</h2>
      ${decisionLegend()}
    </div>
    <div class="factor-rows">
      ${rows.map((r) => html`<div class="factor-row"><span class="factor-label">${r.tag.label}</span>${lengthBar(decisionSegments(r.byDecision), max)}</div>`)}
    </div>
    <p class="muted small">How often each factor was cited, split by the decision it was cited for. Patterns here are good seeds for principles.</p>
  </section>`;
}

function decisionRows(s) {
  if (!s.n) return html`<p class="muted">No responses yet.</p>`;
  const showConfidence = s.confidence.n > 0;
  return html`<table class="dec-table">
      <thead><tr><th scope="col">Decision</th><th scope="col"><span class="sr-only">Proportion</span></th><th scope="col" class="num">Count</th><th scope="col" class="num">Share</th>${showConfidence ? html`<th scope="col" class="num">Mean confidence</th>` : ''}</tr></thead>
      <tbody>
        ${F.config.decisions.map((d) => {
          const count = s.counts[d.id];
          const share = count / s.n;
          const conf = s.confidence.byDecision[d.id];
          return html`<tr style="${decisionVars(d)}" class="${count ? '' : 'zero'}">
            <th scope="row"><span class="swatch"></span>${d.label}</th>
            <td class="dec-bar-cell"><span class="dec-bar"><span class="dec-fill" style="width:${(100 * share).toFixed(1)}%"></span></span></td>
            <td class="num"><b>${count}</b></td>
            <td class="num">${pct(share)}</td>
            ${showConfidence ? html`<td class="num">${conf == null ? '–' : conf.toFixed(1)}</td>` : ''}
          </tr>`;
        })}
      </tbody>
    </table>
    ${showConfidence ? html`<p class="muted small">Mean confidence overall ${s.confidence.mean.toFixed(1)} / 5, from ${plural(s.confidence.n, 'answer')}.</p>` : ''}`;
}

function tagRows(s) {
  if (!s.tags.length) return html`<p class="muted">No factors cited yet.</p>`;
  return html`${decisionLegend()}
    <div class="factor-rows">
      ${s.tags.map((t) => html`<div class="factor-row"><span class="factor-label">${t.tag.label}</span>${lengthBar(decisionSegments(t.byDecision), s.n)}</div>`)}
    </div>
    <p class="muted small">Bar length is the number of reviewers (of ${s.n}) who cited the factor.</p>
    ${s.otherTexts.length ? html`<p class="small"><b>Other factors:</b> ${s.otherTexts.join('; ')}</p>` : ''}`;
}

function rationaleColumns(s) {
  if (!s.n) return html`<div class="card empty"><p>No responses yet.</p></div>`;
  const tagsById = byId(F.config.tags);
  const cols = F.config.decisions.map((d) => ({ d, items: s.rationales.filter((r) => r.decision === d.id) })).filter((col) => col.items.length);
  return html`<div class="rat-cols" style="--cols:${cols.length}">
    ${cols.map(
      ({ d, items }) => html`<div class="rat-col" style="${decisionVars(d)}">
        <h3 class="rat-head"><span class="swatch"></span>${d.label} <span class="muted">${items.length}</span></h3>
        ${items.map(
          (r) => html`<blockquote class="quote">
            <p>${r.text || html`<span class="muted">(no reason given)</span>`}</p>
            <footer>
              <span class="quote-tags">${r.tags.map((t) => html`<span class="mini-chip">${t === 'other' && r.otherTag ? `Other: ${r.otherTag}` : tagsById.get(t)?.label || t}</span>`)}</span>
              ${confidenceDots(r.confidence)}
            </footer>
          </blockquote>`,
        )}
      </div>`,
    )}
  </div>`;
}

// ---- step 4: tidy ---------------------------------------------------------------------------------

function tidyView() {
  const active = F.principles.filter((p) => p.status !== 'parked');
  const dropped = sortPrinciples(F.principles.filter((p) => p.status === 'parked'));
  const unsorted = principlesIn('unsorted').filter((p) => p.status !== 'parked');
  const empty = F.config.categories.filter((c) => !principlesIn(c.id).some((p) => p.status !== 'parked'));
  return stepPage(
    'tidy',
    html`
      <div class="toolbar">
        <button class="btn btn-secondary" data-action="new-principle">✚ Add a principle</button>
        <span class="muted small">${active.length
          ? `${plural(active.length, 'principle')}${unsorted.length ? ` · ${unsorted.length} still need a section` : ' · all have a section ✓'}`
          : 'No principles yet: capture some in step 3, or start from the suggestions below.'}${empty.length && active.length ? ` · ${plural(empty.length, 'section')} still empty` : ''}</span>
      </div>
      <div class="sections">
        ${unsorted.length ? tidySection({ id: 'unsorted', heading: 'Needs a section', prompt: 'Pick a section for each of these, or drag them into place.' }, unsorted, true) : ''}
        ${F.config.categories.map((c) => tidySection(c, principlesIn(c.id).filter((p) => p.status !== 'parked')))}
      </div>
      ${dropped.length
        ? html`<section class="card dropped-card">
            <h2 class="h-small">Dropped (${dropped.length})</h2>
            <ul class="plain-list outcome-list">
              ${dropped.map((p) => html`<li><span class="outcome-text">${p.text}</span><button class="btn-link small" data-action="set-status" data-id="${p.id}" data-status="proposed">Restore</button></li>`)}
            </ul>
          </section>`
        : ''}`,
  );
}

function tidySection(category, items, highlight = false) {
  const suggestion = items.length || highlight ? null : sectionSuggestions(category.id)[0];
  return html`<section class="section-panel ${highlight ? 'unsorted' : ''} ${items.length ? '' : 'empty-section'}">
    <header class="section-head">
      <div>
        <h2>${category.heading || category.label}${items.length ? html` <span class="muted section-count">${items.length}</span>` : ''}</h2>
        ${category.prompt ? html`<p class="muted small">${category.prompt}</p>` : ''}
      </div>
    </header>
    <ol class="principle-list" data-drop="${category.id}">
      ${items.length ? items.map((p) => tidyCard(p)) : html`<li class="drop-empty">Empty: drag a principle here, or pick “${category.label}” from a principle's section menu.</li>`}
    </ol>
    ${suggestion ? sectionSeed(category, suggestion) : ''}
  </section>`;
}

// Starter principles for a section with nothing in it yet: the section's own
// suggestion (workshop.json), then those of the cases aimed at it. Ones already
// captured (in any section, even if dropped since) aren't offered again.
function sectionSuggestions(categoryId) {
  const category = F.config.categories.find((c) => c.id === categoryId);
  const taken = new Set(F.principles.map((p) => p.text.trim()));
  return [
    ...(category?.suggestedPrinciple ? [{ text: category.suggestedPrinciple, caseId: '' }] : []),
    ...F.config.cases.filter((c) => c.suggestedSection === categoryId && c.suggestedPrinciple).map((c) => ({ text: c.suggestedPrinciple, caseId: c.id })),
  ].filter((s) => !taken.has(s.text.trim()));
}

function sectionSeed(category, suggestion) {
  if (!F.ui.sectionSeeds.has(category.id)) {
    return html`<button class="btn btn-quiet btn-small section-seed-btn" data-action="toggle-section-seed" data-section="${category.id}">💡 Suggest a principle</button>`;
  }
  const source = suggestion.caseId ? casesById.get(suggestion.caseId) : null;
  return html`<div class="section-seed">
    <p class="seed-text">${suggestion.text}</p>
    <div class="btn-row">
      <button class="btn btn-primary btn-small" data-action="capture-section-seed" data-section="${category.id}">Capture it</button>
      <button class="btn-link small" data-action="toggle-section-seed" data-section="${category.id}">Hide</button>
      ${source ? html`<span class="muted small">From case ${source.number}: ${source.title}</span>` : ''}
    </div>
  </div>`;
}

function sectionSelect(p) {
  return html`<label class="sr-only" for="cat-${p.id}">Section</label>
    <select id="cat-${p.id}" class="select-small" data-change="move-category" data-id="${p.id}">
      ${categoryOf(p) === 'unsorted' ? html`<option value="unsorted" selected>Choose a section…</option>` : ''}
      ${F.config.categories.map((c) => html`<option value="${c.id}" ${categoryOf(p) === c.id ? 'selected' : ''}>${c.label}</option>`)}
    </select>`;
}

function metaLine(p) {
  const source = p.source_case_id ? casesById.get(p.source_case_id) : null;
  return html`<div class="p-meta">
    ${p.status !== 'proposed' ? html`<span class="status-pill status-${p.status}">${STATUS[p.status]}</span>` : ''}
    ${p.version > 1 ? html`<span class="meta-item">Round ${p.version}</span>` : ''}
    ${source ? html`<a class="meta-item" href="#/discuss/${encodeURIComponent(source.id)}">From case ${source.number}</a>` : ''}
    ${p.proposed_by && p.proposed_by !== 'facilitator' ? html`<span class="meta-item">Participant proposal</span>` : ''}
  </div>`;
}

function tidyCard(p) {
  const editing = F.ui.editing === p.id;
  const tally = tallyVotes(p, F.votes, F.config);
  return html`<li class="principle card tidy status-${p.status} ${editing ? 'editing' : ''}" data-id="${p.id}" draggable="${editing ? 'false' : 'true'}">
    ${editing ? html`<span></span>` : html`<span class="grip" aria-hidden="true" title="Drag to move"></span>`}
    <div class="p-body">
      ${metaLine(p)}
      ${editing
        ? editor(p, tally)
        : html`<p class="principle-text">${p.text}</p>
          <div class="p-actions">
            <div class="btn-row">
              ${sectionSelect(p)}
              <button class="btn btn-quiet btn-small" data-action="edit" data-id="${p.id}">Edit wording</button>
              <button class="btn btn-quiet btn-small" data-action="set-status" data-id="${p.id}" data-status="parked" title="Take it out of the constitution (kept on record; you can restore it)">Drop</button>
            </div>
            <div class="btn-row p-arrange">
              <button class="icon-btn" data-action="move" data-dir="-1" data-id="${p.id}" title="Move up" aria-label="Move up">↑</button>
              <button class="icon-btn" data-action="move" data-dir="1" data-id="${p.id}" title="Move down" aria-label="Move down">↓</button>
            </div>
          </div>`}
    </div>
  </li>`;
}

function editor(p, tally) {
  const draft = F.ui.editDraft || { text: p.text, category: categoryOf(p) };
  return html`<form class="p-editor" data-submit="save-edit" data-input="edit-draft" data-change="edit-draft" data-id="${p.id}">
    <label class="sr-only" for="edit-${p.id}">Principle wording</label>
    <textarea id="edit-${p.id}" name="text" rows="3" required>${draft.text}</textarea>
    <div class="field-row">
      <label>Section
        <select name="category">${categoryList(F.config).map((c) => html`<option value="${c.id}" ${draft.category === c.id ? 'selected' : ''}>${c.id === 'unsorted' ? 'No section yet' : c.label}</option>`)}</select>
      </label>
    </div>
    ${tally.n ? html`<p class="hint">Changing the wording starts a fresh vote (round ${p.version + 1}). The ${plural(tally.n, 'vote')} on the current wording ${tally.n === 1 ? 'is' : 'are'} kept for the record.</p>` : ''}
    <div class="btn-row">
      <button type="submit" class="btn btn-primary btn-small">Save</button>
      <button type="button" class="btn btn-quiet btn-small" data-action="cancel-edit">Cancel</button>
    </div>
  </form>`;
}

// ---- step 5: vote ------------------------------------------------------------------------------------

function voteView() {
  const ready = bySectionOrder(F.principles.filter((p) => p.status === 'proposed'));
  const open = bySectionOrder(F.principles.filter((p) => p.status === 'voting'));
  const adopted = bySectionOrder(F.principles.filter((p) => p.status === 'ratified'));
  const dropped = bySectionOrder(F.principles.filter((p) => p.status === 'parked'));
  const passing = open.filter((p) => tallyVotes(p, F.votes, F.config).meetsThreshold);

  if (!F.principles.length) {
    return stepPage(
      'vote',
      html`<div class="card empty">
        <p>There are no principles to vote on yet. Capture some in step 3, or add one here.</p>
        <button class="btn btn-primary" data-action="new-principle">✚ Add a principle</button>
      </div>`,
    );
  }

  return stepPage(
    'vote',
    html`
      ${ready.length
        ? html`<section class="card ready-card">
            <div>
              <p class="ready-title">${plural(ready.length, 'principle')} ready to vote on</p>
              <p class="muted small">${open.length ? `${ready.length === 1 ? "It isn't" : "These aren't"} open for voting yet.` : 'Once open, participants see them on their Principles tab.'}</p>
            </div>
            <button class="btn btn-primary btn-large" data-action="open-all">Open voting${ready.length > 1 ? ` on all ${ready.length}` : ''}</button>
          </section>`
        : ''}

      ${open.length
        ? html`<div class="vote-summary">
            <span><b>${open.length}</b> open for voting</span>
            <span><b>${adopted.length}</b> adopted</span>
            ${passing.length
              ? html`<button class="btn btn-primary" data-action="adopt-passing">✓ ${passing.length === 1 ? 'Adopt the one' : `Adopt all ${passing.length}`} that reached ${threshold()}%</button>`
              : html`<span class="muted small">A principle is ready to adopt once ${threshold()}% agree.</span>`}
          </div>
          <ol class="live-list">${open.map((p) => voteCard(p))}</ol>`
        : !ready.length
          ? html`<div class="card empty"><p>Nothing is open for voting right now.${adopted.length ? ' Everything has been decided: move on to Finish.' : ''}</p></div>`
          : ''}

      ${adopted.length
        ? html`<section class="block">
            <h2 class="h-small">Adopted (${adopted.length})</h2>
            <ul class="plain-list outcome-list">
              ${adopted.map((p) => html`<li><span class="status-dot status-ratified"></span><span class="outcome-text">${p.text} <span class="muted small">· ${categoryOf(p) === 'unsorted' ? 'no section yet' : categoryLabel(p)}</span></span><button class="btn-link small" data-action="set-status" data-id="${p.id}" data-status="voting">Undo</button></li>`)}
            </ul>
          </section>`
        : ''}

      ${dropped.length
        ? html`<section class="block">
            <h2 class="h-small">Dropped (${dropped.length})</h2>
            <ul class="plain-list outcome-list">
              ${dropped.map((p) => html`<li><span class="status-dot"></span><span class="outcome-text muted">${p.text}</span><button class="btn-link small" data-action="set-status" data-id="${p.id}" data-status="voting">Restore</button></li>`)}
            </ul>
          </section>`
        : ''}`,
  );
}

function voteCard(p) {
  const editing = F.ui.editing === p.id;
  const tally = tallyVotes(p, F.votes, F.config);
  return html`<li class="principle card live status-${p.status} ${editing ? 'editing' : ''}" data-id="${p.id}">
    <div class="p-body">
      <div class="p-meta">
        ${categoryOf(p) === 'unsorted' ? html`<span class="meta-item unsorted-note">No section yet</span>${sectionSelect(p)}` : html`<span class="meta-item">${categoryLabel(p)}</span>`}
        ${p.version > 1 ? html`<span class="meta-item">Round ${p.version}</span>` : ''}
      </div>
      ${editing ? editor(p, tally) : html`<p class="principle-text">${p.text}</p>`}
      ${voteResult(p, tally)}
      ${tally.comments.length ? commentList(tally) : ''}
      ${editing
        ? ''
        : html`<div class="btn-row vote-actions">
            <button class="btn ${tally.meetsThreshold ? 'btn-primary' : 'btn-secondary'}" data-action="set-status" data-id="${p.id}" data-status="ratified">✓ Adopt</button>
            <button class="btn btn-quiet" data-action="edit" data-id="${p.id}">Reword</button>
            <button class="btn btn-quiet" data-action="set-status" data-id="${p.id}" data-status="parked">Drop</button>
          </div>`}
    </div>
  </li>`;
}

function voteResult(p, tally) {
  const segments = F.config.votes.map((o) => ({ label: o.label, value: tally.counts[o.id], vars: voteVars(o) }));
  const participants = F.joined.length;
  return html`<div class="vote-result">
    <div class="vote-bar ${tally.n ? 'has-threshold' : ''}">
      ${stackedBar(segments, { total: tally.n, size: 'lg' })}
      ${tally.n ? html`<span class="threshold" style="left:${threshold()}%" data-tip="Adopt when at least ${threshold()}% agree"><span class="threshold-label">${threshold()}%</span></span>` : ''}
    </div>
    <div class="vote-counts">
      ${F.config.votes.map((o) => html`<span class="vc" style="${voteVars(o)}"><span class="swatch"></span>${o.label} <b>${tally.counts[o.id]}</b></span>`)}
      <span class="muted">${participants ? `${tally.n} of ${participants} voted` : plural(tally.n, 'vote')}</span>
      ${tally.meetsThreshold ? html`<span class="ready">✓ Ready to adopt</span>` : ''}
    </div>
    ${tally.history.length
      ? html`<p class="muted small">Earlier wording: ${tally.history.map((h) => `round ${h.version}: ${F.config.votes.map((o) => `${h.counts[o.id]} ${o.label.toLowerCase()}`).join(', ')}`).join('; ')}</p>`
      : ''}
  </div>`;
}

function commentList(tally) {
  const labels = byId(F.config.votes);
  return html`<div class="p-comments">
    <p class="muted small">Comments and suggested wording:</p>
    <ul>${tally.comments.map((c) => html`<li style="${voteVars(labels.get(c.vote) || { tone: 'mid' })}"><span class="swatch"></span><span class="muted small">${labels.get(c.vote)?.label || c.vote}:</span> ${c.comment}</li>`)}</ul>
  </div>`;
}

// ---- step 6: finish ----------------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

const EXPORTS = {
  constitution: () => ['malariasimulation-constitution.md', constitutionMarkdown(F.config, F.principles, F.votes, F.ui.exportOpts), 'text/markdown'],
  cases: () => [`case-decisions-${F.config.id}-${today()}.md`, caseRecordMarkdown(F.config, F.responses), 'text/markdown'],
  responses: () => [`responses-${F.config.id}-${today()}.csv`, responsesCsv(F.config, F.responses), 'text/csv'],
  principles: () => [`principles-${F.config.id}-${today()}.csv`, principlesCsv(F.config, F.principles, F.votes), 'text/csv'],
  backup: () => [
    `backup-${F.config.id}-${today()}.json`,
    backupJson(F.config, { participants: F.joined, responses: F.responses, principles: F.principles, votes: F.votes }),
    'application/json',
  ],
};

function finishView() {
  const [, markdown] = EXPORTS.constitution();
  const adopted = F.principles.filter((p) => p.status === 'ratified').length;
  const stillOpen = F.principles.filter((p) => p.status === 'voting').length;
  const homeless = unsortedRatified(F.config, F.principles).length;
  const { includeTallies, includeUnratified } = F.ui.exportOpts;
  const item = (what, title, detail) => html`<li>
    <div><b>${title}</b><span class="muted small">${detail}</span></div>
    <button class="btn btn-secondary btn-small" data-action="download" data-what="${what}">Download</button>
  </li>`;
  return stepPage(
    'finish',
    html`
      ${stillOpen
        ? html`<p class="notice">${plural(stillOpen, 'principle')} ${stillOpen === 1 ? 'is' : 'are'} still open for voting, so ${stillOpen === 1 ? 'it' : 'they'} won't be in the constitution unless adopted. <a href="#/vote">Back to voting</a> or <button class="btn-link" data-action="close-all">close voting</button>.</p>`
        : ''}
      ${homeless
        ? html`<p class="notice">${plural(homeless, 'adopted principle')} ${homeless === 1 ? 'has' : 'have'} no section, so the document lists ${homeless === 1 ? 'it' : 'them'} under “Not yet categorised”. <a href="#/tidy">Pick a section</a>.</p>`
        : ''}
      <div class="export-grid">
        <section class="card">
          <div class="block-head">
            <h2>The draft constitution</h2>
            <span class="muted">${plural(adopted, 'adopted principle')}</span>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary btn-large" data-action="download" data-what="constitution">⬇ Download the constitution</button>
            <button class="btn btn-secondary" data-action="copy-markdown">Copy text</button>
          </div>
          <div class="checks">
            <label class="check"><input type="checkbox" data-change="export-opt" name="includeTallies" ${includeTallies ? 'checked' : ''}> Include vote counts</label>
            <label class="check"><input type="checkbox" data-change="export-opt" name="includeUnratified" ${includeUnratified ? 'checked' : ''}> Add an appendix of proposals that weren't adopted</label>
          </div>
          <pre class="md-preview" tabindex="0" aria-label="Preview of the constitution (Markdown)">${markdown}</pre>
        </section>
        <section class="card">
          <h2>Workshop record</h2>
          <p class="muted small">For reference, or to analyse in R. Worth saving before you close the laptop.</p>
          <ul class="download-list">
            ${item('cases', 'Case decisions and rationale', 'Markdown · anonymised · every case with its tallies and reasons')}
            ${item('responses', 'Responses', 'CSV · anonymised · one row per answer')}
            ${item('principles', 'Principles and votes', 'CSV · every principle with its status and vote counts')}
            ${item('backup', 'Full backup', 'JSON · everything, including participant codes; keep it private')}
          </ul>
        </section>
      </div>`,
  );
}

// ---- setup & checks (not a step) -----------------------------------------------------------------------

function setupView() {
  const { config, store } = F;
  const current = assignments();
  const caseIds = config.cases.map((c) => c.id);
  const coverage = coverageCounts(current, caseIds);
  const joinedCodes = new Map(F.joined.map((j) => [j.code, j]));
  const rosterCodes = new Set(config.roster.map((p) => p.code));
  const guests = F.joined.filter((j) => !rosterCodes.has(j.code));
  const answered = new Set(F.responses.map((r) => `${r.participant_code}::${r.case_id}`));
  const responsesPerCase = new Map(caseIds.map((id) => [id, F.responses.filter((r) => r.case_id === id).length]));
  const people = [...config.roster, ...guests];
  const low = config.cases.filter((c) => coverage.get(c.id) < config.assignment.minReviews);
  // With no names list, cases are handed out as people join, so coverage builds up as they arrive.
  const open = !config.roster.length;
  const needed = Math.ceil((config.assignment.minReviews * caseIds.length) / config.assignment.perParticipant);
  const back = STEPS.find((s) => s.id === storage.get(stepKey())) || STEPS[0];

  return html`
    <p><a class="btn btn-quiet" href="#/${back.id}">← Back to the workshop (${back.label})</a></p>
    <section class="dash-head">
      <div><h1>Setup and checks</h1><p class="muted">Everything you might need before the session. You shouldn't need this page during it.</p></div>
    </section>
    <div class="grid-2">
      <section class="card">
        <h2>Storage</h2>
        <p><b>${store.label}</b> · workshop space <code>${config.id}</code></p>
        ${store.kind === 'local'
          ? html`<div class="notice">
              <p><b>Demo mode.</b> Everything is saved in this browser only, so other laptops can't see it. That's fine for trying things out: open participant pages in other tabs of this browser.</p>
              <p>For the real workshop, add your Supabase URL and key to <code>data/workshop.json</code> (see the README).</p>
            </div>`
          : html`<p class="muted small">Answers, principles and votes are shared through Supabase. Add <code>?ws=dry-run</code> to both links for a practice run that won't mix with the real data.</p>`}
        <div class="btn-row">
          <button class="btn btn-secondary" data-action="check">Test connection</button>
          ${store.kind === 'local'
            ? html`<button class="btn btn-secondary" data-action="demo-data">Fill with demo data</button>
                <button class="btn btn-quiet" data-action="clear-local">Clear demo data</button>`
            : ''}
        </div>
        ${F.ui.check
          ? html`<table class="simple-table check-table"><tbody>
              ${F.ui.check.map((r) => html`<tr class="${r.ok ? 'ok' : 'bad'}"><th scope="row">${r.ok ? '✓' : '✕'} ${r.table}</th><td>${r.message}</td></tr>`)}
            </tbody></table>`
          : ''}
      </section>
      <section class="card">
        <h2>Join link</h2>
        <p class="join-url"><code>${participantUrl()}</code></p>
        <div class="btn-row">
          <button class="btn btn-secondary" data-action="copy-text" data-text="${participantUrl()}">Copy link</button>
          <a class="btn btn-quiet" href="${participantUrl()}" target="_blank" rel="noopener">Open participant page ↗</a>
        </div>
        <p class="muted small">${open
          ? 'Participants type their name to join, and get their cases there and then.'
          : `Participants pick their name or type their code. Anyone not on the list can join as a guest${config.join.allowGuests ? '' : ' (currently switched off)'}.`}
          Personal links for each person are below.</p>
      </section>
    </div>

    ${config.warnings.length
      ? html`<section class="card warn-card"><h2>Check your data files</h2><ul>${config.warnings.map((w) => html`<li>${w}</li>`)}</ul></section>`
      : ''}

    <section class="card">
      <div class="block-head">
        <h2>Participants and their cases</h2>
        <span class="muted small">${open ? `${F.joined.length} joined` : `${config.roster.length} on the list · ${F.joined.length} joined · ${plural(guests.length, 'guest')}`} · ${config.assignment.perParticipant} cases each</span>
      </div>
      ${people.length ? '' : html`<p class="muted">Nobody has joined yet.</p>`}
      <div class="table-wrap" ${people.length ? '' : 'hidden'}>
        <table class="simple-table people-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Status</th><th scope="col">Cases (filled = done)</th><th scope="col" class="num">Done</th><th scope="col">Personal link</th></tr></thead>
          <tbody>
            ${people.map((p) => {
              const cases = current.get(p.code) || [];
              const done = cases.filter((c) => answered.has(`${p.code}::${c}`)).length;
              const joined = joinedCodes.get(p.code);
              const statusText = !joined ? 'Not joined' : rosterCodes.has(p.code) || open ? 'Joined' : 'Guest';
              return html`<tr>
                <th scope="row">${p.name}</th>
                <td><span class="status-chip ${joined ? 'on' : ''}">${statusText}</span></td>
                <td><span class="case-dots">${cases.map((id) => {
                  const c = casesById.get(id);
                  return html`<span class="case-dot ${answered.has(`${p.code}::${id}`) ? 'done' : ''}" data-tip="${c ? `${c.number}. ${c.title}` : id}">${c?.number ?? '?'}</span>`;
                })}</span></td>
                <td class="num">${done}/${cases.length}</td>
                <td>
                  <button class="btn-link small" data-action="copy-text" data-text="${participantUrl(p.code)}">Copy link</button>
                  ${joined && !rosterCodes.has(p.code)
                    ? html` · <button class="btn-link small" data-action="remove-guest" data-code="${p.code}" data-name="${p.name}">Remove</button>`
                    : ''}
                </td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <div class="block-head">
        <h2>Coverage</h2>
        <button class="btn btn-quiet btn-small" data-action="download-roster">Download participants.json with these assignments</button>
      </div>
      ${open
        ? html`<p class="muted small">Cases are handed out as people join, so every case gets a similar number of reviewers. With ${config.assignment.perParticipant} cases each, every case has at least ${config.assignment.minReviews} once ${needed === 1 ? 'the first person has' : `${needed} people have`} joined.</p>`
        : low.length
          ? html`<p class="notice">${plural(low.length, 'case')} will get fewer than ${config.assignment.minReviews} reviewers. Consider raising <code>casesPerParticipant</code> in <code>data/workshop.json</code>, or using fewer cases.</p>`
          : ''}
      <div class="table-wrap">
        <table class="simple-table">
          <thead><tr><th scope="col">Case</th><th scope="col" class="num">${open ? 'Assigned so far' : 'Assigned reviewers'}</th><th scope="col" class="num">Responses so far</th></tr></thead>
          <tbody>
            ${config.cases.map(
              (c) => html`<tr class="${!open && coverage.get(c.id) < config.assignment.minReviews ? 'bad' : ''}">
                <th scope="row">${c.number}. ${c.title}</th>
                <td class="num">${coverage.get(c.id)}</td>
                <td class="num">${responsesPerCase.get(c.id)}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <p class="muted small">
        ${plural(config.cases.length, 'case')} in use, ${config.assignment.perParticipant} per person.
        ${config.inactiveCases.length ? `${config.inactiveCases.length} more are switched off in data/cases.json (${config.inactiveCases.map((c) => c.title).join('; ')}).` : ''}
        Each person's cases are locked when they join.
      </p>
    </section>`;
}

// ---- actions ------------------------------------------------------------------------------------

// Apply changes on screen straight away, save them, and put things back if
// saving fails (so the projector never shows something that didn't happen).
async function updatePrinciples(patches, { quiet = false } = {}) {
  const changes = patches
    .map(([id, patch]) => {
      const current = F.principles.find((p) => p.id === id);
      return current ? { id, patch, before: { ...current } } : null;
    })
    .filter(Boolean);
  if (!changes.length) return true;
  for (const c of changes) Object.assign(F.principles.find((p) => p.id === c.id), c.patch);
  render({ force: true });
  const results = await Promise.allSettled(changes.map((c) => F.store.updatePrinciple(c.id, c.patch)));
  const failed = results.map((r, i) => (r.status === 'rejected' ? { ...changes[i], error: r.reason } : null)).filter(Boolean);
  for (const f of failed) {
    const current = F.principles.find((p) => p.id === f.id);
    if (current) for (const key of Object.keys(f.patch)) current[key] = f.before[key];
  }
  if (failed.length && !quiet) toast(`Couldn't save: ${failed[0].error?.message || 'unknown error'}`, 'error', 6000);
  if (failed.length) render({ force: true });
  await refresh(true);
  return failed.length === 0;
}

const updatePrinciple = (id, patch) => updatePrinciples([[id, patch]]);

// Give a section's principles positions 1..n in the given order (also moving
// `movedId` into this section). Renumbering, rather than squeezing a value in
// between two neighbours, can't get stuck when positions happen to tie.
function reorderSection(category, orderedIds, movedId = null) {
  const patches = [];
  orderedIds.forEach((id, i) => {
    const p = F.principles.find((x) => x.id === id);
    if (!p) return;
    const patch = {};
    if (Number(p.position) !== i + 1) patch.position = i + 1;
    if (id === movedId && categoryOf(p) !== category) patch.category = category;
    if (Object.keys(patch).length) patches.push([id, patch]);
  });
  return updatePrinciples(patches);
}

async function addPrinciple({ text, category, sourceCaseId, openVoting }) {
  const principle = {
    id: uuid(),
    text,
    category,
    position: maxPosition(category) + 1,
    status: openVoting ? 'voting' : 'proposed',
    version: 1,
    source_case_id: sourceCaseId || null,
    proposed_by: 'facilitator',
  };
  F.principles.push(principle);
  render({ force: true });
  try {
    const { queued } = await F.store.addPrinciple(principle);
    toast(queued ? 'Saved on this laptop; it will sync when the connection is back.' : 'Principle captured', queued ? 'warn' : 'ok');
  } catch (err) {
    toast(`Couldn't add the principle: ${err.message}`, 'error', 6000);
  }
  await refresh(true);
}

async function movePrinciple(id, dir) {
  const p = F.principles.find((x) => x.id === id);
  if (!p) return;
  const category = categoryOf(p);
  const ids = principlesIn(category).filter((x) => x.status !== 'parked').map((x) => x.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await reorderSection(category, ids);
}

async function setStatuses(targets, to, success) {
  if (!targets.length) return;
  const ok = await updatePrinciples(targets.map((p) => [p.id, { status: to }]), { quiet: true });
  if (!ok) toast("Some changes couldn't be saved, so those principles were left as they were. Try again.", 'error', 6000);
  else if (success) toast(success);
}

function ensureDialog() {
  let dialog = document.getElementById('principle-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'principle-dialog';
  dialog.className = 'dialog';
  document.body.appendChild(dialog);
  // Close on a click on the backdrop, but not when a text selection that
  // started inside the form happens to end outside it.
  let pressedBackdrop = false;
  dialog.addEventListener('mousedown', (event) => {
    pressedBackdrop = event.target === dialog;
  });
  dialog.addEventListener('click', (event) => {
    if ((event.target === dialog && pressedBackdrop) || event.target.closest('[data-close]')) dialog.close();
  });
  dialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const text = (data.get('text') || '').toString().trim();
    if (!text) return;
    dialog.close();
    await addPrinciple({
      text,
      category: (data.get('category') || 'unsorted').toString(),
      sourceCaseId: (data.get('source_case_id') || '').toString(),
      openVoting: data.get('open') === 'on',
    });
  });
  return dialog;
}

function openPrincipleDialog({ caseId = '', text = '', category = 'unsorted' } = {}) {
  const dialog = ensureDialog();
  const source = caseId ? casesById.get(caseId) : null;
  const voting = route().name === 'vote';
  dialog.innerHTML = html`<form class="dialog-form">
    <h2>${voting ? 'Add a principle' : 'Capture a principle'}</h2>
    ${source ? html`<p class="muted small">Prompted by case ${source.number}: ${source.title}</p>` : ''}
    <label class="q-title" for="d-text">Principle</label>
    <textarea id="d-text" name="text" rows="4" required placeholder="e.g. New mechanisms must be sufficiently general to justify long-term inclusion in the core model.">${text}</textarea>
    <div class="field-row">
      <label>Section <span class="optional">you can sort it later</span>
        <select name="category">
          <option value="unsorted">Decide later</option>
          ${F.config.categories.map((c) => html`<option value="${c.id}" ${c.id === category ? 'selected' : ''}>${c.label}</option>`)}
        </select>
      </label>
      <label>Prompted by case <span class="optional">optional</span>
        <select name="source_case_id">
          <option value="">—</option>
          ${F.config.cases.map((c) => html`<option value="${c.id}" ${c.id === caseId ? 'selected' : ''}>${c.number}. ${c.title}</option>`)}
        </select>
      </label>
    </div>
    ${voting ? html`<label class="check"><input type="checkbox" name="open" checked> Open it for voting straight away</label>` : ''}
    <div class="btn-row end">
      <button type="button" class="btn btn-quiet" data-close>Cancel</button>
      <button type="submit" class="btn btn-primary">${voting ? 'Add principle' : 'Capture'}</button>
    </div>
  </form>`;
  dialog.showModal();
  dialog.querySelector('textarea').focus();
}

// Demo mode only: replace this browser's data with a generated example workshop.
async function loadDemoData() {
  if (F.store.kind !== 'local') return;
  const demo = generateDemo(F.config, F.plan);
  await F.store.clearAll();
  for (const table of ['participants', 'responses', 'principles', 'votes']) await F.store.importRows(table, demo[table]);
}

function applyScale() {
  document.documentElement.style.setProperty('--scale', F.ui.scale);
}

function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

const clickHandlers = {
  scale(el) {
    const i = SCALES.indexOf(F.ui.scale);
    const next = SCALES[Math.max(0, Math.min(SCALES.length - 1, (i === -1 ? 1 : i) + Number(el.dataset.dir)))];
    F.ui.scale = next;
    storage.set('cw:facilitator:scale', next);
    applyScale();
  },
  theme() {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = dark ? 'light' : 'dark';
    storage.set('cw:facilitator:theme', theme);
    applyTheme(theme);
  },
  'toggle-tips'() {
    F.ui.hideTips = !F.ui.hideTips;
    storage.set('cw:facilitator:hide-tips', F.ui.hideTips);
    render({ force: true });
  },
  timer(el) {
    const { step, op } = el.dataset;
    const t = timerState(step);
    if (op === 'start') saveTimer(step, { remaining: t.remaining, endsAt: Date.now() + Math.max(0, t.remaining) });
    else if (op === 'pause') saveTimer(step, { remaining: Math.max(0, timeLeft(t)), endsAt: null });
    else saveTimer(step, { remaining: minutesFor(step) * 60000, endsAt: null });
    render({ force: true });
  },
  'new-principle'(el) {
    openPrincipleDialog({ caseId: el.dataset.case || '' });
  },
  'toggle-seed'(el) {
    const id = el.dataset.case;
    if (F.ui.revealedSeeds.has(id)) F.ui.revealedSeeds.delete(id);
    else F.ui.revealedSeeds.add(id);
    render({ force: true });
  },
  'capture-seed'(el) {
    const c = casesById.get(el.dataset.case);
    if (c) openPrincipleDialog({ caseId: c.id, text: c.suggestedPrinciple, category: c.suggestedSection });
  },
  'toggle-section-seed'(el) {
    const id = el.dataset.section;
    if (F.ui.sectionSeeds.has(id)) F.ui.sectionSeeds.delete(id);
    else F.ui.sectionSeeds.add(id);
    render({ force: true });
  },
  'capture-section-seed'(el) {
    const id = el.dataset.section;
    const s = sectionSuggestions(id)[0];
    if (s) openPrincipleDialog({ caseId: s.caseId, text: s.text, category: id });
  },
  'set-status'(el) {
    if (el.dataset.status === 'ratified') sparkleBurst(el, { count: 18, spread: 95 });
    updatePrinciple(el.dataset.id, { status: el.dataset.status });
  },
  'open-all'() {
    const ready = F.principles.filter((p) => p.status === 'proposed');
    setStatuses(ready, 'voting', `Voting is open on ${plural(ready.length, 'principle')}. Ask everyone to go to their Principles tab.`);
  },
  'close-all'() {
    setStatuses(F.principles.filter((p) => p.status === 'voting'), 'proposed', 'Voting closed');
  },
  'adopt-passing'(el) {
    const passing = F.principles.filter((p) => p.status === 'voting' && tallyVotes(p, F.votes, F.config).meetsThreshold);
    sparkleBurst(el, { count: 28, spread: 140 });
    setStatuses(passing, 'ratified', `Adopted ${plural(passing.length, 'principle')}`);
  },
  edit(el) {
    const p = F.principles.find((x) => x.id === el.dataset.id);
    if (!p) return;
    F.ui.editing = p.id;
    F.ui.editDraft = { text: p.text, category: categoryOf(p) };
    render({ force: true });
    const area = root.querySelector(`#edit-${CSS.escape(p.id)}`);
    area?.focus();
    area?.setSelectionRange(area.value.length, area.value.length);
  },
  'cancel-edit'() {
    F.ui.editing = null;
    F.ui.editDraft = null;
    render({ force: true });
  },
  move(el) {
    movePrinciple(el.dataset.id, Number(el.dataset.dir));
  },
  download(el) {
    const [name, text, type] = EXPORTS[el.dataset.what]();
    download(name, text, type);
  },
  async 'copy-markdown'() {
    const [, text] = EXPORTS.constitution();
    toast((await copyText(text)) ? 'Copied' : 'Copy failed: select the preview text instead', 'ok');
  },
  async 'copy-text'(el) {
    toast((await copyText(el.dataset.text)) ? 'Copied' : 'Copy failed', 'ok');
  },
  async check(el) {
    el.disabled = true;
    el.textContent = 'Testing…';
    try {
      F.ui.check = await F.store.check();
    } catch (err) {
      F.ui.check = [{ table: 'connection', ok: false, message: err.message }];
    }
    render({ force: true });
  },
  async 'demo-data'() {
    if (F.store.kind !== 'local') return;
    if ((F.responses.length || F.principles.length) && !confirm('Replace the demo data in this browser with a fresh set?')) return;
    await loadDemoData();
    await refresh(true);
    toast('Demo data loaded. Try the steps from the top.');
  },
  async 'clear-local'() {
    if (F.store.kind !== 'local' || !confirm('Delete all demo data stored in this browser for this workshop?')) return;
    await F.store.clearAll();
    storage.remove(timerKey());
    F.ui.check = null;
    await refresh(true);
    toast('Demo data cleared');
  },
  async 'remove-guest'(el) {
    const { code, name } = el.dataset;
    const answers = F.responses.filter((r) => r.participant_code === code).length;
    const note = answers ? `\n\nTheir ${plural(answers, 'answer')} will stay in the results.` : '';
    if (!confirm(`Remove “${name}” from the participant list?${note}`)) return;
    try {
      await F.store.removeParticipant(code);
      toast(`Removed ${name}`);
    } catch (err) {
      toast(`Couldn't remove: ${err.message}`, 'error', 6000);
    }
    await refresh(true);
  },
  'download-roster'() {
    const current = assignments();
    const people = [...F.config.roster, ...F.joined.filter((j) => !F.config.roster.some((r) => r.code === j.code))];
    const file = {
      _readme: 'Roster with fixed case assignments, exported from the facilitator Setup page.',
      participants: people.map((p) => ({ name: p.name, code: p.code, cases: current.get(p.code) || [] })),
    };
    download('participants.json', `${JSON.stringify(file, null, 2)}\n`, 'application/json');
  },
};

const submitHandlers = {
  unlock(form, event) {
    event.preventDefault();
    const key = new FormData(form).get('key')?.toString() || '';
    if (key === F.config.facilitatorKey) {
      storage.set(`cw:${F.config.id}:facilitator-key`, key);
      F.unlocked = true;
      F.keyError = '';
      boot();
    } else {
      F.keyError = "That key doesn't match.";
      render({ force: true });
    }
  },
  async 'save-edit'(form, event) {
    event.preventDefault();
    const p = F.principles.find((x) => x.id === form.dataset.id);
    if (!p) return;
    const data = new FormData(form);
    const text = (data.get('text') || '').toString().trim();
    const category = (data.get('category') || categoryOf(p)).toString();
    if (!text) return;
    const patch = {};
    if (text !== p.text) {
      patch.text = text;
      if (tallyVotes(p, F.votes, F.config).n) patch.version = Number(p.version) + 1;
    }
    if (category !== categoryOf(p)) {
      patch.category = category;
      patch.position = maxPosition(category) + 1;
    }
    F.ui.editing = null;
    F.ui.editDraft = null;
    if (Object.keys(patch).length) await updatePrinciple(p.id, patch);
    else render({ force: true });
    if (patch.version) toast(p.status === 'voting' ? 'Reworded. Everyone is asked to vote again on the new wording.' : 'Reworded. The new wording gets a fresh vote.');
  },
};

const changeHandlers = {
  'move-category'(el) {
    if (el.value === 'unsorted') return;
    updatePrinciple(el.dataset.id, { category: el.value, position: maxPosition(el.value) + 1 });
  },
  'export-opt'(el) {
    F.ui.exportOpts[el.name] = el.checked;
    render({ force: true });
  },
  'edit-draft'(form) {
    const data = new FormData(form);
    F.ui.editDraft = { text: (data.get('text') || '').toString(), category: (data.get('category') || '').toString() };
  },
};

const inputHandlers = {
  'edit-draft': changeHandlers['edit-draft'],
};

delegate(root, 'click', clickHandlers);
delegate(root, 'submit', submitHandlers);
delegate(root, 'change', changeHandlers);
delegate(root, 'input', inputHandlers);

// ---- drag and drop (tidy step) --------------------------------------------------------------------

function cardsIn(list, excludeId) {
  return [...list.querySelectorAll(':scope > .principle')].filter((el) => el.dataset.id !== excludeId);
}

function insertionIndex(list, y, excludeId) {
  const cards = cardsIn(list, excludeId);
  for (let i = 0; i < cards.length; i++) {
    const rect = cards[i].getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return i;
  }
  return cards.length;
}

function endDrag() {
  if (!F.drag) return;
  root.querySelector('.drop-marker')?.remove();
  root.querySelectorAll('.dragging, .drop-target').forEach((el) => el.classList.remove('dragging', 'drop-target'));
  F.drag = null;
  renderer.release();
}

root.addEventListener('dragstart', (event) => {
  const card = event.target.closest?.('.principle[draggable="true"]');
  if (!card) return;
  F.drag = { id: card.dataset.id };
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.dataset.id);
  requestAnimationFrame(() => card.classList.add('dragging'));
  renderer.hold();
});

root.addEventListener('dragover', (event) => {
  if (!F.drag) return;
  const list = event.target.closest?.('.principle-list');
  if (!list) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  root.querySelectorAll('.drop-target').forEach((el) => el !== list && el.classList.remove('drop-target'));
  list.classList.add('drop-target');
  let marker = root.querySelector('.drop-marker');
  if (!marker) {
    marker = document.createElement('li');
    marker.className = 'drop-marker';
    marker.setAttribute('aria-hidden', 'true');
  }
  const cards = cardsIn(list, F.drag.id);
  const i = insertionIndex(list, event.clientY, F.drag.id);
  const before = cards[i] || null;
  if (marker.parentElement !== list || marker.nextElementSibling !== before) list.insertBefore(marker, before);
});

root.addEventListener('drop', (event) => {
  if (!F.drag) return;
  const list = event.target.closest?.('.principle-list');
  if (!list) return;
  event.preventDefault();
  const id = F.drag.id;
  const category = list.dataset.drop;
  const visible = cardsIn(list, id);
  const i = insertionIndex(list, event.clientY, id);
  endDrag();
  const p = F.principles.find((x) => x.id === id);
  if (!p) return;
  // The new order of the whole section, including dropped principles that aren't shown.
  const order = principlesIn(category).map((x) => x.id).filter((x) => x !== id);
  let at = order.length;
  if (visible.length && i < visible.length) at = order.indexOf(visible[i].dataset.id);
  else if (visible.length) at = order.indexOf(visible[visible.length - 1].dataset.id) + 1;
  if (at < 0) at = order.length;
  order.splice(at, 0, id);
  const unchanged = categoryOf(p) === category && principlesIn(category).map((x) => x.id).join() === order.join();
  if (!unchanged) reorderSection(category, order, id);
});

root.addEventListener('dragend', endDrag);

// ---- keyboard: ← → between cases while discussing -------------------------------------------------------

document.addEventListener('keydown', (event) => {
  if (!F.loaded || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest?.('input, textarea, select, dialog')) return;
  const r = route();
  if (r.name !== 'discuss' || r.arg === 'all' || !F.responses.length) return;
  const ordered = orderedStats();
  const idx = Math.max(0, ordered.findIndex((s) => s.case.id === r.arg));
  const go = (i) => (location.hash = `#/discuss/${encodeURIComponent(ordered[i].case.id)}`);
  if (event.key === 'ArrowRight' && idx < ordered.length - 1) go(idx + 1);
  else if (event.key === 'ArrowLeft' && idx > 0) go(idx - 1);
});

// ---- live data ----------------------------------------------------------------------------------------

let refreshing = null;
async function refresh(force = false) {
  if (refreshing) {
    await refreshing;
    if (!force) return;
  }
  refreshing = (async () => {
    try {
      const [joined, responses, principles, votes] = await Promise.all([
        F.store.listParticipants(),
        F.store.listResponses(),
        F.store.listPrinciples(),
        F.store.listVotes(),
      ]);
      F.online = true;
      const signature = JSON.stringify([joined, responses, principles, votes]);
      if (force || signature !== F.signature || !F.loaded) {
        F.signature = signature;
        Object.assign(F, { joined, responses, principles, votes, loaded: true });
        render();
      } else {
        renderer.flush();
      }
    } catch (err) {
      console.warn(err);
      F.online = false;
      if (!F.loaded) {
        F.loaded = true;
        render({ force: true });
        toast(`Couldn't load workshop data: ${err.message}`, 'error', 8000);
      }
    } finally {
      refreshing = null;
      const slot = root.querySelector('#sync-slot');
      if (slot) slot.innerHTML = syncBadge(F.store, F.online);
    }
  })();
  return refreshing;
}

let polling = false;
let lastRefresh = 0;
function boot() {
  root.classList.add('flow'); // full-height page, so the Next button sits at the bottom
  // Come back to the step you were on (e.g. after closing the tab by accident).
  if (!location.hash) {
    const last = storage.get(stepKey());
    if (STEPS.some((s) => s.id === last)) history.replaceState(null, '', `#/${last}`);
  }
  render({ force: true });
  refresh(true);
  if (polling) return;
  polling = true;
  // Every 2.5 s while the page is visible; every 15 s if the browser says it's
  // hidden (some projector setups report that), so the view never goes stale.
  setInterval(() => {
    if (F.drag) return;
    if (document.hidden && Date.now() - lastRefresh < 15000) return;
    lastRefresh = Date.now();
    refresh();
  }, 2500);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  let pending = null;
  F.store.onChange(() => {
    clearTimeout(pending);
    pending = setTimeout(() => refresh(), 150);
  });
}

async function start() {
  try {
    F.config = await loadConfig();
  } catch (err) {
    console.error(err);
    errorScreen(root, 'The workshop data could not be loaded', err.message);
    return;
  }
  document.title = `Facilitator · ${F.config.title}`;
  casesById = byId(F.config.cases);
  categoryIds = new Set(F.config.categories.map((c) => c.id));
  F.store = createStore(F.config);
  F.plan = planAssignments(F.config.roster, F.config.cases.map((c) => c.id), F.config.assignment);
  applyScale();
  applyTheme(params.get('theme') || storage.get('cw:facilitator:theme', null));
  installTooltips();

  // facilitator.html?demo=1 previews the steps with example data (demo mode only).
  if (params.get('demo') && F.store.kind === 'local' && !(await F.store.listResponses()).length) await loadDemoData();

  const key = F.config.facilitatorKey;
  const saved = storage.get(`cw:${F.config.id}:facilitator-key`);
  F.unlocked = !key || params.get('key') === key || saved === key;
  if (F.unlocked && params.get('key') === key && key) storage.set(`cw:${F.config.id}:facilitator-key`, key);
  if (F.unlocked) boot();
  else render({ force: true });
}

start();

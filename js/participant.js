// Participant app: join, review assigned cases, propose and vote on principles.

import { assignGuest, coverageCounts, currentAssignments, planAssignments } from './assign.js';
import { byId, categoryList, loadConfig } from './data.js';
import { html } from './html.js';
import { createStore } from './store.js';
import {
  createRenderer,
  decisionChip,
  decisionVars,
  delegate,
  errorScreen,
  installTooltips,
  logo,
  sparkleBurst,
  sparkles,
  syncBadge,
  toast,
  voteVars,
} from './ui.js';
import { copyText, plural, randomSuffix, sameName, slugify, storage, uuid } from './util.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);

const S = {
  config: null,
  store: null,
  plan: new Map(),
  joined: [],
  me: null,
  responses: new Map(), // caseId -> my response
  principles: [],
  myVotes: new Map(), // `${principleId}:${version}` -> my vote
  voteDrafts: new Map(), // principleId -> unsaved comment
  proposeDraft: {}, // unsent "propose a principle" form
  notified: new Set(), // voting items we've already told this person about
  join: { query: '', error: '', guestName: '', sameNameGuest: null },
  online: true,
  signature: '',
};

let casesById = new Map();
let decisionsById = new Map();
let categoriesById = new Map();

const keys = {
  me: () => `cw:${S.config.id}:me`,
  draft: (caseId) => `cw:${S.config.id}:draft:${S.me.code}:${caseId}`,
};

const renderer = createRenderer(root, view);
const render = (opts) => renderer.render(opts);

// ---- routing -----------------------------------------------------------------------

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'case' && parts[1]) return { name: 'case', id: decodeURIComponent(parts[1]) };
  if (parts[0] === 'principles') return { name: 'principles' };
  return { name: 'home' };
}

window.addEventListener('hashchange', () => {
  render({ force: true });
  window.scrollTo(0, 0);
});

// ---- helpers ---------------------------------------------------------------------------

const caseIds = () => S.config.cases.map((c) => c.id);
const myCases = () => (S.me?.cases || []).map((id) => casesById.get(id)).filter(Boolean);
const doneCount = () => myCases().filter((c) => S.responses.has(c.id)).length;
const votingPrinciples = () => sortByCategory(S.principles.filter((p) => p.status === 'voting'));
const needsMyVote = () => votingPrinciples().filter((p) => !S.myVotes.has(`${p.id}:${p.version}`)).length;

function sortByCategory(list) {
  const order = new Map(categoryList(S.config).map((c, i) => [c.id, i]));
  return list.slice().sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.position - b.position);
}

function everyone() {
  const rosterCodes = new Set(S.config.roster.map((p) => p.code));
  return [...S.config.roster, ...S.joined.filter((j) => !rosterCodes.has(j.code))];
}

// With nobody listed in participants.json, everyone simply types their name to join.
const openJoin = () => !S.config.roster.length;

// Codes match exactly; names match roster people directly, but a name that
// matches a guest needs confirming (two different people can share a name).
function findPerson(query) {
  const q = query.trim();
  if (!q) return { person: null };
  const code = slugify(q);
  const all = everyone();
  const byCode = all.find((p) => p.code === code);
  if (byCode && (isRoster(byCode) || code === q.toLowerCase())) return { person: byCode };
  const rosterMatch = S.config.roster.find((p) => sameName(p.name, q));
  if (rosterMatch) return { person: rosterMatch };
  const guestMatch = all.find((p) => !isRoster(p) && sameName(p.name, q));
  return guestMatch ? { person: guestMatch, confirm: true } : { person: null };
}

const isRoster = (person) => S.config.roster.some((r) => r.code === person.code);

// A draft counts only if it differs from the saved answer.
function sameAnswer(a, b) {
  const norm = (x) => JSON.stringify([
    x?.decision || '',
    (x?.rationale || '').trim(),
    [...(x?.tags || [])].sort(),
    (x?.tags || []).includes('other') ? (x?.other_tag || '').trim() : '',
    x?.confidence ? Number(x.confidence) : null,
  ]);
  return norm(a) === norm(b);
}

function unsavedDraft(caseId) {
  const draft = storage.get(keys.draft(caseId));
  if (!draft) return null;
  const saved = S.responses.get(caseId);
  return saved && sameAnswer(draft, saved) ? null : draft;
}

function personalLink(code) {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  if (params.get('ws')) url.searchParams.set('ws', params.get('ws'));
  if (params.get('backend')) url.searchParams.set('backend', params.get('backend'));
  url.searchParams.set('p', code);
  return url.toString();
}

function nextOpenCase(afterId) {
  const list = S.me.cases.filter((id) => casesById.has(id));
  const start = list.indexOf(afterId);
  if (start === -1) return list.find((id) => !S.responses.has(id)) || null;
  for (let i = 1; i < list.length; i++) {
    const id = list[(start + i) % list.length];
    if (!S.responses.has(id)) return id;
  }
  return null;
}

function maxPosition(category) {
  return S.principles.filter((p) => p.category === category).reduce((m, p) => Math.max(m, Number(p.position) || 0), 0);
}

// ---- views --------------------------------------------------------------------------------

function view() {
  if (!S.me) return joinView();
  const r = route();
  let body;
  if (r.name === 'case') body = reviewView(r.id);
  else if (r.name === 'principles') body = principlesView();
  else body = homeView();
  return html`${header(r)}<main class="page" id="main">${body}</main>`;
}

function header(r) {
  const total = myCases().length;
  const pending = needsMyVote();
  return html`<header class="topbar">
    ${sparkles(9, { seed: 3, white: true, size: [5, 10] })}
    <div class="topbar-inner">
      <a class="brand" href="#/">${logo()}<span class="brand-text"><span class="brand-name">malariasimulation</span><span class="brand-sub">constitution workshop</span></span></a>
      <nav class="tabs" aria-label="Sections">
        <a href="#/" class="tab ${r.name !== 'principles' ? 'active' : ''}" aria-current="${r.name !== 'principles' ? 'page' : 'false'}">My cases <span class="tab-count">${doneCount()}/${total}</span></a>
        <a href="#/principles" class="tab ${r.name === 'principles' ? 'active' : ''}" aria-current="${r.name === 'principles' ? 'page' : 'false'}">Principles <span class="tab-badge" id="vote-badge" ${pending ? '' : 'hidden'}>${pending}</span></a>
      </nav>
      <div class="topbar-right">
        <span id="sync-slot">${syncBadge(S.store, S.online)}</span>
        <span class="who">${S.me.name}</span>
        <button class="btn-link" data-action="switch">Not you?</button>
      </div>
    </div>
  </header>`;
}

function joinView() {
  const { config } = S;
  const open = openJoin();
  const names = open ? [] : everyone();
  return html`<main class="join">
    <section class="join-card card">
      ${sparkles(10, { seed: 5 })}
      <div class="join-logo">${logo(64)}</div>
      <p class="eyebrow">${config.title}</p>
      <h1>${config.subtitle || 'Welcome'}</h1>
      <p class="lede">${config.intro}</p>
      <form class="join-form" data-submit="join" autocomplete="off">
        <label for="who">${open ? 'Your name' : 'Your name or participant code'}</label>
        <div class="input-row">
          <input id="who" name="who" value="${S.join.query}" placeholder="e.g. ${names[0]?.name || 'Ross'}" maxlength="60" required>
          <button class="btn btn-primary" type="submit">${open ? 'Join' : 'Continue'}</button>
        </div>
        ${S.join.error ? html`<p class="form-error" role="alert">${S.join.error}</p>` : ''}
        ${S.join.sameNameGuest
          ? html`<div class="guest-offer" role="alert">
              <p>Someone called “${S.join.sameNameGuest.name}” has already joined. Is that you?</p>
              <div class="btn-row">
                <button class="btn btn-primary" type="button" data-action="pick" data-code="${S.join.sameNameGuest.code}">Yes, that's me</button>
                ${S.join.guestName ? html`<button class="btn btn-secondary" type="button" data-action="join-guest">No, I'm someone else</button>` : ''}
              </div>
            </div>`
          : S.join.guestName
            ? html`<div class="guest-offer">
                <p>Not on the list? You can join as a guest and we'll give you some cases.</p>
                <button class="btn btn-secondary" type="button" data-action="join-guest">Join as “${S.join.guestName}”</button>
              </div>`
            : ''}
      </form>
      ${config.join.showNameList && names.length
        ? html`<div class="name-list">
            <p class="muted small">Or choose your name</p>
            <div class="names">${names.map((p) => html`<button class="name-btn" type="button" data-action="pick" data-code="${p.code}">${p.name}</button>`)}</div>
          </div>`
        : ''}
    </section>
    <p class="join-foot muted small">${S.store.kind === 'local' ? 'Demo mode: answers are stored in this browser only.' : ''}</p>
  </main>`;
}

function homeView() {
  const cases = myCases();
  const done = doneCount();
  const allDone = cases.length > 0 && done === cases.length;
  const pct = cases.length ? Math.round((100 * done) / cases.length) : 0;
  return html`
    <section class="hero">
      <p class="eyebrow">${S.config.title}</p>
      <h1>Hi <span class="shimmer">${S.me.name}</span></h1>
      <p class="lede">${S.config.intro}</p>
      <div class="progress-card card">
        <div class="stat"><span class="stat-value">${cases.length}</span><span class="stat-label">cases assigned</span></div>
        <div class="stat"><span class="stat-value">${done}</span><span class="stat-label">completed</span></div>
        <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="${cases.length}" aria-valuenow="${done}" aria-label="Cases completed">
          <span class="progress-fill" style="width:${pct}%"></span>
        </div>
      </div>
    </section>

    ${needsMyVote()
      ? html`<a class="card vote-banner" href="#/principles">
          <span><b>Voting is open.</b> ${plural(needsMyVote(), 'principle')} ${needsMyVote() === 1 ? 'is' : 'are'} waiting for your vote.</span>
          <span class="btn btn-primary">Vote now →</span>
        </a>`
      : ''}

    ${allDone
      ? html`<section class="card done-card">
          ${sparkles(12, { seed: 9 })}
          <h2>All done. Thank you!</h2>
          <p>The group discussion will focus on the cases where people disagreed most. While you wait, you can review extra cases below, or propose a principle in the <a href="#/principles">Principles</a> tab.</p>
        </section>`
      : ''}

    <section class="block">
      <div class="block-head">
        <h2>Your cases</h2>
        <p class="muted">For each one: decide where it belongs, then say why.</p>
      </div>
      <div class="case-grid">${cases.map((c) => caseTile(c))}</div>
    </section>

    ${allDone ? extraCasesBlock() : ''}

    <section class="block">
      <h2 class="h-small">The options</h2>
      <ul class="option-legend">
        ${S.config.decisions.map((d) => html`<li style="${decisionVars(d)}"><span class="swatch"></span><b>${d.label}</b> <span>${d.description}</span></li>`)}
      </ul>
    </section>

    <footer class="page-foot">
      <span class="muted small">Your personal link, to come back later or switch device:</span>
      <code class="link-code">${personalLink(S.me.code)}</code>
      <button class="btn btn-quiet btn-small" data-action="copy-link">Copy</button>
    </footer>`;
}

function caseStatus(c) {
  const saved = S.responses.get(c.id);
  const draft = unsavedDraft(c.id);
  if (saved) return { kind: 'done', label: 'Done', decision: decisionsById.get(saved.decision), unsaved: Boolean(draft) };
  if (draft) return { kind: 'draft', label: 'Draft' };
  return { kind: 'todo', label: 'Not started' };
}

function caseTile(c) {
  const status = caseStatus(c);
  const action = status.kind === 'done' ? 'Edit answer' : status.kind === 'draft' ? 'Continue' : 'Start';
  return html`<a class="case-tile card status-${status.kind}" href="#/case/${encodeURIComponent(c.id)}">
    <div class="case-tile-top">
      <span class="case-num">Case ${c.number}</span>
      ${status.kind === 'done'
        ? status.unsaved
          ? html`<span class="status-chip unsaved">Edited, not saved</span>`
          : html`<span class="done-mark">✓ Done</span>`
        : html`<span class="status-chip">${status.label}</span>`}
    </div>
    <h3>${c.title}</h3>
    <p class="clamp-3">${c.summary}</p>
    <div class="case-tile-foot">
      ${status.decision ? decisionChip(status.decision) : html`<span></span>`}
      <span class="tile-action">${action} →</span>
    </div>
  </a>`;
}

function extraCasesBlock() {
  const coverage = coverageCounts(currentAssignments(S.plan, S.joined), caseIds());
  const extras = S.config.cases
    .filter((c) => !S.me.cases.includes(c.id))
    .sort((a, b) => Number(S.responses.has(a.id)) - Number(S.responses.has(b.id)) || coverage.get(a.id) - coverage.get(b.id) || a.number - b.number);
  if (!extras.length) return '';
  return html`<section class="block">
    <div class="block-head">
      <h2>Extra cases <span class="muted">(optional)</span></h2>
      <p class="muted">These need the most reviewers, so they're listed first.</p>
    </div>
    <ul class="extra-list">
      ${extras.map((c) => {
        const saved = S.responses.get(c.id);
        return html`<li><a class="extra-row card" href="#/case/${encodeURIComponent(c.id)}">
          <span class="case-num">Case ${c.number}</span>
          <span class="extra-title">${c.title}</span>
          ${saved ? decisionChip(decisionsById.get(saved.decision)) : html`<span class="tile-action">Review →</span>`}
        </a></li>`;
      })}
    </ul>
  </section>`;
}

function reviewView(caseId) {
  const c = casesById.get(caseId);
  if (!c) return html`<div class="card empty"><p>That case doesn't exist.</p><a class="btn btn-secondary" href="#/">Back to your cases</a></div>`;
  const { config } = S;
  const assignedIndex = S.me.cases.indexOf(caseId);
  const saved = S.responses.get(caseId);
  const draft = unsavedDraft(caseId);
  const values = draft || saved || {};
  const tags = values.tags || [];
  const next = nextOpenCase(caseId);
  const submitLabel = next && next !== caseId && assignedIndex !== -1 ? 'Save and next case →' : saved ? 'Save changes' : 'Save';
  const max = config.review.maxTags;

  return html`
    <nav class="crumbs">
      <a href="#/">← Your cases</a>
      <span class="muted">${assignedIndex === -1 ? 'Extra case' : `Case ${assignedIndex + 1} of ${S.me.cases.length}`}</span>
    </nav>
    <div class="review-layout">
      <article class="card case-card">
        <p class="eyebrow">Case ${c.number} · proposed change</p>
        <h1 class="case-title">${c.title}</h1>
        <p class="case-summary">${c.summary}</p>
        ${c.upsides.length || c.downsides.length
          ? html`<div class="tradeoffs">
              ${c.upsides.length ? html`<div class="tradeoff up"><h3>Upsides</h3><ul>${c.upsides.map((u) => html`<li>${u}</li>`)}</ul></div>` : ''}
              ${c.downsides.length ? html`<div class="tradeoff down"><h3>Downsides</h3><ul>${c.downsides.map((d) => html`<li>${d}</li>`)}</ul></div>` : ''}
            </div>`
          : ''}
        ${c.link ? html`<p><a href="${c.link}" target="_blank" rel="noopener">More detail ↗</a></p>` : ''}
      </article>

      <form class="card review-form" data-submit="save-response" data-input="draft" data-change="draft" data-case="${c.id}" novalidate>
        <fieldset class="q" id="q-decision">
          <legend><span class="q-num">1</span>Where should this belong?</legend>
          <div class="options">
            ${config.decisions.map(
              (d) => html`<label class="option" style="${decisionVars(d)}">
                <input type="radio" name="decision" value="${d.id}" ${values.decision === d.id ? 'checked' : ''}>
                <span class="option-body">
                  <span class="option-label"><span class="swatch"></span>${d.label}</span>
                  <span class="option-desc">${d.description}</span>
                </span>
              </label>`,
            )}
          </div>
        </fieldset>

        <div class="q" id="q-rationale">
          <label class="q-title" for="rationale"><span class="q-num">2</span>Why?</label>
          <p class="hint" id="rationale-hint">What was the deciding consideration for you? A sentence or two is plenty.</p>
          <textarea id="rationale" name="rationale" rows="4" aria-describedby="rationale-hint">${values.rationale || ''}</textarea>
        </div>

        <fieldset class="q" id="q-tags">
          <legend><span class="q-num">3</span>What factors most influenced your decision?</legend>
          ${max ? html`<p class="hint">Pick up to ${max}.</p>` : ''}
          <div class="chips">
            ${config.tags.map(
              (t) => html`<label class="tag-chip">
                <input type="checkbox" name="tags" value="${t.id}" ${tags.includes(t.id) ? 'checked' : ''}
                  ${max && tags.length >= max && !tags.includes(t.id) ? 'disabled' : ''}>
                <span>${t.label}</span>
              </label>`,
            )}
          </div>
          <div class="other-field" ${tags.includes('other') ? '' : 'hidden'}>
            <label for="other_tag" class="small">Other factor</label>
            <input id="other_tag" name="other_tag" value="${values.other_tag || ''}" maxlength="120">
          </div>
        </fieldset>

        ${config.review.askConfidence
          ? html`<fieldset class="q" id="q-confidence">
              <legend><span class="q-num">4</span>How confident are you? <span class="optional">optional</span></legend>
              <div class="scale">
                ${[1, 2, 3, 4, 5].map(
                  (v) => html`<label class="scale-step">
                    <input type="radio" name="confidence" value="${v}" ${Number(values.confidence) === v ? 'checked' : ''}>
                    <span class="scale-num">${v}</span>
                    <span class="scale-label">${config.confidenceLabels[v - 1]}</span>
                  </label>`,
                )}
              </div>
            </fieldset>`
          : ''}

        <div class="form-actions">
          <p class="form-status" id="form-status" aria-live="polite">${saved
            ? draft
              ? 'You have unsaved changes. Save to update your answer.'
              : 'Saved. You can come back and change it.'
            : ''}</p>
          <button class="btn btn-primary btn-large" type="submit">${submitLabel}</button>
        </div>
      </form>
    </div>`;
}

function principlesView() {
  const voting = votingPrinciples();
  const ratified = sortByCategory(S.principles.filter((p) => p.status === 'ratified'));
  const discussing = sortByCategory(S.principles.filter((p) => p.status === 'proposed'));
  const mine = S.principles.filter((p) => p.proposed_by === S.me.code);

  return html`
    <section class="hero hero-compact">
      <p class="eyebrow">Building the constitution</p>
      <h1>Principles</h1>
      <p class="lede">A principle is a short rule we could apply to future decisions. Propose them during the discussion. When the facilitator opens voting, vote on each one here.</p>
    </section>

    <section class="block">
      <div class="block-head">
        <h2>Vote ${voting.length ? html`<span class="muted">(${voting.length} open)</span>` : ''}</h2>
        ${voting.length
          ? html`<p class="muted small">${S.config.votes.map((o) => (o.hint ? `${o.label}: ${o.hint.toLowerCase()}` : o.label)).join(' · ')}. You can change your vote while voting is open.</p>`
          : ''}
      </div>
      ${voting.length
        ? html`<div class="vote-list">${voting.map((p) => voteCard(p))}</div>`
        : html`<div class="card empty"><p>Nothing to vote on yet. The facilitator will open voting after the discussion.</p></div>`}
    </section>

    <section class="block grid-2">
      <div>
        <h2>Propose a principle</h2>
        <form class="card propose-form" data-submit="propose" data-input="propose-draft" data-change="propose-draft">
          <label for="p-text" class="q-title">Principle</label>
          <textarea id="p-text" name="text" rows="3" required
            placeholder="e.g. New mechanisms must be general enough to justify long-term inclusion in the core model.">${S.proposeDraft.text || ''}</textarea>
          <div class="field-row">
            <label>Category
              <select name="category">
                <option value="unsorted">Not sure (facilitator decides)</option>
                ${S.config.categories.map((c) => html`<option value="${c.id}" ${S.proposeDraft.category === c.id ? 'selected' : ''}>${c.label}</option>`)}
              </select>
            </label>
            <label>Prompted by a case? <span class="optional">optional</span>
              <select name="source_case_id">
                <option value="">—</option>
                ${S.config.cases.map((c) => html`<option value="${c.id}" ${S.proposeDraft.source_case_id === c.id ? 'selected' : ''}>${c.number}. ${c.title}</option>`)}
              </select>
            </label>
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit">Add proposal</button></div>
        </form>
        ${mine.length
          ? html`<h3 class="h-small">Your proposals</h3>
              <ul class="plain-list">${mine.map((p) => html`<li><span class="status-dot status-${p.status}"></span>${p.text} <span class="muted small">(${statusLabel(p.status)})</span></li>`)}</ul>`
          : ''}
      </div>
      <div>
        <h2>Agreed so far</h2>
        ${ratified.length
          ? groupedList(ratified)
          : html`<div class="card empty"><p>No principles have been adopted yet.</p></div>`}
        ${discussing.length
          ? html`<h3 class="h-small">Under discussion</h3>${groupedList(discussing, true)}`
          : ''}
      </div>
    </section>`;
}

function statusLabel(status) {
  return { proposed: 'under discussion', voting: 'voting open', ratified: 'adopted', parked: 'dropped' }[status] || status;
}

function groupedList(list, muted = false) {
  const categoryOf = (p) => (categoriesById.has(p.category) ? p.category : 'unsorted');
  const groups = categoryList(S.config)
    .map((c) => ({ c, items: list.filter((p) => categoryOf(p) === c.id) }))
    .filter((g) => g.items.length);
  return html`<div class="grouped ${muted ? 'muted-list' : ''}">
    ${groups.map((g) => html`<div class="group"><h4>${g.c.label}</h4><ul>${g.items.map((p) => html`<li>${p.text}</li>`)}</ul></div>`)}
  </div>`;
}

function voteCard(p) {
  const mine = S.myVotes.get(`${p.id}:${p.version}`);
  const earlier = !mine && p.version > 1 && [...S.myVotes.values()].some((v) => v.principle_id === p.id);
  const category = categoriesById.get(p.category);
  const comment = S.voteDrafts.has(p.id) ? S.voteDrafts.get(p.id) : mine?.comment || '';
  const chosen = S.config.votes.find((o) => o.id === mine?.vote);
  const placeholder = chosen?.tone === 'mid' ? 'How would you reword it? (optional)' : chosen?.tone === 'neg' ? 'Why? (optional)' : 'Comment (optional)';
  return html`<article class="card vote-card ${mine ? 'voted' : ''}">
    <div class="vote-card-top">
      ${category ? html`<span class="chip">${category.label}</span>` : ''}
      ${p.version > 1 ? html`<span class="chip chip-note">Reworded · round ${p.version}</span>` : ''}
    </div>
    <p class="principle-text">${p.text}</p>
    ${earlier ? html`<p class="notice">The wording changed after you voted. Please vote again.</p>` : ''}
    <div class="vote-options" role="group" aria-label="Your vote">
      ${S.config.votes.map(
        (o) => html`<button type="button" class="vote-btn ${mine?.vote === o.id ? 'selected' : ''}" style="${voteVars(o)}"
          aria-pressed="${mine?.vote === o.id ? 'true' : 'false'}" data-action="vote" data-pid="${p.id}" data-vote="${o.id}" title="${o.hint}">
          <span class="swatch"></span>${o.label}</button>`,
      )}
    </div>
    ${mine
      ? html`<label class="vote-comment"><span class="sr-only">Comment</span>
          <textarea rows="2" data-input="vote-draft" data-change="vote-comment" data-pid="${p.id}" placeholder="${placeholder}">${comment}</textarea>
        </label>
        <p class="vote-status">✓ Your vote: <b>${chosen?.label || mine.vote}</b></p>`
      : ''}
  </article>`;
}

// ---- actions --------------------------------------------------------------------------------

function readReviewForm(form) {
  const data = new FormData(form);
  return {
    decision: data.get('decision') || '',
    rationale: (data.get('rationale') || '').toString(),
    tags: data.getAll('tags').map(String),
    other_tag: (data.get('other_tag') || '').toString().trim(),
    confidence: data.get('confidence') ? Number(data.get('confidence')) : null,
  };
}

// Keep the form's dynamic bits in step as someone fills it in.
function syncReviewForm(form) {
  const values = readReviewForm(form);
  const max = S.config.review.maxTags;
  for (const box of form.querySelectorAll('input[name="tags"]')) {
    box.disabled = Boolean(max) && values.tags.length >= max && !box.checked;
  }
  const other = form.querySelector('.other-field');
  if (other) other.hidden = !values.tags.includes('other');
  return values;
}

function saveDraft(form) {
  const values = syncReviewForm(form);
  const caseId = form.dataset.case;
  const saved = S.responses.get(caseId);
  const empty = !values.decision && !values.rationale.trim() && !values.tags.length && !values.confidence;
  const unchanged = saved && sameAnswer(values, saved);
  if (empty || unchanged) storage.remove(keys.draft(caseId));
  else storage.set(keys.draft(caseId), values);
  const status = form.querySelector('#form-status');
  status.textContent = saved ? (unchanged ? 'Saved. You can come back and change it.' : 'You have unsaved changes. Save to update your answer.') : '';
  status.classList.remove('error');
  form.querySelectorAll('.q.invalid').forEach((q) => q.classList.remove('invalid'));
}

function invalid(form, id, message) {
  const q = form.querySelector(`#${id}`);
  q.classList.add('invalid');
  const status = form.querySelector('#form-status');
  status.textContent = message;
  status.classList.add('error');
  q.scrollIntoView({ behavior: 'smooth', block: 'center' });
  q.querySelector('input, textarea')?.focus({ preventScroll: true });
}

async function saveResponse(form, event) {
  event.preventDefault();
  const caseId = form.dataset.case;
  const values = readReviewForm(form);
  if (!values.decision) return invalid(form, 'q-decision', 'Choose where this change belongs.');
  if (S.config.review.requireRationale && !values.rationale.trim()) {
    return invalid(form, 'q-rationale', 'Add a sentence on why. It is the most useful part for the discussion.');
  }
  if (!values.tags.includes('other')) values.other_tag = '';

  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const wasDone = myCases().length > 0 && doneCount() === myCases().length;
    const { row, queued } = await S.store.saveResponse({ participant_code: S.me.code, case_id: caseId, ...values, rationale: values.rationale.trim() });
    S.responses.set(caseId, row);
    storage.remove(keys.draft(caseId));
    const nowDone = doneCount() === myCases().length;
    sparkleBurst(button, nowDone && !wasDone ? { count: 30, spread: 150 } : {});
    if (queued) toast('Saved on this device. It will sync when the connection is back.', 'warn', 5000);
    else toast(nowDone && !wasDone ? 'All your cases are done. Thank you!' : 'Saved');
    const next = S.me.cases.includes(caseId) ? nextOpenCase(caseId) : null;
    location.hash = next ? `#/case/${encodeURIComponent(next)}` : '#/';
  } catch (err) {
    console.error(err);
    const status = form.querySelector('#form-status');
    status.textContent = `Couldn't save: ${err.message} Your answer is kept on this device; try again in a moment.`;
    status.classList.add('error');
    button.disabled = false;
    button.textContent = 'Try again';
  }
}

async function joinAs(person, { guest = false, keepRoute = false } = {}) {
  let locked = S.joined.find((j) => j.code === person.code);
  if (!locked) {
    const cases = guest
      ? assignGuest(person.code, caseIds(), currentAssignments(S.plan, S.joined), S.config.assignment)
      : S.plan.get(person.code) || [];
    const record = { code: person.code, name: person.name, cases, guest };
    await S.store.addParticipant(record);
    try {
      S.joined = await S.store.listParticipants({ cache: true });
    } catch {
      // offline: carry on with the computed assignment
    }
    locked = S.joined.find((j) => j.code === person.code) || record;
  }
  const valid = (locked.cases || []).filter((id) => casesById.has(id));
  S.me = { code: locked.code, name: locked.name || person.name, cases: valid.length ? valid : S.plan.get(person.code) || [], guest: Boolean(locked.guest) };
  storage.set(keys.me(), S.me.code);
  const url = new URL(location.href);
  url.searchParams.set('p', S.me.code);
  if (!keepRoute) url.hash = '#/';
  history.replaceState(null, '', url);
  S.join = { query: '', error: '', guestName: '', sameNameGuest: null };
  await loadMine();
  render({ force: true });
  if (!keepRoute) window.scrollTo(0, 0);
}

// Joining can fail if the database refuses the write (going offline doesn't
// count: that just queues it), so say so on the join page.
async function attemptJoin(join) {
  try {
    await join();
  } catch (err) {
    console.error(err);
    S.join.error = `Couldn't join: ${err.message}`;
    render({ force: true });
  }
}

// Someone not on the list (or anyone, when there is no list). A random suffix
// keeps two different people with the same name apart, even if their pages
// were opened before either joined.
async function joinAsNew(name) {
  const taken = new Set(everyone().map((p) => p.code));
  let code;
  do code = `${slugify(name)}-${randomSuffix()}`;
  while (taken.has(code));
  await joinAs({ code, name }, { guest: true });
}

async function loadMine() {
  try {
    const [responses, votes, principles] = await Promise.all([
      S.store.listResponses({ participant: S.me.code, cache: true }),
      S.store.listVotes({ participant: S.me.code, cache: true }),
      S.store.listPrinciples({ cache: true }),
    ]);
    S.responses = new Map(responses.map((r) => [r.case_id, r]));
    S.myVotes = new Map(votes.map((v) => [`${v.principle_id}:${v.version}`, v]));
    S.principles = principles;
    S.online = S.store.readOk();
    if (!S.online) toast("You're offline. Showing the answers saved on this device; new ones will sync later.", 'warn', 6000);
  } catch (err) {
    console.error(err);
    S.online = false;
    toast("Couldn't load your saved answers. Check the connection; we'll keep trying.", 'warn', 6000);
  }
}

async function castVote(principleId, voteId, comment) {
  const p = S.principles.find((x) => x.id === principleId);
  if (!p) return;
  try {
    const { row, queued } = await S.store.saveVote({ principle_id: p.id, version: p.version, participant_code: S.me.code, vote: voteId, comment });
    S.myVotes.set(`${p.id}:${p.version}`, row);
    if (queued) toast('Vote saved on this device. It will sync when the connection is back.', 'warn', 5000);
  } catch (err) {
    toast(`Couldn't save your vote: ${err.message}`, 'error', 5000);
  }
}

const clickHandlers = {
  async pick(el) {
    const person = everyone().find((p) => p.code === el.dataset.code);
    if (person) await attemptJoin(() => joinAs(person));
  },
  async 'join-guest'() {
    const name = S.join.guestName.trim();
    if (name) await attemptJoin(() => joinAsNew(name));
  },
  switch() {
    storage.remove(keys.me());
    S.me = null;
    S.responses = new Map();
    S.myVotes = new Map();
    const url = new URL(location.href);
    url.searchParams.delete('p');
    url.hash = '';
    history.replaceState(null, '', url);
    render({ force: true });
  },
  async 'copy-link'() {
    toast((await copyText(personalLink(S.me.code))) ? 'Link copied' : 'Copy failed: select the link and copy it manually', 'ok');
  },
  async vote(el) {
    const { pid } = el.dataset;
    const existing = S.principles.find((p) => p.id === pid);
    const current = existing && S.myVotes.get(`${pid}:${existing.version}`);
    const comment = S.voteDrafts.has(pid) ? S.voteDrafts.get(pid) : current?.comment || '';
    el.closest('.vote-options')?.querySelectorAll('button').forEach((b) => (b.disabled = true));
    await castVote(pid, el.dataset.vote, comment);
    sparkleBurst(el, { count: 10, spread: 55 });
    render({ force: true });
    // Keep keyboard users where they were.
    root.querySelector(`[data-action="vote"][data-pid="${CSS.escape(pid)}"][data-vote="${CSS.escape(el.dataset.vote)}"]`)?.focus();
  },
};

const submitHandlers = {
  async join(form, event) {
    event.preventDefault();
    const query = (new FormData(form).get('who')?.toString() || '').replace(/\s+/g, ' ').trim();
    S.join.query = query;
    S.join.sameNameGuest = null;
    S.join.error = '';
    if (!query) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Joining…';
    // Others may have joined since this page was opened (or this person, on
    // another device), so check the latest list before matching the name.
    try {
      S.joined = await S.store.listParticipants({ cache: true });
    } catch {
      // offline: go with the list we have
    }
    const allowNew = openJoin() || S.config.join.allowGuests;
    const { person, confirm } = findPerson(query);
    if (person && !confirm) return attemptJoin(() => joinAs(person));
    if (person && confirm) {
      S.join.sameNameGuest = person;
      S.join.guestName = allowNew ? query : '';
    } else if (openJoin()) {
      return attemptJoin(() => joinAsNew(query));
    } else if (allowNew) {
      S.join.error = `We couldn't find “${query}” on the list.`;
      S.join.guestName = query;
    } else {
      S.join.error = `We couldn't find “${query}”. Check your code, or ask the facilitator.`;
      S.join.guestName = '';
    }
    render({ force: true });
    root.querySelector('#who')?.focus();
  },
  'save-response': saveResponse,
  async propose(form, event) {
    event.preventDefault();
    const data = new FormData(form);
    const text = (data.get('text') || '').toString().trim();
    if (!text) return;
    const category = (data.get('category') || 'unsorted').toString();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const principle = {
        id: uuid(),
        text,
        category,
        position: maxPosition(category) + 1,
        status: 'proposed',
        version: 1,
        source_case_id: (data.get('source_case_id') || '').toString() || null,
        proposed_by: S.me.code,
      };
      const { row, queued } = await S.store.addPrinciple(principle);
      S.principles.push(row);
      S.proposeDraft = {};
      sparkleBurst(button);
      form.reset();
      toast(queued ? 'Saved on this device; it will sync when the connection is back.' : 'Thanks! Your proposal has been added for discussion.', queued ? 'warn' : 'ok');
      render({ force: true });
      root.querySelector('#p-text')?.focus(); // ready for the next one
    } catch (err) {
      toast(`Couldn't add your proposal: ${err.message}`, 'error', 5000);
      button.disabled = false;
    }
  },
};

function saveProposeDraft(form) {
  const data = new FormData(form);
  S.proposeDraft = {
    text: (data.get('text') || '').toString(),
    category: (data.get('category') || '').toString(),
    source_case_id: (data.get('source_case_id') || '').toString(),
  };
}

const inputHandlers = {
  draft: (form) => saveDraft(form),
  'vote-draft': (el) => S.voteDrafts.set(el.dataset.pid, el.value),
  'propose-draft': saveProposeDraft,
};

const changeHandlers = {
  draft: (form) => saveDraft(form),
  'propose-draft': saveProposeDraft,
  async 'vote-comment'(el) {
    const { pid } = el.dataset;
    const p = S.principles.find((x) => x.id === pid);
    const current = p && S.myVotes.get(`${pid}:${p.version}`);
    if (!current) return;
    await castVote(pid, current.vote, el.value);
    S.voteDrafts.delete(pid);
    toast('Comment saved');
  },
};

delegate(root, 'click', clickHandlers);
delegate(root, 'submit', submitHandlers);
delegate(root, 'input', inputHandlers);
delegate(root, 'change', changeHandlers);

// ---- live updates -----------------------------------------------------------------------------

function refreshChrome() {
  const badge = root.querySelector('#vote-badge');
  if (badge) {
    const pending = needsMyVote();
    badge.textContent = pending;
    badge.hidden = !pending;
  }
  const slot = root.querySelector('#sync-slot');
  if (slot) slot.innerHTML = syncBadge(S.store, S.online);
}

let lastPoll = 0;
async function poll() {
  if (!S.me) return;
  if (document.hidden && Date.now() - lastPoll < 30000) return; // slow down in background tabs
  lastPoll = Date.now();
  try {
    const principles = await S.store.listPrinciples({ cache: true });
    S.online = S.store.readOk();
    // Back online with answers waiting? Send them now rather than at the next
    // retry. (A write the server keeps rejecting is left to the slow retry.)
    const error = S.store.lastError();
    if (S.online && S.store.pendingCount() && (!error || error.network)) S.store.flush();
    const signature = JSON.stringify(principles.map((p) => [p.id, p.status, p.version, p.text, p.category, p.position]));
    if (signature !== S.signature) {
      S.signature = signature;
      S.principles = principles;
      const fresh = votingPrinciples().filter(
        (p) => !S.notified.has(`${p.id}:${p.version}`) && !S.myVotes.has(`${p.id}:${p.version}`),
      );
      fresh.forEach((p) => S.notified.add(`${p.id}:${p.version}`));
      // The home page has no form fields, so it's safe to redraw it too (for the "Voting is open" banner).
      if (route().name === 'principles' || route().name === 'home') render();
      if (route().name !== 'principles' && fresh.length) toast(`Voting is open: ${plural(fresh.length, 'principle')} waiting for your vote`, 'ok', 6000);
    } else {
      renderer.flush();
    }
  } catch {
    S.online = false;
  }
  refreshChrome();
}

// ---- start -------------------------------------------------------------------------------------

async function start() {
  try {
    S.config = await loadConfig();
  } catch (err) {
    console.error(err);
    errorScreen(root, 'The workshop data could not be loaded', err.message);
    return;
  }
  const { config } = S;
  document.title = config.title;
  casesById = byId(config.cases);
  decisionsById = byId(config.decisions);
  categoriesById = byId(config.categories);
  S.store = createStore(config);
  S.plan = planAssignments(config.roster, caseIds(), config.assignment);

  try {
    S.joined = await S.store.listParticipants({ cache: true });
  } catch (err) {
    console.error(err);
    S.online = false;
  }

  const code = params.get('p') ? slugify(params.get('p')) : storage.get(keys.me());
  const person = code ? everyone().find((p) => p.code === code) : null;
  if (person) {
    await joinAs(person, { guest: !config.roster.some((r) => r.code === person.code), keepRoute: true });
  } else {
    if (params.get('p')) S.join.error = `We couldn't find the participant code “${params.get('p')}”.`;
    render({ force: true });
  }

  installTooltips();
  S.store.onChange(() => {
    if (!S.store.lastError() && !S.store.pendingCount()) S.online = true; // a successful sync proves we're back
    refreshChrome();
    // Demo mode: another tab changed something, so pick it up now. (Not for
    // Supabase, where this fires after every sync and would loop.)
    if (S.store.kind === 'local' && route().name === 'principles') poll();
  });
  setInterval(poll, 5000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
  window.addEventListener('online', () => {
    S.online = true;
    poll();
  });
  window.addEventListener('offline', () => {
    S.online = false;
    refreshChrome();
  });
}

start();

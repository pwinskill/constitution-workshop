// Shared UI pieces: logo, stacked bars, legends, toasts, tooltips, and a
// renderer that won't clobber a field someone is typing in.

import { html, raw } from './html.js';
import { seededRandom } from './util.js';

// Pastel-but-bright star colours used for decoration only (never for data).
const STAR_COLORS = ['#ff8fc7', '#ffc36b', '#f2d85a', '#79dea7', '#6ad3e8', '#8fb2ff', '#c39bff'];

// ---- colour helpers ----------------------------------------------------------

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.5;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function onColor(hex) {
  const l = luminance(hex);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#111418' : '#ffffff';
}

// CSS custom properties that colour a decision's marks (--c) and any text set
// inside those marks (--c-on).
export function decisionVars(decision) {
  if (decision?.color) return `--c:${decision.color};--c-on:${onColor(decision.color)}`;
  const slot = decision?.slot && decision.slot <= 6 ? decision.slot : 'other';
  return `--c:var(--cat-${slot});--c-on:var(--cat-${slot}-on)`;
}

export function voteVars(option) {
  return `--c:var(--vote-${option.tone});--c-on:var(--vote-${option.tone}-on)`;
}

// ---- marks -------------------------------------------------------------------

// A 100% stacked bar. segments: [{ label, value, vars }]
export function stackedBar(segments, { total, size = 'md', ariaLabel = '', showZero = false } = {}) {
  const n = total ?? segments.reduce((s, x) => s + x.value, 0);
  if (!n) return html`<div class="stack stack-${size} stack-empty" role="img" aria-label="No responses yet"><span>No responses yet</span></div>`;
  const parts = segments.filter((s) => s.value > 0 || showZero);
  const label = ariaLabel || parts.map((s) => `${s.label} ${s.value}`).join(', ');
  return html`<div class="stack stack-${size}" role="img" aria-label="${label}">
    ${parts.map(
      (s) => html`<span class="seg" style="flex:${s.value} 1 0;${raw(s.vars)}"
        data-tip="${s.label} · ${s.value} of ${n} (${Math.round((100 * s.value) / n)}%)"><span class="seg-label">${s.value}</span></span>`,
    )}
  </div>`;
}

// Horizontal bar whose length is relative to `max`, stacked by decision.
export function lengthBar(segments, max, { size = 'sm' } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const width = max ? Math.min(100, (100 * total) / max) : 0;
  const label = segments.filter((s) => s.value > 0).map((s) => `${s.label} ${s.value}`).join(', ');
  return html`<div class="lbar lbar-${size}">
    <div class="lbar-track" role="img" aria-label="${total} in total: ${label}">
      <div class="lbar-fill" style="width:${width.toFixed(2)}%">
        ${segments
          .filter((s) => s.value > 0)
          .map((s) => html`<span class="seg" style="flex:${s.value} 1 0;${raw(s.vars)}" data-tip="${s.label} · ${s.value}"></span>`)}
      </div>
    </div>
    <span class="lbar-value">${total}</span>
  </div>`;
}

export function legend(items) {
  return html`<ul class="legend">
    ${items.map((i) => html`<li><span class="swatch" style="${raw(i.vars)}"></span>${i.label}${i.value != null ? html` <b>${i.value}</b>` : ''}</li>`)}
  </ul>`;
}

export function meter(value, { label = '' } = {}) {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  return html`<span class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v * 100)}" aria-label="${label}">
    <span class="meter-fill" style="width:${(v * 100).toFixed(1)}%"></span>
  </span>`;
}

// Hide in-bar labels that don't fit their segment (measure, never clip).
export function fitLabels(root) {
  for (const label of root.querySelectorAll('.seg-label')) {
    label.style.visibility = '';
    const seg = label.parentElement;
    if (label.offsetWidth + 8 > seg.clientWidth) label.style.visibility = 'hidden';
  }
}

// ---- logo ----------------------------------------------------------------------

let logoCount = 0;
export function logo(size = 34) {
  const id = `logo-grad-${++logoCount}`;
  return raw(`<svg class="logo" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8fc7"/><stop offset=".28" stop-color="#ffc36b"/><stop offset=".52" stop-color="#79dea7"/>
      <stop offset=".76" stop-color="#6ad3e8"/><stop offset="1" stop-color="#b08cff"/>
    </linearGradient></defs>
    <path d="M20 2.5 35.2 11.25v17.5L20 37.5 4.8 28.75v-17.5Z" fill="var(--logo-bg)" stroke="url(#${id})" stroke-width="2.6" stroke-linejoin="round"/>
    <g fill="none" stroke="url(#${id})" stroke-width="1.6" stroke-linecap="round">
      <path d="M13 15 20 12l7 4M13 15l7 7 7-6M20 22l-6 5M20 22l7 5M13 15v10"/>
    </g>
    <g fill="var(--logo-dot)">
      <circle cx="13" cy="15" r="2.2"/><circle cx="20" cy="12" r="2.2"/><circle cx="27" cy="16" r="2.2"/>
      <circle cx="20" cy="22" r="2.6"/><circle cx="14" cy="27" r="2.2"/><circle cx="27" cy="27" r="2.2"/><circle cx="13" cy="25" r="1.4"/>
    </g>
  </svg>`);
}

// ---- sparkle ----------------------------------------------------------------------------
// Decoration only: hidden from screen readers, and motionless when the viewer
// has asked their system for reduced motion.

export function sparkles(count = 6, { seed = 1, white = false, size = [6, 13] } = {}) {
  const rand = seededRandom(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const s = size[0] + rand() * (size[1] - size[0]);
    const c = white ? '#ffffff' : STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)];
    stars.push(
      `<i style="--x:${(2 + rand() * 94).toFixed(1)}%;--y:${(4 + rand() * 84).toFixed(1)}%;--s:${s.toFixed(1)}px;--c:${c};--d:${(2.8 + rand() * 2.8).toFixed(2)}s;--delay:${(-rand() * 5).toFixed(2)}s"></i>`,
    );
  }
  return raw(`<span class="sparkles" aria-hidden="true">${stars.join('')}</span>`);
}

// A small burst of stars from an element (e.g. the button that was pressed).
export function sparkleBurst(target, { count = 12, spread = 70 } = {}) {
  if (!target?.getBoundingClientRect) return;
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const rect = target.getBoundingClientRect();
  const host = document.createElement('div');
  host.className = 'burst';
  host.setAttribute('aria-hidden', 'true');
  host.style.left = `${rect.left + rect.width / 2}px`;
  host.style.top = `${rect.top + rect.height / 2}px`;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('i');
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const distance = spread * (0.55 + Math.random() * 0.6);
    star.style.setProperty('--dx', `${(Math.cos(angle) * distance).toFixed(1)}px`);
    star.style.setProperty('--dy', `${(Math.sin(angle) * distance).toFixed(1)}px`);
    star.style.setProperty('--s', `${(6 + Math.random() * 9).toFixed(1)}px`);
    star.style.setProperty('--c', STAR_COLORS[i % STAR_COLORS.length]);
    star.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
    host.appendChild(star);
  }
  document.body.appendChild(host);
  setTimeout(() => host.remove(), 1400);
}

// ---- small components ------------------------------------------------------------

export function decisionChip(decision) {
  if (!decision) return '';
  return html`<span class="chip chip-decision" style="${raw(decisionVars(decision))}"><span class="swatch"></span>${decision.label}</span>`;
}

export function syncBadge(store, online = true) {
  if (store.kind === 'local') {
    return html`<span class="sync sync-demo" title="${store.label}"><span class="dot"></span>Demo mode</span>`;
  }
  const pending = store.pendingCount();
  const error = store.lastError();
  if (!online || error?.network) {
    return html`<span class="sync sync-warn" title="${error?.message || 'Offline'}"><span class="dot"></span>Offline${pending ? ` · ${pending} waiting` : ''}</span>`;
  }
  if (error) return html`<span class="sync sync-error" title="${error.message}"><span class="dot"></span>Sync problem</span>`;
  if (pending) return html`<span class="sync sync-warn"><span class="dot"></span>Syncing ${pending}…</span>`;
  return html`<span class="sync sync-ok" title="Connected to the shared database"><span class="dot"></span>Live</span>`;
}

// ---- toasts & tooltip -----------------------------------------------------------

let toastHost = null;
export function toast(message, kind = 'ok', ms = 3200) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  toastHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export function installTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  let current = null;
  const place = (event) => {
    const pad = 14;
    const rect = tip.getBoundingClientRect();
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - pad;
    tip.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  };
  document.addEventListener('pointerover', (event) => {
    const target = event.target.closest?.('[data-tip]');
    if (!target) return;
    current = target;
    current.classList.add('hover');
    tip.textContent = target.dataset.tip;
    tip.classList.add('show');
    place(event);
  });
  document.addEventListener('pointermove', (event) => {
    if (current) place(event);
  });
  document.addEventListener('pointerout', (event) => {
    if (!current) return;
    if (event.relatedTarget && current.contains(event.relatedTarget)) return;
    current.classList.remove('hover');
    current = null;
    tip.classList.remove('show');
  });
}

// ---- rendering -------------------------------------------------------------------

// Re-renders `root` from `view()`, but holds off while someone is typing in a
// field inside it (or while `hold()` is active, e.g. during a drag) and
// catches up as soon as they stop.
// Re-rendering replaces the page, which would drop keyboard focus back to the
// top. This names the focused button or link (by id, or by its action and
// target) so the same control can be focused again afterwards. Text fields are
// left alone: renders wait while one is in use.
const FOCUS_KEYS = ['action', 'id', 'section', 'case', 'status', 'dir', 'what', 'vote', 'pid', 'code', 'step', 'op'];
function focusKey(root) {
  const el = document.activeElement;
  if (!el || el === document.body || !root.contains(el) || el.matches('input:not([type=checkbox]):not([type=radio]), textarea')) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  const attrs = FOCUS_KEYS.filter((k) => el.dataset[k] != null).map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`);
  if (attrs.length) return `${el.tagName.toLowerCase()}${attrs.join('')}`;
  const href = el.getAttribute('href');
  return href ? `a[href="${CSS.escape(href)}"]` : null;
}

export function createRenderer(root, view, afterRender = () => {}) {
  let pending = false;
  let holds = 0;
  // Also wait while a mouse button or finger is down: re-rendering between
  // mousedown and mouseup would swallow the click (e.g. on a Save button).
  // (Capped at 3 s, in case the button is released outside the window.)
  let pressedAt = 0;
  const pressing = () => pressedAt > 0 && Date.now() - pressedAt < 3000;
  const busy = () => {
    if (holds > 0 || pressing()) return true;
    const active = document.activeElement;
    return Boolean(active && root.contains(active) && active.matches('input, textarea, select'));
  };
  const catchUp = () => {
    setTimeout(() => {
      if (pending && !busy()) render();
    }, 60);
  };
  document.addEventListener('pointerdown', () => (pressedAt = Date.now()), true);
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(
      type,
      () => {
        pressedAt = 0;
        catchUp();
      },
      true,
    );
  }
  function render({ force = false } = {}) {
    if (!force && busy()) {
      pending = true;
      return;
    }
    pending = false;
    const focused = focusKey(root);
    root.innerHTML = view();
    fitLabels(root);
    afterRender(root);
    if (focused && !root.contains(document.activeElement)) root.querySelector(focused)?.focus({ preventScroll: true });
  }
  root.addEventListener('focusout', catchUp);
  window.addEventListener('resize', () => fitLabels(root));
  return {
    render,
    // Catch up on a render that was held back, if nothing is in the way now.
    flush() {
      if (pending && !busy()) render();
    },
    hold() {
      holds++;
    },
    release() {
      holds = Math.max(0, holds - 1);
      if (pending) render();
    },
  };
}

// Delegated events. Each event type has its own attribute so a click inside a
// form never triggers the form's submit handler, etc.:
//   <button data-action="save">   click  -> handlers.save(el, event)
//   <form data-submit="add">      submit -> handlers.add(form, event)
//   <input data-change="x">       change -> handlers.x(input, event)
//   <textarea data-input="y">     input  -> handlers.y(textarea, event)
const ATTR = { click: 'action', submit: 'submit', change: 'change', input: 'input' };
export function delegate(root, type, handlers) {
  const attr = ATTR[type] || type;
  root.addEventListener(type, (event) => {
    const el = event.target.closest?.(`[data-${attr}]`);
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset[attr]];
    if (fn) fn(el, event);
  });
}

export function errorScreen(root, title, message) {
  root.innerHTML = html`<main class="page narrow"><div class="card error-card">
    <h1>${title}</h1><p>${message}</p>
    <p class="muted">Check the browser console for details, fix the file, and reload.</p>
  </div></main>`;
}

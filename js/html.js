// Tiny safe-by-default HTML templating.
//
//   html`<p>${userText}</p>`   -> interpolated values are escaped
//   html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`  -> nested templates are kept
//   raw(trustedMarkup)          -> opt out of escaping (only for markup we wrote)
//
// The result is a SafeHTML object; assigning it to innerHTML uses its string form.

class SafeHTML {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function raw(markup) {
  return new SafeHTML(String(markup ?? ''));
}

function renderValue(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof SafeHTML) return value.value;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + strings[i + 1];
  }
  return new SafeHTML(out);
}

// Conditional class list: cls('card', { active: isActive, muted: false }) -> "card active"
export function cls(...parts) {
  const out = [];
  for (const part of parts) {
    if (!part) continue;
    if (typeof part === 'string') out.push(part);
    else for (const [name, on] of Object.entries(part)) if (on) out.push(name);
  }
  return out.join(' ');
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cls, esc, html, raw } from '../js/html.js';

test('interpolated values are escaped', () => {
  const out = String(html`<p title="${'"x"'}">${'<script>alert(1)</script>'}</p>`);
  assert.equal(out, '<p title="&quot;x&quot;">&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('nested templates and arrays are kept, raw() opts out', () => {
  const items = ['a&b', 'c'];
  const out = String(html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>${raw('<hr>')}`);
  assert.equal(out, '<ul><li>a&amp;b</li><li>c</li></ul><hr>');
});

test('null, undefined and booleans render as nothing', () => {
  assert.equal(String(html`${null}${undefined}${false}${true}|${0}`), '|0');
});

test('esc and cls helpers', () => {
  assert.equal(esc(`<'&">`), '&lt;&#39;&amp;&quot;&gt;');
  assert.equal(cls('card', { on: true, off: false }, null, 'x'), 'card on x');
});

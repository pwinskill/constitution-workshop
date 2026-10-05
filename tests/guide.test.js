// guides/guide.js fills in the workshop links on the printable guides.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../guides/guide.js', import.meta.url), 'utf8');

// Runs guide.js on a pretend page at `address`; returns the links it filled in.
function fill(address, links = ['', 'facilitator.html', '?ws=dry-run']) {
  const filled = [];
  const slots = links.map((link) => ({
    getAttribute: () => link,
    replaceWith: (a) => filled.push({ href: a.href, text: a.children.map((c) => c.text ?? '').join('') }),
  }));
  const document = {
    querySelectorAll: () => slots,
    createElement: (tag) => ({
      tag,
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    }),
    createTextNode: (text) => ({ text }),
  };
  const url = new URL(address);
  vm.runInNewContext(source, { location: { search: url.search, protocol: url.protocol, href: address }, document, URL, URLSearchParams });
  return filled;
}

test('on the live site, the links point one folder up from guides/', () => {
  assert.deepEqual(fill('https://u.github.io/repo/guides/host-guide.html'), [
    { href: 'https://u.github.io/repo/', text: 'u.github.io/repo' },
    { href: 'https://u.github.io/repo/facilitator.html', text: 'u.github.io/repo/facilitator.html' },
    { href: 'https://u.github.io/repo/?ws=dry-run', text: 'u.github.io/repo/?ws=dry-run' },
  ]);
});

test('?url= takes the address in any of the usual forms, and never prints a ?key=', () => {
  for (const given of [
    'u.github.io/repo',
    'https://u.github.io/repo/',
    'HTTPS://u.github.io/repo/facilitator.html?key=secret#/vote',
    'u.github.io/repo/guides/host-guide.html',
    'u.github.io/repo/index.html',
  ]) {
    const [link] = fill(`file:///C:/guides/host-guide.html?url=${encodeURIComponent(given)}`, ['']);
    assert.deepEqual(link, { href: 'https://u.github.io/repo/', text: 'u.github.io/repo' }, given);
  }
});

test('opened from disk without ?url=, the blanks are left for writing on', () => {
  assert.deepEqual(fill('file:///C:/guides/host-guide.html'), []);
});

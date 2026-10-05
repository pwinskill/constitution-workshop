import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayUrl, orList, within } from '../js/util.js';

test('orList joins labels the way you would say them', () => {
  assert.equal(orList([]), '');
  assert.equal(orList(['Agree']), 'Agree');
  assert.equal(orList(['Agree', 'Disagree']), 'Agree or Disagree');
  assert.equal(orList(['Agree', 'Amend', 'Disagree']), 'Agree, Amend or Disagree');
});

test('displayUrl drops the scheme and a trailing slash, and keeps the rest', () => {
  assert.equal(displayUrl('https://u.github.io/repo/'), 'u.github.io/repo');
  assert.equal(displayUrl('HTTPS://u.github.io/repo/'), 'u.github.io/repo');
  assert.equal(displayUrl('http://localhost:8000/'), 'localhost:8000');
  assert.equal(displayUrl('https://u.github.io/repo/?ws=dry-run'), 'u.github.io/repo/?ws=dry-run');
});

test('within gives up after the time limit, or on failure, with the fallback', async () => {
  assert.equal(await within(Promise.resolve(1), 50), 1);
  assert.equal(await within(new Promise(() => {}), 20, 'too slow'), 'too slow');
  assert.equal(await within(Promise.reject(new Error('no')), 50, 'failed'), 'failed');
});

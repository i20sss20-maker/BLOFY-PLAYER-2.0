import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('runtime portal subscriber bridge keeps the current BLOFY session contract', async () => {
  const source = await readFile(new URL('../src/subscriber-portal-ui-hook.mjs', import.meta.url), 'utf8');
  for (const token of [
    'data-blofy-subscriber-ui="1"',
    "option.value = 'blofy'",
    'مشتركين BLOFY',
    '/api/v1/subscribers/session',
    "select.value = 'xtream'",
    "dispatchValue(qs('baseUrl'), session.baseUrl)",
    "dispatchValue(qs('username'), session.username)",
    "dispatchValue(qs('password'), session.password)"
  ]) assert.ok(source.includes(token), `missing ${token}`);
});

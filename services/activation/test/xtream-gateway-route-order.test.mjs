import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bootstrap = await readFile(new URL('../src/bootstrap.mjs', import.meta.url), 'utf8');

test('Xtream gateway is registered before the broader Xtream admin router', () => {
  const gateway = bootstrap.indexOf("await import('./xtream-gateway-hook.mjs')");
  const admin = bootstrap.indexOf("await import('./xtream-admin-hook.mjs')");
  assert.notEqual(gateway, -1, 'gateway hook import missing');
  assert.notEqual(admin, -1, 'Xtream admin hook import missing');
  assert.ok(gateway < admin, 'gateway must be imported first so /api/v1/admin/xtream-gateway routes are not swallowed by /api/v1/admin/xtream');
});

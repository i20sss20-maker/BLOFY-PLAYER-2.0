import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

const base = new URL('../web/', import.meta.url);
const read = path => readFile(new URL(path, base), 'utf8');

test('BLOFY STREAM website ships a syntactically valid dual-access console', async () => {
  const [html, script, css] = await Promise.all([
    read('sources-admin.html'),
    read('stream-dual-access.js'),
    read('stream-dual-access.css')
  ]);
  assert.doesNotThrow(() => new Script(script));
  assert.match(html, /stream-dual-access\.js\?v=20261118-v1/);
  assert.match(html, /stream-dual-access\.css\?v=20261118-v1/);
  assert.match(html, /data-blofy-dual-shortcut/);
  assert.match(css, /grid-template-columns:1fr/);
  for (const id of [
    'streamDualAccess', 'dualCodeForm', 'dualVoucher', 'dualCodeToXtream',
    'dualAccountForm', 'dualAccountSelect', 'dualXtreamToCode',
    'dualXtreamResult', 'dualVoucherResult', 'dualHideXtream', 'dualHideCode'
  ]) assert.match(html, new RegExp('id="' + id + '"'));
});

test('both website conversions use existing admin-only POST routes and clear secrets', async () => {
  const script = await read('stream-dual-access.js');
  assert.match(script, /\/api\/v1\/admin\/xtream-gateway\/link\/code-to-xtream/);
  assert.match(script, /\/api\/v1\/admin\/xtream-gateway\/link\/xtream-to-code/);
  assert.match(script, /method: body === undefined \? 'GET' : 'POST'/);
  assert.match(script, /credentials: 'same-origin'/);
  assert.match(script, /cache: 'no-store'/);
  assert.match(script, /window\.setTimeout\(conceal, 90000\)/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /pagehide/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|console\.log|\?code=/);
});

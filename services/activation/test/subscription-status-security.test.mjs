import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/subscription-hook.mjs', import.meta.url), 'utf8');

test('subscription status accepts POST and reads credentials from JSON body', () => {
  assert.match(
    source,
    /req\.method === 'POST' \? await readJson\(req\) : requestUrl\.searchParams/,
    'POST status requests must read device credentials from the request body',
  );
  assert.match(
    source,
    /\(req\.method === 'POST' \|\| req\.method === 'GET'\).*`\$\{PREFIX\}\/status`/,
    'status route must accept secure POST while retaining temporary GET compatibility',
  );
});

test('POST subscription-status path never sources credentials directly from URL', () => {
  const start = source.indexOf('async function subscriptionStatus');
  const end = source.indexOf('async function reconcileDeviceEntitlement', start);
  assert.ok(start >= 0 && end > start, 'subscriptionStatus handler must remain discoverable');
  const block = source.slice(start, end);
  assert.doesNotMatch(
    block,
    /requestUrl\.searchParams\.get\('activationCode'\)/,
    'subscriptionStatus must not read activationCode directly from the URL',
  );
  assert.match(
    block,
    /req\.method === 'POST' \? auth\.activationCode : auth\.get\('activationCode'\)/,
    'POST activationCode must come from the parsed request body',
  );
});

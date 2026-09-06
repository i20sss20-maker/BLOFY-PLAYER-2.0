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

test('new Android client contract never requires credentials in a status URL', () => {
  assert.doesNotMatch(
    source,
    /requestUrl\.searchParams\.get\('activationCode'\).*req\.method === 'POST'/s,
    'POST credential handling must not source activationCode from the URL',
  );
});

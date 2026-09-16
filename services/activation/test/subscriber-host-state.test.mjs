import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverSubscriberHost,
  loadPersistedSubscriberHost,
  normalizeLearnedSubscriberHost,
  openSubscriberHost,
  savePersistedSubscriberHost,
  sealSubscriberHost
} from '../src/subscriber-host-state.mjs';

const KEY = 'ab'.repeat(32);
const HOST = 'https://subscriber.example.test';

function fakePool() {
  let stored = null;
  return {
    get stored() { return stored; },
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes('CREATE TABLE IF NOT EXISTS blofy_subscriber_state')) return { rows: [] };
      if (text.includes('SELECT host_enc FROM blofy_subscriber_state')) return { rows: stored ? [{ host_enc: stored }] : [] };
      if (text.includes('INSERT INTO blofy_subscriber_state')) {
        stored = params[0];
        return { rows: [] };
      }
      throw new Error(`unexpected_query:${text}`);
    }
  };
}

test('subscriber host encryption round-trips without plaintext storage', async () => {
  const pool = fakePool();
  await savePersistedSubscriberHost(pool, KEY, `${HOST}/`);
  assert.ok(pool.stored?.startsWith('v1.'));
  assert.equal(pool.stored.includes(HOST), false);
  assert.equal(await loadPersistedSubscriberHost(pool, KEY), HOST);
});

test('subscriber host envelope rejects wrong keys and tampering', () => {
  const sealed = sealSubscriberHost(HOST, KEY);
  assert.equal(openSubscriberHost(sealed, KEY), HOST);
  assert.equal(openSubscriberHost(sealed, 'cd'.repeat(32)), null);
  assert.equal(openSubscriberHost(`${sealed}x`, KEY), null);
});

test('learned host validation rejects credentials, query and hash', () => {
  assert.equal(normalizeLearnedSubscriberHost('https://user:pass@example.test'), null);
  assert.equal(normalizeLearnedSubscriberHost('https://example.test/?x=1'), null);
  assert.equal(normalizeLearnedSubscriberHost('https://example.test/#x'), null);
  assert.equal(normalizeLearnedSubscriberHost('ftp://example.test'), null);
  assert.equal(normalizeLearnedSubscriberHost('https://example.test/path/'), 'https://example.test/path');
});

test('bootstrap learns host only from a successful direct session', async () => {
  const seen = [];
  const host = await discoverSubscriberHost({
    bootstrapBaseUrl: 'https://old.example.test',
    deviceId: 'BLOFY-TEST-0001',
    activationCode: '123456',
    username: 'demo-user',
    password: 'demo-pass',
    fetchImpl: async (url, options) => {
      seen.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ delivery: 'direct', baseUrl: `${HOST}/` }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  assert.equal(host, HOST);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.delivery, 'direct');
});

test('bootstrap rejects failed login and malicious base URLs', async () => {
  await assert.rejects(
    discoverSubscriberHost({
      bootstrapBaseUrl: 'https://old.example.test',
      deviceId: 'BLOFY-TEST-0001', activationCode: '123456', username: 'u', password: 'p',
      fetchImpl: async () => new Response(JSON.stringify({ error: 'subscriber_login_failed' }), { status: 401 })
    }),
    /subscriber_login_failed/
  );
  await assert.rejects(
    discoverSubscriberHost({
      bootstrapBaseUrl: 'https://old.example.test',
      deviceId: 'BLOFY-TEST-0001', activationCode: '123456', username: 'u', password: 'p',
      fetchImpl: async () => new Response(JSON.stringify({ delivery: 'direct', baseUrl: 'https://user:pass@evil.example.test' }), { status: 200 })
    }),
    /subscriber_bootstrap_invalid_response/
  );
});

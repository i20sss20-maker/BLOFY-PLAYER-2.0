import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { Readable, Writable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import test from 'node:test';
import { createActivationCredentialCodec } from '../src/auth-protection.mjs';
import { createLiteralByteReplace } from '../src/literal-byte-replace.mjs';
import * as playlistIdentity from '../src/playlist-identity.mjs';
import { devicePool, loadHooks } from './helpers/hook-harness.mjs';

const key = '9c'.repeat(32);
const rootKey = Buffer.from(key, 'hex');
const origin = 'https://origin.example.test';
const prefix = '/api/v1/subscribers/xtream';
const deviceId = 'BLOFY-PROXY-TEST';
const env = { DATABASE_URL: 'fixture', BLOFY_PLAYLIST_ENCRYPTION_KEY: key, BLOFY_SUBSCRIBER_HOST: origin };
const codec = createActivationCredentialCodec(key);

// Independent baseline session/URL encoders verify compatibility with already-installed playlists.
function legacySession(id = deviceId, expiresAt = Date.now() + 60_000) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', rootKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ u: 'fixture-user', p: 'fixture-pass', d: id, exp: expiresAt })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function sign(token, target) {
  return crypto.createHmac('sha256', rootKey).update(`${token}\n${target}`).digest('base64url');
}
function legacyUrl(token, url) {
  const target = Buffer.from(url).toString('base64url');
  return `${prefix}/url/${token}/${target}/${sign(token, target)}`;
}
function request(path, body) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { url: path, method: body ? 'POST' : 'GET', headers: { host: 'app.example.test', 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '127.0.0.1' } });
  return req;
}
function response() {
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, next) { chunks.push(Buffer.from(chunk)); next(); } });
  res.status = 0;
  res.headers = {};
  res.headerWrites = 0;
  res.writeHead = (status, headers) => {
    assert.equal(res.headerWrites, 0, 'response headers must be sent once');
    res.headerWrites++;
    res.status = status;
    res.headers = headers;
    res.headersSent = true;
  };
  res.bytes = () => Buffer.concat(chunks);
  return res;
}
async function fixture({ row, fetch: fetchStub, dependencies = {} } = {}) {
  row ||= { device_id: deviceId, activation_code: codec.proof(deviceId, '123456'), status: 'active', expires_at: null };
  const pool = devicePool(row, async (sql) => ({ rows: sql.startsWith('SELECT status,expires_at') ? [{ ...row }] : [] }));
  const hooks = await loadHooks(['subscriber-proxy-hook.mjs'], { env, pool, dependencies: {
    ...playlistIdentity, Readable, pipeline, createLiteralByteReplace, AbortController, AbortSignal,
    fetch: fetchStub || (async () => { throw new Error('unexpected upstream request'); }), ...dependencies
  } });
  return { ...hooks, row, pool, fn: (name) => vm.runInContext(name, hooks.contexts[0]) };
}
async function dispatch(hooks, req, res = response()) {
  await hooks.listener(req, res);
  return res;
}

test('new HLS target URLs hide provider origin and credentials while preserving the destination', async () => {
  const hooks = await fixture();
  const token = legacySession();
  const target = `${origin}/live/fixture-user/fixture-pass/segment.ts?token=fixture-query`;
  const make = hooks.fn('proxyTargetUrl');
  const first = make(request('/'), token, target);
  const second = make(request('/'), token, target);
  assert.notEqual(first, second, 'each target envelope needs a fresh nonce');
  const parts = new URL(first).pathname.split('/');
  const encoded = parts.at(-2);
  assert.ok(encoded.startsWith('v2.'));
  const decoded = Buffer.from(encoded.slice(3), 'base64url').toString('utf8');
  for (const secret of ['origin.example.test', 'fixture-user', 'fixture-pass', 'fixture-query']) {
    assert.ok(!first.includes(secret));
    assert.ok(!decoded.includes(secret));
  }
  assert.equal(hooks.fn('verifiedTarget')(token, encoded, parts.at(-1)), target);
  assert.equal(hooks.fn('openSession')(token).u, 'fixture-user');
});

test('v2 target rejects tampering, another session and downgrade attempts', async () => {
  const hooks = await fixture();
  const token = legacySession();
  const parts = new URL(hooks.fn('proxyTargetUrl')(request('/'), token, `${origin}/live/u/p/1.ts`)).pathname.split('/');
  const encoded = parts.at(-2);
  const verify = hooks.fn('verifiedTarget');
  const packed = Buffer.from(encoded.slice(3), 'base64url');
  packed[packed.length - 1] ^= 1;
  const changed = `v2.${packed.toString('base64url')}`;
  assert.equal(verify(token, changed, parts.at(-1)), null);
  assert.equal(verify(token, changed, sign(token, changed)), null, 'AEAD must reject even if outer signature is valid');
  const anotherSession = legacySession();
  assert.equal(verify(anotherSession, encoded, sign(anotherSession, encoded)), null, 'AAD must bind targets to their session');
  const fakeV2 = `v2.${Buffer.from(`${origin}/plaintext`).toString('base64url')}`;
  assert.equal(verify(token, fakeV2, sign(token, fakeV2)), null);
  const futureVersion = encoded.replace('v2.', 'v3.');
  assert.equal(verify(token, futureVersion, sign(token, futureVersion)), null);
  const oversized = 'a'.repeat(9000);
  assert.equal(verify(token, oversized, sign(token, oversized)), null);
});

test('legacy signed target and baseline session remain valid only with active authorization', async () => {
  let hits = 0;
  const hooks = await fixture({ fetch: async () => { hits++; return new Response('segment-bytes'); } });
  const token = legacySession();
  const target = `${origin}/live/fixture-user/fixture-pass/legacy.ts`;
  const success = await dispatch(hooks, request(legacyUrl(token, target)));
  assert.equal(success.status, 200);
  assert.equal(success.bytes().toString(), 'segment-bytes');
  assert.equal(hits, 1);
  const expired = await dispatch(hooks, request(legacyUrl(legacySession(deviceId, Date.now() - 1), target)));
  assert.equal(expired.status, 401);
  assert.equal(hits, 1);
  const inactiveHooks = await fixture({ row: { device_id: deviceId, status: 'blocked', expires_at: null } });
  const blocked = await dispatch(inactiveHooks, request(legacyUrl(token, target)));
  assert.equal(blocked.status, 403);
  const invalid = legacyUrl(token, target).replace(/.$/, 'x');
  const invalidSignature = await dispatch(hooks, request(invalid));
  assert.equal(invalidSignature.status, 403);
});

test('legacy targets reject unsupported schemes and URL authority credentials', async () => {
  const hooks = await fixture();
  const token = legacySession();
  for (const target of ['file:///private', 'https://user:password@origin.example.test/path', 'not-a-url']) {
    const encoded = Buffer.from(target).toString('base64url');
    assert.equal(hooks.fn('verifiedTarget')(token, encoded, sign(token, encoded)), null);
  }
});

test('HLS relative segments, key/map URI attributes and redirects resolve into encrypted targets', async () => {
  const hooks = await fixture();
  const token = legacySession();
  const manifest = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\n../segment.ts\nhttps://cdn.example.test/other.ts\n';
  const rewritten = hooks.fn('rewriteHlsManifest')(request('/'), token, manifest, `${origin}/redirected/folder/index.m3u8`);
  const urls = [...rewritten.matchAll(/https:\/\/app\.example\.test[^"\s]+/g)].map((m) => m[0]);
  assert.equal(urls.length, 4);
  const decoded = urls.map((url) => {
    const parts = new URL(url).pathname.split('/');
    assert.ok(parts.at(-2).startsWith('v2.'));
    return hooks.fn('verifiedTarget')(token, parts.at(-2), parts.at(-1));
  });
  assert.deepEqual(decoded, [`${origin}/redirected/folder/key.bin`, `${origin}/redirected/folder/init.mp4`, `${origin}/redirected/segment.ts`, 'https://cdn.example.test/other.ts']);
});

test('binary byte ranges and HTTP 884 normalization retain their response contracts', async () => {
  const bytes = Buffer.from([0, 255, 10, 128, 42]);
  let seenHeaders;
  const hooks = await fixture({ fetch: async (_url, options) => {
    seenHeaders = options.headers;
    return new Response(bytes, { status: 206, headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 4-8/20', 'content-length': '5' } });
  } });
  const req = request(`${prefix}/live/${legacySession()}/blofy/1.ts`);
  req.headers.range = 'bytes=4-8';
  const res = await dispatch(hooks, req);
  assert.equal(res.status, 206);
  assert.equal(seenHeaders.range, 'bytes=4-8');
  assert.equal(res.headers['content-range'], 'bytes 4-8/20');
  assert.deepEqual(res.bytes(), bytes);
  const custom = await fixture({ fetch: async () => ({ status: 884, headers: new Headers({ 'content-type': 'video/mp2t' }), body: new Response(bytes).body }) });
  const normalized = await dispatch(custom, request(`${prefix}/live/${legacySession()}/blofy/1.ts`));
  assert.equal(normalized.status, 200);
  assert.equal(normalized.headers['x-blofy-upstream-status'], '884');
  assert.deepEqual(normalized.bytes(), bytes);
});

test('text streaming keeps Arabic bytes and origin replacement intact across chunk boundaries', async () => {
  const body = Buffer.from(`{"name":"قناة عربية 🌙","url":"${origin}/live/u/p/1.ts"}`);
  const hooks = await fixture({ fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: new ReadableStream({ start(controller) { for (const byte of body) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }) }) });
  const token = legacySession();
  const res = await dispatch(hooks, request(`${prefix}/player_api.php?username=${token}`));
  const parsed = JSON.parse(res.bytes().toString('utf8'));
  assert.equal(parsed.name, 'قناة عربية 🌙');
  assert.ok(parsed.url.startsWith(`https://app.example.test${prefix}/raw/${token}/`));
  assert.ok(!parsed.url.includes('origin.example.test'));
});

test('source, transform and downstream failures are handled without uncaught errors or duplicate responses', async () => {
  for (const failure of ['source', 'transform', 'downstream']) {
    const hooks = await fixture({
      fetch: async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: new ReadableStream({ start(controller) { if (failure === 'source') controller.error(new Error('fixture-upstream-reset')); else { controller.enqueue(Buffer.from('{}')); controller.close(); } } }) }),
      dependencies: failure === 'transform' ? { createLiteralByteReplace: () => new Transform({ transform(_chunk, _enc, next) { next(new Error('fixture-transform-error')); } }) } : {}
    });
    const res = response();
    if (failure === 'downstream') res._write = (_chunk, _enc, next) => next(new Error('fixture-downstream-error'));
    await dispatch(hooks, request(`${prefix}/player_api.php?username=${legacySession()}`), res);
    assert.equal(res.destroyed, true);
    assert.equal(res.headerWrites, 1);
    const health = await dispatch(hooks, request('/api/v1/subscribers/health'));
    assert.equal(health.status, 200);
    assert.equal(health.headerWrites, 1);
  }
});

test('client disconnect cancels upstream before headers and during HLS body reading', async () => {
  for (const stage of ['headers', 'manifest']) {
    let signal;
    let entered;
    const ready = new Promise((resolve) => { entered = resolve; });
    const pending = (value) => new Promise((_resolve, reject) => {
      value.addEventListener('abort', () => reject(new Error('fixture-disconnect')), { once: true });
      entered();
    });
    const hooks = await fixture({ fetch: async (_url, options) => {
      signal = options.signal;
      if (stage === 'headers') return pending(signal);
      return { status: 200, url: `${origin}/index.m3u8`, headers: new Headers({ 'content-type': 'application/vnd.apple.mpegurl' }), body: {}, text: () => pending(signal) };
    } });
    const res = response();
    const running = dispatch(hooks, request(`${prefix}/live/${legacySession()}/blofy/index.m3u8`), res);
    await ready;
    res.destroy();
    await running;
    assert.equal(signal.aborted, true);
    assert.equal(res.headerWrites, 0);
  }
});

test('client disconnect during binary playback cancels the upstream body', async () => {
  let cancelled = false;
  let signal;
  let wrote;
  const firstWrite = new Promise((resolve) => { wrote = resolve; });
  const hooks = await fixture({ fetch: async (_url, options) => {
    signal = options.signal;
    return { status: 200, headers: new Headers({ 'content-type': 'video/mp2t' }), body: new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(1, 2)); }, cancel() { cancelled = true; } }) };
  } });
  const res = response();
  res._write = (_chunk, _enc, next) => { wrote(); next(); };
  const running = dispatch(hooks, request(`${prefix}/live/${legacySession()}/blofy/1.ts`), res);
  await firstWrite;
  res.destroy();
  await running;
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, true);
  assert.equal(res.headerWrites, 1);
});

test('the 45-second timeout ends after upstream headers, without limiting total playback duration', async () => {
  const hooks = await fixture({ fetch: async () => ({ status: 200 }) });
  const timers = [];
  hooks.contexts[0].setTimeout = (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; };
  hooks.contexts[0].clearTimeout = (timer) => { timer.cleared = true; };
  const controller = new AbortController();
  await hooks.fn('fetchUpstream')(`${origin}/live`, request('/'), controller);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 45_000);
  assert.equal(timers[0].cleared, true);
  assert.equal(controller.signal.aborted, false);
});

test('health and rejected stream routes are handled once; malformed route prefixes get 404', async () => {
  const hooks = await fixture();
  for (const path of ['/api/v1/subscribers/health', `${prefix}/live/invalid/blofy/1.ts`, `${prefix}/raw/invalid/live`, `${prefix}/url/invalid/encoded/signature`]) {
    const res = await dispatch(hooks, request(path));
    assert.equal(res.headerWrites, 1);
    assert.equal(res.status, path.endsWith('/health') ? 200 : 401);
  }
  for (const path of [`${prefix}/url/bad`, `${prefix}/raw/`]) {
    const res = await dispatch(hooks, request(path));
    assert.equal(res.status, 404);
  }
});

test('subscriber session PIN guesses persist lockout and never reach the upstream provider', async () => {
  const id = 'BLOFY-PROXY-PIN';
  const row = { device_id: id, activation_code: codec.proof(id, '123456'), status: 'active', auth_failed_attempts: 0 };
  const hooks = await fixture({ row });
  const body = { deviceId: id, activationCode: '000000', username: 'fixture-user', password: 'fixture-pass' };
  for (let i = 0; i < 5; i++) assert.equal((await dispatch(hooks, request('/api/v1/subscribers/session', body))).status, 403);
  assert.equal(row.auth_failed_attempts, 5);
  assert.ok(row.auth_locked_until);
  assert.equal((await dispatch(hooks, request('/api/v1/subscribers/session', { ...body, activationCode: '123456' }))).status, 403);
});

test('subscriber session rate limits return 429 and provider-password failures do not consume PIN failure counts', async () => {
  const id = 'BLOFY-PROXY-RATE';
  const row = { device_id: id, activation_code: codec.proof(id, '123456'), status: 'active', auth_failed_attempts: 0 };
  const hooks = await fixture({ row, fetch: async () => new Response('{"user_info":{"auth":0}}', { headers: { 'content-type': 'application/json' } }) });
  const body = { deviceId: id, activationCode: '123456', username: 'fixture-user', password: 'wrong-provider-password' };
  for (let i = 0; i < 20; i++) assert.equal((await dispatch(hooks, request('/api/v1/subscribers/session', body))).status, 401);
  assert.equal(row.auth_failed_attempts, 0);
  const limited = await dispatch(hooks, request('/api/v1/subscribers/session', body));
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
});

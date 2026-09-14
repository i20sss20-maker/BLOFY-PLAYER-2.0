import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

// Never run fixture writes or proxy requests against production services.
function loopback(value, protocols, name) {
  assert.ok(value, `${name} must be explicitly configured`);
  const url = new URL(value);
  assert.ok(protocols.includes(url.protocol), `${name}: unsupported protocol`);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), `${name} must use loopback`);
  assert.equal(url.search, '', `${name}: query overrides are forbidden`);
  return url;
}
const service = loopback(process.env.BLOFY_E2E_BASE_URL, ['http:'], 'BLOFY_E2E_BASE_URL');
const provider = loopback(process.env.BLOFY_SUBSCRIBER_HOST, ['http:'], 'BLOFY_SUBSCRIBER_HOST');
const database = loopback(process.env.DATABASE_URL, ['postgres:', 'postgresql:'], 'DATABASE_URL');
assert.equal(process.env.PGSSLMODE, 'disable');
for (const url of [service, provider]) {
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.pathname, '/');
}
const key = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '');
assert.match(key, /^[a-fA-F0-9]{64}$/);
assert.equal(Number(process.env.BLOFY_SUBSCRIBER_DEVICE_CHECK_MS), 5000);
const pool = new pg.Pool({ connectionString: database.href, ssl: false });
const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
const username = `fixture-user-${suffix}-${'u'.repeat(96)}`;
const password = `fixture-password-${suffix}-${'p'.repeat(96)}`;
const identities = [];
const media = Buffer.from([0, 255, 1, 128, 71, 42, 0, 90]);
// The service socket is local; saved descriptors use the public host a TLS gateway supplies.
// This exercises portal validation without allowing loopback playlist destinations.
const sessionHeaders = { 'x-forwarded-host': 'subscriber-gateway.example.test', 'x-forwarded-proto': 'https' };
let providerRequests = 0;
let rangeSeen = null;
let breakStream;
let closeSlow;
const slowClosed = new Promise((resolve) => { closeSlow = resolve; });

const upstream = http.createServer((req, res) => {
  providerRequests += 1;
  const url = new URL(req.url, provider);
  if (url.pathname === '/player_api.php') {
    assert.equal(url.searchParams.get('username'), username);
    assert.equal(url.searchParams.get('password'), password);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    const value = url.searchParams.has('action')
      ? [{ name: 'قناة عربية وتجربة الحفظ', stream: `${provider.origin}/live/${username}/${password}/42.m3u8` }]
      : { user_info: { auth: 1, status: 'Active' } };
    const bytes = Buffer.from(JSON.stringify(value));
    // Deliberately split multibyte text and the private origin across writes.
    for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3));
    return res.end();
  }
  if (url.pathname === `/live/${username}/${password}/42.m3u8`) {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
    return res.end(`#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${provider.origin}/keys/${password}.key"\n#EXTINF:6,\n${provider.origin}/segments/${username}/${password}/part.ts?token=a%2Fb\n`);
  }
  if (url.pathname.startsWith('/segments/')) {
    assert.equal(url.search, '?token=a%2Fb');
    rangeSeen = req.headers.range || null;
    res.writeHead(rangeSeen ? 206 : 200, {
      'content-type': 'video/mp2t', 'content-length': media.length,
      ...(rangeSeen ? { 'content-range': 'bytes 0-7/8' } : {})
    });
    return res.end(media);
  }
  if (url.pathname.startsWith('/keys/')) {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(Buffer.alloc(16, 7));
  }
  if (url.pathname.endsWith('/884.ts')) {
    res.writeHead(884, { 'content-type': 'video/mp2t' });
    return res.end(media);
  }
  if (url.pathname.endsWith('/broken.ts')) {
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': 10000 });
    res.write(media);
    breakStream = () => res.socket?.destroy();
    return;
  }
  if (url.pathname.endsWith('/slow.ts')) {
    res.writeHead(200, { 'content-type': 'video/mp2t' });
    res.write(media);
    const timer = setInterval(() => res.write(media), 20);
    res.on('close', () => { clearInterval(timer); closeSlow(); });
    return;
  }
  res.writeHead(404);
  res.end();
});

async function call(path, { body, method = body === undefined ? 'GET' : 'POST', headers = {}, ...options } = {}) {
  return fetch(new URL(path, service), {
    method, redirect: 'error',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.73', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), ...options,
    signal: AbortSignal.any([AbortSignal.timeout(10000), ...(options.signal ? [options.signal] : [])])
  });
}
async function json(path, options, status = 200) {
  const response = await call(path, options);
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value));
  return value;
}
async function device() {
  const value = { deviceId: `BLOFY-PROXY-${suffix}-${identities.length}`, activationCode: '123456' };
  identities.push(value.deviceId);
  await pool.query(`INSERT INTO devices(device_id,activation_code,status,expires_at)
    VALUES($1,$2,'active',NOW()+INTERVAL '30 days')`, [value.deviceId, value.activationCode]);
  return value;
}
function sessionBody(identity) { return { ...identity, username, password }; }
function legacyTarget(token, target) {
  const encoded = Buffer.from(target).toString('base64url');
  const signature = crypto.createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`${token}\n${encoded}`).digest('base64url');
  return `/api/v1/subscribers/xtream/url/${token}/${encoded}/${signature}`;
}

try {
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(Number(provider.port || 80), provider.hostname, resolve);
  });
  assert.equal((await json('/api/v1/subscribers/health')).ok, true);
  const identity = await device();
  const session = await json('/api/v1/subscribers/session', { body: sessionBody(identity), headers: sessionHeaders });
  const token = session.username;
  assert.equal(session.password, 'blofy');
  assert.ok(token.length > 256, 'exercise saved subscriber envelopes beyond the old truncation limit');
  const saved = await json('/api/v1/portal/playlists', { body: { ...identity, id: session.providerId,
    name: 'Managed fixture', providerType: 'xtream', baseUrl: session.baseUrl, username: token, password: 'blofy', active: true } });
  const listed = await json('/api/v1/portal/playlists/list', { body: identity });
  const item = listed.items.find(row => row.id === saved.id);
  assert.equal(item.username, token, 'portal must retain the entire encrypted envelope');
  assert.equal(item.baseUrl, session.baseUrl);
  const resolved = await json('/api/v1/subscribers/resolve', { body: { ...identity, sessionTokens: [item.username] } });
  assert.equal(resolved.items[0].delivery, 'direct');
  assert.equal(resolved.items[0].baseUrl, provider.origin);
  assert.equal(resolved.items[0].username, username);
  assert.equal(resolved.items[0].password, password);
  const directSession = await json('/api/v1/subscribers/session', { body: { ...sessionBody(identity), delivery: 'direct' }, headers: sessionHeaders });
  assert.equal(directSession.providerId, saved.id, 'changing delivery must not duplicate the saved account');
  assert.equal(directSession.baseUrl, provider.origin);
  const directPlayback = await fetch(`${directSession.baseUrl}/live/${encodeURIComponent(directSession.username)}/${encodeURIComponent(directSession.password)}/42.m3u8`);
  assert.equal(directPlayback.status, 200);
  assert.ok((await directPlayback.text()).startsWith('#EXTM3U'));
  const streams = await json(`/api/v1/subscribers/xtream/player_api.php?username=${token}&password=blofy&action=get_live_streams`);
  assert.equal(streams[0].name, 'قناة عربية وتجربة الحفظ');
  assert.ok(!JSON.stringify(streams).includes(provider.origin));
  assert.ok(streams[0].stream.startsWith(`${service.origin}/api/v1/subscribers/xtream/raw/`));

  const manifestResponse = await call(`/api/v1/subscribers/xtream/live/${token}/blofy/42.m3u8`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.text();
  for (const secret of [provider.origin, username, password]) assert.ok(!manifest.includes(secret));
  const targetUrls = [manifest.match(/URI="([^"]+)"/)[1], manifest.split('\n').find((line) => line.startsWith('http'))];
  for (const target of targetUrls) {
    const url = new URL(target);
    assert.equal(url.origin, service.origin);
    // Inspect all URL pieces: no base64-encoded plaintext host/credentials may remain.
    for (const part of url.pathname.split('/')) {
      const decoded = Buffer.from(part, 'base64url').toString('utf8');
      for (const secret of [provider.origin, username, password]) assert.ok(!decoded.includes(secret));
    }
  }
  const keyResponse = await call(targetUrls[0]);
  assert.equal(keyResponse.status, 200);
  assert.deepEqual(Buffer.from(await keyResponse.arrayBuffer()), Buffer.alloc(16, 7));
  const segment = await call(targetUrls[1], { headers: { range: 'bytes=0-7' } });
  assert.equal(segment.status, 206);
  assert.equal(segment.headers.get('content-range'), 'bytes 0-7/8');
  assert.equal(rangeSeen, 'bytes=0-7');
  assert.deepEqual(Buffer.from(await segment.arrayBuffer()), media);
  const nonstandard = await call(`/api/v1/subscribers/xtream/live/${token}/blofy/884.ts`);
  assert.equal(nonstandard.status, 200);
  assert.equal(nonstandard.headers.get('x-blofy-upstream-status'), '884');
  assert.deepEqual(Buffer.from(await nonstandard.arrayBuffer()), media);

  // Already-issued, signed manifest targets continue to work for valid sessions.
  const legacy = await call(legacyTarget(token, `${provider.origin}/segments/${username}/${password}/part.ts?token=a%2Fb`));
  assert.equal(legacy.status, 200);
  assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), media);
  const badSignature = new URL(targetUrls[1]);
  badSignature.pathname += 'x';
  const beforeTamper = providerRequests;
  await json(badSignature.href, {}, 403);
  assert.equal(providerRequests, beforeTamper);

  // A failed upstream body ends one response, not the service process.
  const broken = await call(`/api/v1/subscribers/xtream/live/${token}/blofy/broken.ts`);
  assert.equal(broken.status, 200);
  breakStream();
  await assert.rejects(() => broken.arrayBuffer(), (error) =>
    !['TimeoutError', 'AbortError'].includes(error.name));
  assert.equal((await json('/health')).ok, true);
  const controller = new AbortController();
  const slow = await call(`/api/v1/subscribers/xtream/live/${token}/blofy/slow.ts`, { signal: controller.signal });
  const reader = slow.body.getReader();
  assert.ok((await reader.read()).value.length > 0);
  controller.abort();
  await reader.cancel().catch(() => {});
  await Promise.race([slowClosed, delay(2500).then(() => { throw new Error('Client disconnect did not close provider stream'); })]);
  assert.equal((await json('/api/v1/subscribers/health')).ok, true);

  // Subscriber session attempts participate in the same persisted cross-route budget.
  const locked = await device();
  for (let i = 0; i < 5; i += 1) {
    const body = { ...sessionBody(locked), activationCode: '000000' };
    await json(i % 2 ? '/api/v1/subscriptions/status' : '/api/v1/subscribers/session', { body }, 403);
    const row = (await pool.query('SELECT auth_failed_attempts FROM devices WHERE device_id=$1', [locked.deviceId])).rows[0];
    assert.equal(row.auth_failed_attempts, i + 1);
    if (i < 4) await json('/api/v1/subscriptions/status', { body: locked });
  }
  const beforeLocked = providerRequests;
  await json('/api/v1/subscribers/session', { body: sessionBody(locked) }, 403);
  assert.equal(providerRequests, beforeLocked);

  // Cached active sessions must stop proxying after the configured device recheck.
  await pool.query("UPDATE devices SET status='blocked' WHERE device_id=$1", [identity.deviceId]);
  await delay(5100);
  const beforeInactive = providerRequests;
  await json(targetUrls[1], {}, 403);
  await json(legacyTarget(token, `${provider.origin}/segments/${username}/${password}/part.ts?token=a%2Fb`), {}, 403);
  assert.equal(providerRequests, beforeInactive);
  assert.equal((await json('/health')).ok, true);
  console.log('BLOFY subscriber proxy E2E passed: encrypted HLS/key/segment URLs, legacy sessions, Arabic bytes, Range/binary integrity, stream failures/disconnects, shared PIN lockout and device recheck');
} finally {
  upstream.closeAllConnections();
  if (upstream.listening) await new Promise((resolve) => upstream.close(resolve));
  try { await pool.query('DELETE FROM devices WHERE device_id=ANY($1::text[])', [identities]); }
  finally { await pool.end(); }
}

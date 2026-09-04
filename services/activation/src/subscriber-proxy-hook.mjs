import http from 'node:http';
import crypto from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import pg from 'pg';
import { createActivationCredentialCodec, isAuthLocked } from './auth-protection.mjs';

const { Pool } = pg;
const SUBSCRIBER_HOST_RAW = String(process.env.BLOFY_SUBSCRIBER_HOST || '').trim();
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PLAYLIST_ENCRYPTION_KEY = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const SESSION_TTL_MS = Number(process.env.BLOFY_SUBSCRIBER_SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const MAX_LOGIN_USERNAME = 256;
const MAX_LOGIN_PASSWORD = 512;
const SUBSCRIBER_PREFIX = '/api/v1/subscribers';
const XTREAM_PREFIX = `${SUBSCRIBER_PREFIX}/xtream`;

const subscriberHost = normalizeSubscriberHost(SUBSCRIBER_HOST_RAW);
const encryptionKey = /^[a-fA-F0-9]{64}$/.test(PLAYLIST_ENCRYPTION_KEY)
  ? Buffer.from(PLAYLIST_ENCRYPTION_KEY, 'hex')
  : null;
const activationCredentials = encryptionKey ? createActivationCredentialCodec(PLAYLIST_ENCRYPTION_KEY) : null;
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
    })
  : null;

function normalizeSubscriberHost(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function available() {
  return Boolean(subscriberHost && encryptionKey && activationCredentials && pool);
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers
  });
  res.end(payload);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new Error('payload_too_large');
  }
  return body ? JSON.parse(body) : {};
}

function validIdentity(deviceId, activationCode) {
  return /^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) && /^\d{6}$/.test(activationCode);
}

function normalizeDeviceStatus(row) {
  const expiresAt = row?.expires_at ? new Date(row.expires_at).getTime() : null;
  if ((row?.status === 'trial' || row?.status === 'active') && expiresAt && expiresAt <= Date.now()) return 'expired';
  return row?.status;
}

async function authorizedDevice(deviceId, activationCode) {
  if (!available() || !validIdentity(deviceId, activationCode)) return false;
  const result = await pool.query(
    'SELECT device_id,activation_code,status,expires_at,auth_locked_until FROM devices WHERE device_id=$1 LIMIT 1',
    [deviceId]
  );
  const row = result.rows[0];
  if (!row || isAuthLocked(row) || !activationCredentials.matches(row, activationCode)) return false;
  return ['trial', 'active'].includes(normalizeDeviceStatus(row));
}

function sealSession(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

function openSession(token) {
  try {
    const packed = Buffer.from(String(token || ''), 'base64url');
    if (packed.length < 29) return null;
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const payload = JSON.parse(plaintext);
    if (!payload || typeof payload.u !== 'string' || typeof payload.p !== 'string') return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requestOrigin(req) {
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = protoHeader === 'https' ? 'https' : req.socket?.encrypted ? 'https' : 'http';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

function upstreamUrl(pathname, search = '') {
  return `${subscriberHost}${pathname.startsWith('/') ? '' : '/'}${pathname}${search || ''}`;
}

function proxyBase(req, token) {
  return `${requestOrigin(req)}${XTREAM_PREFIX}/raw/${encodeURIComponent(token)}`;
}

function replacePrivateOriginStream(req, token) {
  const needle = subscriberHost;
  const replacement = proxyBase(req, token);
  let tail = '';
  const keep = Math.max(0, needle.length - 1);
  return new Transform({
    transform(chunk, _encoding, callback) {
      const text = tail + chunk.toString('utf8');
      const safeEnd = Math.max(0, text.length - keep);
      const emit = text.slice(0, safeEnd).split(needle).join(replacement);
      tail = text.slice(safeEnd);
      callback(null, emit);
    },
    flush(callback) {
      callback(null, tail.split(needle).join(replacement));
    }
  });
}

function copyUpstreamHeaders(upstream, res, { textual = false } = {}) {
  const headers = {};
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (['connection', 'transfer-encoding', 'content-security-policy', 'location'].includes(lower)) continue;
    if (textual && ['content-length', 'content-encoding'].includes(lower)) continue;
    headers[lower] = value;
  }
  headers['cache-control'] = 'no-store';
  res.writeHead(upstream.status, headers);
}

async function fetchUpstream(url, req) {
  const headers = {};
  for (const name of ['range', 'accept', 'accept-language', 'user-agent', 'if-none-match', 'if-modified-since']) {
    const value = req.headers[name];
    if (value) headers[name] = value;
  }
  return fetch(url, {
    method: 'GET',
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000)
  });
}

async function pipeUpstream(req, res, url, token) {
  const upstream = await fetchUpstream(url, req);
  const type = String(upstream.headers.get('content-type') || '').toLowerCase();
  const isHls = type.includes('mpegurl') || url.toLowerCase().includes('.m3u8');
  const isTextual = isHls || type.includes('json') || type.startsWith('text/');

  if (!upstream.body) {
    copyUpstreamHeaders(upstream, res, { textual: isTextual });
    return res.end();
  }

  if (isHls) {
    const text = await upstream.text();
    const rewritten = text.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line.split(subscriberHost).join(proxyBase(req, token));
      try {
        const absolute = new URL(trimmed, url);
        if (absolute.href.startsWith(subscriberHost)) {
          return `${proxyBase(req, token)}${absolute.pathname}${absolute.search}`;
        }
      } catch {}
      return line.split(subscriberHost).join(proxyBase(req, token));
    }).join('\n');
    const headers = {};
    for (const [key, value] of upstream.headers.entries()) {
      const lower = key.toLowerCase();
      if (!['content-length', 'content-encoding', 'connection', 'transfer-encoding', 'location'].includes(lower)) headers[lower] = value;
    }
    headers['content-length'] = Buffer.byteLength(rewritten);
    headers['cache-control'] = 'no-store';
    res.writeHead(upstream.status, headers);
    return res.end(rewritten);
  }

  copyUpstreamHeaders(upstream, res, { textual: isTextual });
  const readable = Readable.fromWeb(upstream.body);
  if (isTextual) readable.pipe(replacePrivateOriginStream(req, token)).pipe(res);
  else readable.pipe(res);
}

async function createSubscriberSession(req, res) {
  if (!available()) return sendJson(res, 503, { error: 'subscriber_service_unavailable' });
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password || username.length > MAX_LOGIN_USERNAME || password.length > MAX_LOGIN_PASSWORD) {
    return sendJson(res, 400, { error: 'invalid_subscriber_credentials' });
  }
  if (!await authorizedDevice(deviceId, activationCode)) {
    return sendJson(res, 403, { error: 'unauthorized_device' });
  }

  const authUrl = new URL(`${subscriberHost}/player_api.php`);
  authUrl.searchParams.set('username', username);
  authUrl.searchParams.set('password', password);
  let upstream;
  try {
    upstream = await fetch(authUrl, { redirect: 'follow', signal: AbortSignal.timeout(12_000) });
  } catch {
    return sendJson(res, 502, { error: 'subscriber_upstream_unavailable' });
  }
  if (!upstream.ok) return sendJson(res, 401, { error: 'subscriber_login_failed' });
  let authPayload;
  try { authPayload = await upstream.json(); } catch { return sendJson(res, 401, { error: 'subscriber_login_failed' }); }
  const authFlag = authPayload?.user_info?.auth;
  if (!(authFlag === 1 || authFlag === '1' || authPayload?.user_info?.status === 'Active')) {
    return sendJson(res, 401, { error: 'subscriber_login_failed' });
  }

  const token = sealSession({
    u: username,
    p: password,
    d: deviceId,
    exp: Date.now() + Math.max(60 * 60 * 1000, Math.min(SESSION_TTL_MS, 90 * 24 * 60 * 60 * 1000))
  });
  return sendJson(res, 200, {
    providerName: 'مشتركين BLOFY',
    providerType: 'xtream',
    baseUrl: `${requestOrigin(req)}${XTREAM_PREFIX}`,
    username: token,
    password: 'blofy',
    expiresAt: Date.now() + Math.max(60 * 60 * 1000, Math.min(SESSION_TTL_MS, 90 * 24 * 60 * 60 * 1000))
  });
}

async function proxyPlayerApi(req, res, requestUrl) {
  const token = requestUrl.searchParams.get('username') || '';
  const session = openSession(token);
  if (!session) return sendJson(res, 401, { error: 'subscriber_session_expired' });
  const upstream = new URL(`${subscriberHost}/player_api.php`);
  upstream.searchParams.set('username', session.u);
  upstream.searchParams.set('password', session.p);
  for (const [key, value] of requestUrl.searchParams.entries()) {
    if (key === 'username' || key === 'password') continue;
    upstream.searchParams.append(key, value);
  }
  return pipeUpstream(req, res, upstream.toString(), token);
}

async function proxyStream(req, res, requestUrl) {
  const match = requestUrl.pathname.match(new RegExp(`^${XTREAM_PREFIX}/(live|movie|series)/([^/]+)/[^/]+/(.+)$`));
  if (!match) return false;
  const [, kind, encodedToken, tail] = match;
  const token = decodeURIComponent(encodedToken);
  const session = openSession(token);
  if (!session) return sendJson(res, 401, { error: 'subscriber_session_expired' });
  const target = `${subscriberHost}/${kind}/${encodeURIComponent(session.u)}/${encodeURIComponent(session.p)}/${tail}${requestUrl.search}`;
  await pipeUpstream(req, res, target, token);
  return true;
}

async function proxyRaw(req, res, requestUrl) {
  const match = requestUrl.pathname.match(new RegExp(`^${XTREAM_PREFIX}/raw/([^/]+)(/.*)?$`));
  if (!match) return false;
  const token = decodeURIComponent(match[1]);
  const session = openSession(token);
  if (!session) return sendJson(res, 401, { error: 'subscriber_session_expired' });
  const path = match[2] || '/';
  await pipeUpstream(req, res, upstreamUrl(path, requestUrl.search), token);
  return true;
}

async function handleSubscriberRequest(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && requestUrl.pathname === `${SUBSCRIBER_PREFIX}/health`) {
    return sendJson(res, available() ? 200 : 503, {
      ok: available(),
      hostConfigured: Boolean(subscriberHost),
      encryptionReady: Boolean(encryptionKey && activationCredentials),
      databaseReady: Boolean(pool)
    });
  }
  if (req.method === 'POST' && requestUrl.pathname === `${SUBSCRIBER_PREFIX}/session`) {
    await createSubscriberSession(req, res);
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname === `${XTREAM_PREFIX}/player_api.php`) {
    await proxyPlayerApi(req, res, requestUrl);
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname.startsWith(`${XTREAM_PREFIX}/raw/`)) {
    await proxyRaw(req, res, requestUrl);
    return true;
  }
  if (req.method === 'GET' && requestUrl.pathname.startsWith(`${XTREAM_PREFIX}/`)) {
    const handled = await proxyStream(req, res, requestUrl);
    if (handled) return true;
  }
  return false;
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(listener) {
  if (typeof listener !== 'function') return originalCreateServer(listener);
  return originalCreateServer(async (req, res) => {
    try {
      if (String(req.url || '').startsWith(SUBSCRIBER_PREFIX) && await handleSubscriberRequest(req, res)) return;
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'subscriber_proxy_error' });
      else res.destroy();
      return;
    }
    return listener(req, res);
  });
};
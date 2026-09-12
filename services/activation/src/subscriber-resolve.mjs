import crypto from 'node:crypto';
import {
  createActivationCredentialCodec, createFixedWindowLimiter, isAuthLocked,
  nextAuthFailureState, requestClientKey
} from './auth-protection.mjs';

export const SUBSCRIBER_RESOLVE_PATH = '/api/v1/subscribers/resolve';
const MAX_BODY_BYTES = 100_000;
const validDevice = value => typeof value === 'string' && /^BLOFY-[A-Z0-9-]{4,32}$/i.test(value);
const validToken = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && /^[A-Za-z0-9_-]+$/.test(value);

function configuredHost(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.search = ''; url.hash = '';
    return url.href.replace(/\/+$/, '');
  } catch { return null; }
}

/** Decode the existing AES-GCM envelope only after device/PIN authentication.
 * Expiry here is not a streaming authorization: the same authenticated device can recover
 * its saved credentials, as required by the released Android client. Legacy playback
 * endpoints are untouched and keep their own expiry checks. Never decode an unsigned token.
 */
export function resolveEnvelope(token, deviceId, key) {
  if (!validToken(token) || !validDevice(deviceId) || !Buffer.isBuffer(key) || key.length !== 32) return null;
  try {
    const packed = Buffer.from(token, 'base64url');
    if (packed.length < 29 || packed.toString('base64url') !== token) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8'));
    if (!session || session.d !== deviceId || !Number.isFinite(session.exp) || session.exp <= 0 ||
        typeof session.u !== 'string' || !session.u.trim() || session.u.length > 256 ||
        typeof session.p !== 'string' || !session.p || session.p.length > 512) return null;
    return session;
  } catch { return null; }
}

function send(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store, private', 'pragma': 'no-cache',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('invalid_json'), { status: 400 });
  return body;
}

export function createSubscriberResolveHandler({ pool, keyHex, subscriberHost,
  now = Date.now, report = () => {} }) {
  const key = /^[a-f0-9]{64}$/i.test(String(keyHex || '')) ? Buffer.from(keyHex, 'hex') : null;
  const codec = key ? createActivationCredentialCodec(keyHex) : null;
  const host = configuredHost(subscriberHost);
  const ipLimiter = createFixedWindowLimiter({ limit: 60, windowMs: 60_000 });
  const deviceLimiter = createFixedWindowLimiter({ limit: 20, windowMs: 60_000 });

  async function authenticate(deviceId, activationCode) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId])).rows[0];
      if (!row || isAuthLocked(row, now())) { await client.query('COMMIT'); return false; }
      if (!codec.matches(row, activationCode)) {
        const state = nextAuthFailureState(row, now());
        await client.query(`UPDATE devices SET auth_failed_attempts=$2,last_auth_failure_at=$3,
          auth_locked_until=$4,updated_at=NOW() WHERE device_id=$1`,
          [deviceId, state.failedAttempts, state.lastFailureAt, state.lockedUntil]);
        await client.query('COMMIT'); return false;
      }
      const expiry = row.expires_at == null ? null : new Date(row.expires_at).getTime();
      const allowed = ['trial', 'active'].includes(row.status) &&
        (expiry === null || Number.isFinite(expiry) && expiry > now());
      await client.query('COMMIT');
      return allowed;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {}); throw error;
    } finally { client.release(); }
  }

  return async function handle(req, res) {
    let path; try { path = new URL(req.url || '/', 'http://localhost').pathname; } catch { return false; }
    if (path !== SUBSCRIBER_RESOLVE_PATH) return false;
    if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }, { allow: 'POST' }); return true; }
    if (!pool || !key || !host) { send(res, 503, { error: 'subscriber_service_unavailable' }); return true; }
    const ip = ipLimiter.consume(requestClientKey(req), now());
    if (!ip.allowed) { send(res, 429, { error: 'rate_limited' }, { 'retry-after': String(ip.retryAfterSeconds) }); return true; }
    try {
      if (!/^application\/json(?:\s*;|\s*$)/i.test(String(req.headers['content-type'] || ''))) {
        send(res, 415, { error: 'json_required' }); return true;
      }
      const body = await readBody(req);
      const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
      const pin = typeof body.activationCode === 'string' ? body.activationCode.trim() : '';
      const tokens = body.sessionTokens;
      if (!validDevice(deviceId) || !/^\d{6}$/.test(pin)) { send(res, 403, { error: 'unauthorized_device' }); return true; }
      if (!Array.isArray(tokens) || !tokens.length || tokens.length > 20 || !tokens.every(validToken)) {
        send(res, 400, { error: 'invalid_subscriber_sessions' }); return true;
      }
      const rate = deviceLimiter.consume(deviceId.toUpperCase(), now());
      if (!rate.allowed) { send(res, 429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfterSeconds) }); return true; }
      if (!await authenticate(deviceId, pin)) { send(res, 403, { error: 'unauthorized_device' }); return true; }
      const items = [...new Set(tokens)].map(sessionToken => {
        const session = resolveEnvelope(sessionToken, deviceId, key);
        return session ? { delivery: 'direct', providerName: 'مشتركين BLOFY', providerType: 'xtream',
          baseUrl: host, username: session.u, password: session.p, sessionToken, expiresAt: session.exp }
          : { sessionToken, error: 'invalid_subscriber_session' };
      });
      send(res, 200, { items });
    } catch (error) {
      // Deliberately exclude exception messages: database URLs, PINs and envelope contents are secrets.
      const status = [400, 413].includes(error?.status) ? error.status : 503;
      if (status === 503) report('subscriber_resolve_unavailable');
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        send(res, status, { error: status === 413 ? 'payload_too_large' : status === 400 ? 'invalid_json' : 'subscriber_service_unavailable' });
      }
    }
    return true;
  };
}

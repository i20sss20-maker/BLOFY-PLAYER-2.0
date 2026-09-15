import http from 'node:http';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import {
  createActivationCredentialCodec,
  createFixedWindowLimiter,
  isAuthLocked,
  nextAuthFailureState,
  requestClientKey
} from './auth-protection.mjs';
import { injectPortalContactUi, maskPortalPhone, normalizePortalPhone } from './portal-contact-core.mjs';

const PORTAL_PATHS = new Set(['/', '/portal', '/connect']);
const STATUS_PATH = '/api/v1/portal/contact/status';
const SAVE_PATH = '/api/v1/portal/contact';
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const KEY_HEX = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const AUTH_MAX_FAILURES = Number(process.env.BLOFY_AUTH_MAX_FAILURES || 5);
const AUTH_FAILURE_WINDOW_MS = Number(process.env.BLOFY_AUTH_FAILURE_WINDOW_MS || 900_000);
const AUTH_LOCK_MS = Number(process.env.BLOFY_AUTH_LOCK_MS || 900_000);
const limiter = createFixedWindowLimiter({ limit: 20, windowMs: 60_000 });
let pool;
let codec;
let schemaReady;

function database() {
  if (!DATABASE_URL) throw new Error('contact_database_unavailable');
  if (!pool) {
    pool = new pg.Pool({ ...databaseOptions(DATABASE_URL), max: 2, connectionTimeoutMillis: 4000, idleTimeoutMillis: 10000, statement_timeout: 10000 });
    pool.on('error', () => console.error('portal contact database error'));
  }
  return pool;
}

function credentials() {
  if (!/^[a-fA-F0-9]{64}$/.test(KEY_HEX)) throw new Error('contact_credentials_unavailable');
  if (!codec) codec = createActivationCredentialCodec(KEY_HEX);
  return codec;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 16_384) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function normalizedStatus(row) {
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if (['active', 'trial'].includes(row.status) && expiresAt && expiresAt <= Date.now()) return 'expired';
  return row.status;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = database();
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(718420683)');
        await client.query(`CREATE TABLE IF NOT EXISTS device_customers (
          device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
          customer_name TEXT,
          customer_email TEXT,
          customer_phone TEXT,
          source TEXT NOT NULL DEFAULT 'portal',
          last_order_reference TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    })().catch(error => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

async function authorize(req, body) {
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const rate = limiter.consume(requestClientKey(req) + ':' + deviceId.toUpperCase());
  if (!rate.allowed) throw Object.assign(new Error('rate_limited'), { status: 429, retryAfterSeconds: rate.retryAfterSeconds });
  if (!/^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) || !/^\d{6}$/.test(activationCode)) return null;

  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT device_id,activation_code,status,expires_at,auth_locked_until,
      auth_failed_attempts,last_auth_failure_at FROM devices WHERE device_id=$1 FOR UPDATE`, [deviceId]);
    const row = result.rows[0];
    if (!row || isAuthLocked(row)) {
      await client.query('COMMIT');
      return null;
    }
    const auth = credentials();
    if (!auth.matches(row, activationCode)) {
      const state = nextAuthFailureState(row, Date.now(), {
        maxFailures: AUTH_MAX_FAILURES,
        failureWindowMs: AUTH_FAILURE_WINDOW_MS,
        lockMs: AUTH_LOCK_MS
      });
      await client.query(`UPDATE devices SET auth_failed_attempts=$2,last_auth_failure_at=$3,
        auth_locked_until=$4,updated_at=NOW() WHERE device_id=$1`,
        [deviceId, state.failedAttempts, state.lastFailureAt, state.lockedUntil]);
      await client.query('COMMIT');
      return null;
    }
    if (!auth.isProof(row.activation_code)) {
      await client.query('UPDATE devices SET activation_code=$2,updated_at=NOW() WHERE device_id=$1',
        [deviceId, auth.proof(deviceId, activationCode)]);
    }
    await client.query('COMMIT');
    return ['active', 'trial'].includes(normalizedStatus(row)) ? { deviceId: row.device_id } : null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function handleContactApi(req, res, pathname) {
  if (req.method !== 'POST' || ![STATUS_PATH, SAVE_PATH].includes(pathname)) return false;
  try {
    const body = await readJson(req);
    const authorized = await authorize(req, body);
    if (!authorized) { json(res, 403, { error: 'unauthorized_device' }); return true; }
    await ensureSchema();
    if (pathname === STATUS_PATH) {
      const row = (await database().query('SELECT customer_phone FROM device_customers WHERE device_id=$1', [authorized.deviceId])).rows[0];
      const phone = normalizePortalPhone(row?.customer_phone || '');
      json(res, 200, { hasPhone: Boolean(phone), maskedPhone: phone ? maskPortalPhone(phone) : '' });
      return true;
    }
    const phone = normalizePortalPhone(body.phone);
    if (!phone) { json(res, 400, { error: 'invalid_phone' }); return true; }
    await database().query(`INSERT INTO device_customers(device_id,customer_phone,source)
      VALUES($1,$2,'portal')
      ON CONFLICT(device_id) DO UPDATE SET customer_phone=EXCLUDED.customer_phone,updated_at=NOW()`, [authorized.deviceId, phone]);
    json(res, 200, { ok: true, maskedPhone: maskPortalPhone(phone) });
    return true;
  } catch (error) {
    const status = Number(error?.status) || 503;
    const headers = status === 429 && error.retryAfterSeconds ? { 'retry-after': String(error.retryAfterSeconds) } : null;
    if (headers) {
      const payload = JSON.stringify({ error: 'rate_limited' });
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...headers });
      res.end(payload);
    } else json(res, [400, 413].includes(status) ? status : 503, { error: status === 413 ? 'payload_too_large' : status === 400 ? 'invalid_json' : 'contact_unavailable' });
    return true;
  }
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withPortalContact(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) {}
    if (await handleContactApi(req, res, pathname)) return;
    if (req.method !== 'GET' || !PORTAL_PATHS.has(pathname)) return listener(req, res);

    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    let statusCode = 200;
    let statusMessage;
    let headers = {};
    let wroteHead = false;

    res.writeHead = function interceptedWriteHead(code, messageOrHeaders, maybeHeaders) {
      statusCode = code;
      if (typeof messageOrHeaders === 'string') {
        statusMessage = messageOrHeaders;
        headers = { ...(maybeHeaders || {}) };
      } else headers = { ...(messageOrHeaders || {}) };
      wroteHead = true;
      return res;
    };

    res.end = function interceptedEnd(chunk, encoding, callback) {
      if (typeof chunk === 'function') { callback = chunk; chunk = undefined; }
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      const body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      const modified = injectPortalContactUi(body);
      res.writeHead = originalWriteHead;
      if (!wroteHead) { statusCode = res.statusCode; statusMessage = res.statusMessage; }
      res.removeHeader('content-length');
      res.removeHeader('transfer-encoding');
      for (const key of Object.keys(headers)) if (['content-length', 'transfer-encoding'].includes(key.toLowerCase())) delete headers[key];
      headers['content-length'] = Buffer.byteLength(modified);
      if (statusMessage) originalWriteHead(statusCode, statusMessage, headers);
      else originalWriteHead(statusCode, headers);
      return originalEnd(modified, 'utf8', callback);
    };

    return listener(req, res);
  });
};

import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createPortalHandlers } from './portal.mjs';
import {
  createActivationCredentialCodec,
  createFixedWindowLimiter,
  isAuthLocked,
  nextAuthFailureState,
  requestClientKey
} from './auth-protection.mjs';
import {
  pseudonymizeDiagnosticProviderKey,
  safeErrorSummary,
  sanitizeDiagnosticAppVersion,
  sanitizeDiagnosticContentKind,
  sanitizeDiagnosticErrorCode,
  sanitizeDiagnosticMessage,
  sanitizeDiagnosticUrl
} from './diagnostics-sanitizer.mjs';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || '';
const ADMIN_TOKEN = process.env.BLOFY_ADMIN_TOKEN || '';
const TRIAL_DAYS = Number(process.env.BLOFY_TRIAL_DAYS || 7);
const PLAYLIST_ENCRYPTION_KEY = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const AUTH_RATE_WINDOW_MS = Number(process.env.BLOFY_AUTH_RATE_WINDOW_MS || 60_000);
const AUTH_IP_RATE_LIMIT = Number(process.env.BLOFY_AUTH_IP_RATE_LIMIT || 60);
const AUTH_DEVICE_RATE_LIMIT = Number(process.env.BLOFY_AUTH_DEVICE_RATE_LIMIT || 20);
const AUTH_MAX_FAILURES = Number(process.env.BLOFY_AUTH_MAX_FAILURES || 5);
const AUTH_FAILURE_WINDOW_MS = Number(process.env.BLOFY_AUTH_FAILURE_WINDOW_MS || 900_000);
const AUTH_LOCK_MS = Number(process.env.BLOFY_AUTH_LOCK_MS || 900_000);

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 24) throw new Error('BLOFY_ADMIN_TOKEN must be at least 24 characters');
if (!/^[a-fA-F0-9]{64}$/.test(PLAYLIST_ENCRYPTION_KEY)) {
  throw new Error('BLOFY_PLAYLIST_ENCRYPTION_KEY must be exactly 64 hexadecimal characters');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

const authIpLimiter = createFixedWindowLimiter({ limit: AUTH_IP_RATE_LIMIT, windowMs: AUTH_RATE_WINDOW_MS });
const authDeviceLimiter = createFixedWindowLimiter({ limit: AUTH_DEVICE_RATE_LIMIT, windowMs: AUTH_RATE_WINDOW_MS });
const adminIpLimiter = createFixedWindowLimiter({ limit: 30, windowMs: AUTH_RATE_WINDOW_MS });
const activationCredentials = createActivationCredentialCodec(PLAYLIST_ENCRYPTION_KEY);

class RateLimitError extends Error {
  constructor(retryAfterSeconds) {
    super('rate_limited');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  res.end(payload);
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 32_768) throw new Error('payload_too_large');
  }
  return body ? JSON.parse(body) : {};
}

function normalizeStatus(row) {
  const now = Date.now();
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  if ((row.status === 'trial' || row.status === 'active') && expiresAt && expiresAt <= now) return 'expired';
  return row.status;
}

function validIdentity(deviceId, activationCode) {
  return /^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) && /^\d{6}$/.test(activationCode);
}

function validProviderKey(providerKey) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(providerKey);
}

function consumeDeviceAuthAttempt(req, deviceId) {
  const ipResult = authIpLimiter.consume(requestClientKey(req));
  const deviceResult = authDeviceLimiter.consume(String(deviceId || 'invalid').toUpperCase());
  if (!ipResult.allowed || !deviceResult.allowed) {
    throw new RateLimitError(Math.max(ipResult.retryAfterSeconds, deviceResult.retryAfterSeconds));
  }
}

async function recordAuthFailure(client, row) {
  const state = nextAuthFailureState(row, Date.now(), {
    maxFailures: AUTH_MAX_FAILURES,
    failureWindowMs: AUTH_FAILURE_WINDOW_MS,
    lockMs: AUTH_LOCK_MS
  });
  await client.query(
    `UPDATE devices
     SET auth_failed_attempts=$2,last_auth_failure_at=$3,auth_locked_until=$4,updated_at=NOW()
     WHERE device_id=$1`,
    [row.device_id, state.failedAttempts, state.lastFailureAt, state.lockedUntil]
  );
}

async function verifyDeviceCredential(client, row, activationCode) {
  if (isAuthLocked(row)) return false;
  if (!activationCredentials.matches(row, activationCode)) {
    await recordAuthFailure(client, row);
    return false;
  }
  if (!activationCredentials.isProof(row.activation_code)) {
    const proof = activationCredentials.proof(row.device_id, activationCode);
    await client.query(
      'UPDATE devices SET activation_code=$2,updated_at=NOW() WHERE device_id=$1',
      [row.device_id, proof]
    );
    row.activation_code = proof;
  }
  // Do not clear failures on routine app polling: otherwise a legitimate
  // success between guesses would continuously refresh an attacker's budget.
  return true;
}

async function authorizedDevice(deviceId, activationCode, req) {
  consumeDeviceAuthAttempt(req, deviceId);
  if (!validIdentity(deviceId, activationCode)) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId]);
    const row = result.rows[0];
    if (!row || !await verifyDeviceCredential(client, row, activationCode)) {
      await client.query('COMMIT');
      return null;
    }
    await client.query('COMMIT');
    const status = normalizeStatus(row);
    return status === 'trial' || status === 'active' ? row : null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const portal = createPortalHandlers({ pool, json, readJson, authorizedDevice });

async function initializeDatabase() {
  const schemaUrl = new URL('../schema.sql', import.meta.url);
  const schema = await readFile(schemaUrl, 'utf8');
  await pool.query(schema);
  await pool.query('SELECT 1');
  console.log('BLOFY activation database ready');
}

async function health(res) {
  try {
    await pool.query('SELECT 1');
    return json(res, 200, { ok: true, database: 'ready', playlistEncryption: 'ready', time: Date.now() });
  } catch (error) {
    console.error('health check failed:', safeErrorSummary(error));
    return json(res, 503, { ok: false, database: 'unavailable', time: Date.now() });
  }
}

async function servePortal(res) {
  const file = await readFile(new URL('../web/index.html', import.meta.url));
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': file.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"
  });
  res.end(file);
}

async function servePortalLogo(res) {
  const file = await readFile(new URL('../web/blofy-logo.png', import.meta.url));
  res.writeHead(200, {
    'content-type': 'image/png',
    'content-length': file.length,
    'cache-control': 'public, max-age=86400',
    'x-content-type-options': 'nosniff'
  });
  res.end(file);
}

async function activationCheck(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const appVersion = String(body.appVersion || '').trim().slice(0, 64);
  const platform = String(body.platform || 'android').trim().slice(0, 32);

  consumeDeviceAuthAttempt(req, deviceId);
  if (!validIdentity(deviceId, activationCode)) {
    return json(res, 400, { status: 'blocked', serverTime: Date.now(), message: 'invalid_device_identity' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let result = await client.query('SELECT * FROM devices WHERE device_id = $1 FOR UPDATE', [deviceId]);
    let row = result.rows[0];

    if (!row) {
      const expiresAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);
      result = await client.query(
        `INSERT INTO devices(device_id, activation_code, status, trial_started_at, expires_at, last_seen_at, last_app_version, last_platform)
         VALUES($1,$2,'trial',NOW(),$3,NOW(),$4,$5) RETURNING *`,
        [deviceId, activationCredentials.proof(deviceId, activationCode), expiresAt, appVersion, platform]
      );
      row = result.rows[0];
    } else if (!await verifyDeviceCredential(client, row, activationCode)) {
      await client.query('COMMIT');
      return json(res, 403, { status: 'blocked', serverTime: Date.now(), message: 'unauthorized_device' });
    }

    const status = normalizeStatus(row);
    if (status === 'expired' && row.status !== 'blocked') {
      await client.query("UPDATE devices SET status='expired', updated_at=NOW() WHERE device_id=$1", [deviceId]);
    }
    await client.query(
      'UPDATE devices SET last_seen_at=NOW(), last_app_version=$2, last_platform=$3 WHERE device_id=$1',
      [deviceId, appVersion, platform]
    );
    await client.query('COMMIT');

    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
    return json(res, 200, {
      status,
      expiresAt,
      serverTime: Date.now(),
      message: status === 'trial' ? 'trial_active' : undefined
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function activationRotate(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const currentActivationCode = String(body.currentActivationCode || '').trim();
  const newActivationCode = String(body.newActivationCode || '').trim();

  consumeDeviceAuthAttempt(req, deviceId);
  if (!validIdentity(deviceId, currentActivationCode) || !/^\d{6}$/.test(newActivationCode)) {
    return json(res, 400, { error: 'invalid_device_identity' });
  }
  if (constantTimeEqual(currentActivationCode, newActivationCode)) {
    return json(res, 400, { error: 'activation_code_unchanged' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId]);
    const row = result.rows[0];
    if (!row) {
      await client.query('COMMIT');
      return json(res, 403, { error: 'unauthorized_device' });
    }

    // A lost HTTP response must not strand the app between the old and new codes.
    // The HMAC binds the retry to the exact predecessor instead of turning the
    // new code into a credential oracle.
    if (activationCredentials.matches(row, newActivationCode)) {
      if (isAuthLocked(row)) {
        await client.query('COMMIT');
        return json(res, 403, { error: 'unauthorized_device' });
      }
      const expectedProof = activationCredentials.proof(deviceId, currentActivationCode);
      if (
        row.previous_activation_code_proof &&
        constantTimeEqual(row.previous_activation_code_proof, expectedProof)
      ) {
        await client.query('COMMIT');
        return json(res, 200, { rotated: true });
      }
      await recordAuthFailure(client, row);
      await client.query('COMMIT');
      return json(res, 403, { error: 'unauthorized_device' });
    }

    if (!await verifyDeviceCredential(client, row, currentActivationCode)) {
      await client.query('COMMIT');
      return json(res, 403, { error: 'unauthorized_device' });
    }
    await client.query(
      `UPDATE devices
       SET activation_code=$2,previous_activation_code_proof=$3,activation_rotated_at=NOW(),
           auth_failed_attempts=0,last_auth_failure_at=NULL,auth_locked_until=NULL,updated_at=NOW()
       WHERE device_id=$1`,
      [
        deviceId,
        activationCredentials.proof(deviceId, newActivationCode),
        activationCredentials.proof(deviceId, currentActivationCode)
      ]
    );
    await client.query('COMMIT');
    return json(res, 200, { rotated: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function providerProfile(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const providerKey = String(body.providerKey || '').trim();
  if (!validProviderKey(providerKey)) return json(res, 400, { error: 'invalid_provider_key' });
  if (!await authorizedDevice(deviceId, activationCode, req)) return json(res, 403, { error: 'unauthorized_device' });

  const result = await pool.query(
    `SELECT provider_key,live_format,preferred_transport,preferred_engine,allow_cross_protocol_redirects,updated_at
     FROM provider_profiles WHERE provider_key=$1`, [providerKey]
  );
  const row = result.rows[0];
  if (!row) return json(res, 204, {});
  return json(res, 200, {
    providerKey: row.provider_key,
    liveFormat: row.live_format,
    preferredTransport: row.preferred_transport,
    preferredEngine: row.preferred_engine,
    allowCrossProtocolRedirects: row.allow_cross_protocol_redirects,
    updatedAt: new Date(row.updated_at).getTime()
  });
}

async function playbackDiagnostic(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  if (!validIdentity(deviceId, activationCode)) return json(res, 400, { error: 'invalid_device_identity' });
  if (!await authorizedDevice(deviceId, activationCode, req)) return json(res, 403, { error: 'unauthorized_device' });

  const providerKey = pseudonymizeDiagnosticProviderKey(body.providerKey);
  const contentKind = sanitizeDiagnosticContentKind(body.contentKind);
  const redactedUrl = body.redactedUrl == null ? null : sanitizeDiagnosticUrl(body.redactedUrl, 1024);
  const ttffRaw = body.ttffMs == null ? null : Number(body.ttffMs);
  const ttffMs = Number.isFinite(ttffRaw) && ttffRaw >= 0 && ttffRaw <= 600_000 ? Math.round(ttffRaw) : null;
  const bufferingRaw = Number(body.bufferingCount || 0);
  const bufferingCount = Number.isFinite(bufferingRaw) ? Math.max(0, Math.min(10_000, Math.round(bufferingRaw))) : 0;
  const errorCode = sanitizeDiagnosticErrorCode(body.errorCode);
  const errorMessage = sanitizeDiagnosticMessage(body.errorMessage, 512);
  const appVersion = sanitizeDiagnosticAppVersion(body.appVersion);

  await pool.query(
    `INSERT INTO playback_diagnostics(device_id,provider_key,content_kind,redacted_url,ttff_ms,buffering_count,error_code,error_message,app_version)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [deviceId, providerKey, contentKind, redactedUrl, ttffMs, bufferingCount, errorCode, errorMessage, appVersion]
  );
  return json(res, 202, { accepted: true });
}

function requireAdmin(req, res) {
  const rate = adminIpLimiter.consume(requestClientKey(req));
  if (!rate.allowed) throw new RateLimitError(rate.retryAfterSeconds);
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !constantTimeEqual(token, ADMIN_TOKEN)) {
    json(res, 401, { error: 'unauthorized' });
    return false;
  }
  return true;
}

async function adminUpdate(req, res, deviceId) {
  if (!requireAdmin(req, res)) return;
  const body = await readJson(req);
  const status = String(body.status || '').toLowerCase();
  if (!['trial', 'active', 'expired', 'blocked'].includes(status)) {
    return json(res, 400, { error: 'invalid_status' });
  }

  let expiresAt = null;
  if (body.expiresAt != null) {
    const ms = Number(body.expiresAt);
    if (!Number.isFinite(ms) || ms <= 0) return json(res, 400, { error: 'invalid_expiry' });
    expiresAt = new Date(ms);
  } else if (status === 'active' && body.days != null) {
    const days = Number(body.days);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) return json(res, 400, { error: 'invalid_days' });
    expiresAt = new Date(Date.now() + days * 86_400_000);
  }

  const result = await pool.query(
    `UPDATE devices SET status=$2, expires_at=$3, updated_at=NOW() WHERE device_id=$1
     RETURNING device_id,status,expires_at,updated_at`,
    [deviceId, status, expiresAt]
  );
  if (!result.rows[0]) return json(res, 404, { error: 'device_not_found' });
  const row = result.rows[0];
  return json(res, 200, {
    deviceId: row.device_id,
    status: row.status,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    updatedAt: new Date(row.updated_at).getTime()
  });
}

async function adminGet(req, res, deviceId) {
  if (!requireAdmin(req, res)) return;
  const result = await pool.query(
    `SELECT device_id,status,trial_started_at,expires_at,created_at,updated_at,last_seen_at,last_app_version,last_platform
     FROM devices WHERE device_id=$1`,
    [deviceId]
  );
  if (!result.rows[0]) return json(res, 404, { error: 'device_not_found' });
  const row = result.rows[0];
  return json(res, 200, {
    deviceId: row.device_id,
    status: normalizeStatus(row),
    trialStartedAt: row.trial_started_at ? new Date(row.trial_started_at).getTime() : null,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).getTime() : null,
    appVersion: row.last_app_version,
    platform: row.last_platform
  });
}

async function adminDiagnostics(req, res, requestUrl) {
  if (!requireAdmin(req, res)) return;
  const deviceId = String(requestUrl.searchParams.get('deviceId') || '').trim();
  const providerKey = String(requestUrl.searchParams.get('providerKey') || '').trim();
  const requestedLimit = Number(requestUrl.searchParams.get('limit') || 100);
  const limit = Math.max(1, Math.min(500, Number.isFinite(requestedLimit) ? Math.round(requestedLimit) : 100));

  const clauses = [];
  const values = [];
  if (deviceId) { values.push(deviceId); clauses.push(`device_id=$${values.length}`); }
  if (providerKey) {
    values.push(pseudonymizeDiagnosticProviderKey(providerKey));
    clauses.push(`provider_key=$${values.length}`);
  }
  values.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const result = await pool.query(
    `SELECT id,device_id,provider_key,content_kind,redacted_url,ttff_ms,buffering_count,error_code,error_message,app_version,created_at
     FROM playback_diagnostics ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  );
  return json(res, 200, {
    items: result.rows.map((item) => ({
      id: Number(item.id),
      deviceId: item.device_id,
      providerKey: pseudonymizeDiagnosticProviderKey(item.provider_key),
      contentKind: sanitizeDiagnosticContentKind(item.content_kind),
      redactedUrl: item.redacted_url == null ? null : sanitizeDiagnosticUrl(item.redacted_url, 1024),
      ttffMs: item.ttff_ms == null ? null : Number(item.ttff_ms),
      bufferingCount: Number(item.buffering_count),
      errorCode: sanitizeDiagnosticErrorCode(item.error_code),
      errorMessage: sanitizeDiagnosticMessage(item.error_message, 512),
      appVersion: sanitizeDiagnosticAppVersion(item.app_version),
      createdAt: new Date(item.created_at).getTime()
    }))
  });
}

async function adminProviderProfileGet(req, res, providerKey) {
  if (!requireAdmin(req, res)) return;
  if (!validProviderKey(providerKey)) return json(res, 400, { error: 'invalid_provider_key' });
  const result = await pool.query('SELECT * FROM provider_profiles WHERE provider_key=$1', [providerKey]);
  const row = result.rows[0];
  if (!row) return json(res, 404, { error: 'provider_profile_not_found' });
  return json(res, 200, {
    providerKey: row.provider_key,
    liveFormat: row.live_format,
    preferredTransport: row.preferred_transport,
    preferredEngine: row.preferred_engine,
    allowCrossProtocolRedirects: row.allow_cross_protocol_redirects,
    updatedAt: new Date(row.updated_at).getTime()
  });
}

async function adminProviderProfileUpdate(req, res, providerKey) {
  if (!requireAdmin(req, res)) return;
  if (!validProviderKey(providerKey)) return json(res, 400, { error: 'invalid_provider_key' });
  const body = await readJson(req);
  const liveFormat = body.liveFormat == null ? null : String(body.liveFormat).toLowerCase();
  const preferredTransport = body.preferredTransport == null ? null : String(body.preferredTransport).toLowerCase();
  const preferredEngine = body.preferredEngine == null ? null : String(body.preferredEngine).toLowerCase();
  const redirects = body.allowCrossProtocolRedirects == null ? null : Boolean(body.allowCrossProtocolRedirects);
  if (liveFormat != null && !['ts', 'm3u8'].includes(liveFormat)) return json(res, 400, { error: 'invalid_live_format' });
  if (preferredTransport != null && !['cronet', 'http'].includes(preferredTransport)) return json(res, 400, { error: 'invalid_transport' });
  if (preferredEngine != null && !['media3', 'vlc'].includes(preferredEngine)) return json(res, 400, { error: 'invalid_engine' });

  const result = await pool.query(
    `INSERT INTO provider_profiles(provider_key,live_format,preferred_transport,preferred_engine,allow_cross_protocol_redirects,updated_at)
     VALUES($1,$2,$3,$4,$5,NOW())
     ON CONFLICT(provider_key) DO UPDATE SET
       live_format=EXCLUDED.live_format,
       preferred_transport=EXCLUDED.preferred_transport,
       preferred_engine=EXCLUDED.preferred_engine,
       allow_cross_protocol_redirects=EXCLUDED.allow_cross_protocol_redirects,
       updated_at=NOW()
     RETURNING *`,
    [providerKey, liveFormat, preferredTransport, preferredEngine, redirects]
  );
  const row = result.rows[0];
  return json(res, 200, {
    providerKey: row.provider_key,
    liveFormat: row.live_format,
    preferredTransport: row.preferred_transport,
    preferredEngine: row.preferred_engine,
    allowCrossProtocolRedirects: row.allow_cross_protocol_redirects,
    updatedAt: new Date(row.updated_at).getTime()
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/portal')) return await servePortal(res);
    if (req.method === 'GET' && requestUrl.pathname === '/blofy-logo.png') return await servePortalLogo(res);
    if (req.method === 'GET' && requestUrl.pathname === '/health') return await health(res);
    if (req.method === 'POST' && requestUrl.pathname === '/api/v1/activation/check') return await activationCheck(req, res);
    if (req.method === 'POST' && requestUrl.pathname === '/api/v1/activation/rotate') return await activationRotate(req, res);
    if (req.method === 'POST' && requestUrl.pathname === '/api/v1/provider-profile') return await providerProfile(req, res);
    if (req.method === 'POST' && requestUrl.pathname === '/api/v1/diagnostics/playback') return await playbackDiagnostic(req, res);

    if (req.method === 'POST' && requestUrl.pathname === '/api/v1/portal/playlists/list') return await portal.list(req, res);
    if (req.method === 'POST' && requestUrl.pathname === '/api/v1/portal/playlists') return await portal.upsert(req, res);
    const portalPlaylistMatch = requestUrl.pathname.match(/^\/api\/v1\/portal\/playlists\/([^/?]+)$/);
    if (portalPlaylistMatch && req.method === 'DELETE') return await portal.remove(req, res, decodeURIComponent(portalPlaylistMatch[1]));

    if (req.method === 'GET' && requestUrl.pathname === '/api/v1/admin/diagnostics') return await adminDiagnostics(req, res, requestUrl);
    const profileMatch = requestUrl.pathname.match(/^\/api\/v1\/admin\/provider-profiles\/([^/?]+)$/);
    if (profileMatch && req.method === 'GET') return await adminProviderProfileGet(req, res, decodeURIComponent(profileMatch[1]));
    if (profileMatch && req.method === 'PATCH') return await adminProviderProfileUpdate(req, res, decodeURIComponent(profileMatch[1]));

    const match = requestUrl.pathname.match(/^\/api\/v1\/admin\/devices\/([^/?]+)$/);
    if (match && req.method === 'GET') return await adminGet(req, res, decodeURIComponent(match[1]));
    if (match && req.method === 'PATCH') return await adminUpdate(req, res, decodeURIComponent(match[1]));

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error('request failed:', safeErrorSummary(error));
    if (error instanceof RateLimitError) {
      return json(
        res,
        429,
        { error: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds },
        { 'retry-after': String(error.retryAfterSeconds) }
      );
    }
    const status = error?.message === 'payload_too_large' ? 413 : 500;
    return json(res, status, { error: status === 500 ? 'internal_error' : error.message });
  }
});

async function start() {
  await initializeDatabase();
  server.listen(PORT, '0.0.0.0', () => console.log(`BLOFY activation service listening on :${PORT}`));
}

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch(async (error) => {
  console.error('BLOFY activation startup failed:', safeErrorSummary(error));
  await pool.end().catch(() => {});
  process.exit(1);
});

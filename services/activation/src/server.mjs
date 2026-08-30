import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || '';
const ADMIN_TOKEN = process.env.BLOFY_ADMIN_TOKEN || '';
const TRIAL_DAYS = Number(process.env.BLOFY_TRIAL_DAYS || 7);

if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 24) throw new Error('BLOFY_ADMIN_TOKEN must be at least 24 characters');

const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
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

async function activationCheck(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const appVersion = String(body.appVersion || '').trim().slice(0, 64);
  const platform = String(body.platform || 'android').trim().slice(0, 32);

  if (!/^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) || !/^\d{6}$/.test(activationCode)) {
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
        [deviceId, activationCode, expiresAt, appVersion, platform]
      );
      row = result.rows[0];
    } else if (!constantTimeEqual(row.activation_code, activationCode)) {
      await client.query('ROLLBACK');
      return json(res, 403, { status: 'blocked', serverTime: Date.now(), message: 'activation_code_mismatch' });
    }

    let status = normalizeStatus(row);
    if (status === 'expired' && row.status !== 'blocked') {
      await client.query("UPDATE devices SET status='expired', updated_at=NOW() WHERE device_id=$1", [deviceId]);
    }
    await client.query(
      'UPDATE devices SET last_seen_at=NOW(), last_app_version=$2, last_platform=$3 WHERE device_id=$1',
      [deviceId, appVersion, platform]
    );
    await client.query('COMMIT');

    const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
    return json(res, 200, { status, expiresAt, serverTime: Date.now(), message: status === 'trial' ? 'trial_active' : undefined });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function requireAdmin(req, res) {
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
  if (!['trial', 'active', 'expired', 'blocked'].includes(status)) return json(res, 400, { error: 'invalid_status' });

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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true, time: Date.now() });
    if (req.method === 'POST' && req.url === '/api/v1/activation/check') return await activationCheck(req, res);

    const match = req.url?.match(/^\/api\/v1\/admin\/devices\/([^/?]+)$/);
    if (match && req.method === 'GET') return await adminGet(req, res, decodeURIComponent(match[1]));
    if (match && req.method === 'PATCH') return await adminUpdate(req, res, decodeURIComponent(match[1]));

    return json(res, 404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    const status = error?.message === 'payload_too_large' ? 413 : 500;
    return json(res, status, { error: status === 500 ? 'internal_error' : error.message });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`BLOFY activation service listening on :${PORT}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

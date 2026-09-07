import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { createActivationCredentialCodec, isAuthLocked } from './auth-protection.mjs';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PLAYLIST_ENCRYPTION_KEY = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const PREFIX = '/api/v1/cloud/profile';
const MAX_BODY_BYTES = 96_000;
const PAIR_TTL_MINUTES = 10;
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
}) : null;
const activationCredentials = /^[a-fA-F0-9]{64}$/.test(PLAYLIST_ENCRYPTION_KEY)
  ? createActivationCredentialCodec(PLAYLIST_ENCRYPTION_KEY)
  : null;

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error('payload_too_large');
  }
  return body ? JSON.parse(body) : {};
}

function validIdentity(deviceId, activationCode) {
  return /^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) && /^\d{6}$/.test(activationCode);
}

function validProfileId(value) {
  return /^[A-Za-z0-9._:-]{1,96}$/.test(String(value || ''));
}

async function authorizedDevice(deviceId, activationCode) {
  if (!pool || !activationCredentials || !validIdentity(deviceId, activationCode)) return null;
  const result = await pool.query(
    'SELECT device_id,activation_code,status,expires_at,auth_locked_until FROM devices WHERE device_id=$1 LIMIT 1',
    [deviceId]
  );
  const row = result.rows[0];
  if (!row || isAuthLocked(row) || !activationCredentials.matches(row, activationCode)) return null;
  return row;
}

function sanitizePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_payload');
  const allowed = {};
  if (Array.isArray(value.watchlist)) allowed.watchlist = value.watchlist.filter((v) => typeof v === 'string').slice(0, 500);
  if (Array.isArray(value.hiddenCategories)) allowed.hiddenCategories = value.hiddenCategories.filter((v) => typeof v === 'string').slice(0, 500);
  if (Array.isArray(value.homeRows)) allowed.homeRows = value.homeRows.filter((v) => typeof v === 'string').slice(0, 20);
  if (value.settings && typeof value.settings === 'object' && !Array.isArray(value.settings)) {
    allowed.settings = Object.fromEntries(Object.entries(value.settings).filter(([k, v]) =>
      /^[A-Za-z0-9._-]{1,64}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)
    ).slice(0, 80));
  }
  return allowed;
}

function pairCode() {
  let value = '';
  for (let i = 0; i < 8; i += 1) value += PAIR_ALPHABET[crypto.randomInt(PAIR_ALPHABET.length)];
  return value;
}

function pairHash(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex');
}

async function getSnapshot(req, res, requestUrl) {
  // New clients authenticate through headers so activation codes never appear in access logs or URLs.
  // Query-string credentials remain as a temporary fallback for older installed builds.
  const deviceId = String(req.headers['x-blofy-device-id'] || requestUrl.searchParams.get('deviceId') || '').trim();
  const activationCode = String(req.headers['x-blofy-activation-code'] || requestUrl.searchParams.get('activationCode') || '').trim();
  const profileId = String(requestUrl.searchParams.get('profileId') || '').trim();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!validProfileId(profileId)) return sendJson(res, 400, { error: 'invalid_profile' });
  const result = await pool.query(
    `SELECT revision,payload_json,updated_at FROM profile_cloud_snapshots
     WHERE device_id=$1 AND profile_id=$2 LIMIT 1`, [deviceId, profileId]
  );
  const row = result.rows[0];
  if (!row) return sendJson(res, 200, { exists: false, revision: 0, payload: {} });
  return sendJson(res, 200, {
    exists: true,
    revision: Number(row.revision),
    payload: row.payload_json || {},
    updatedAt: new Date(row.updated_at).getTime()
  });
}

async function putSnapshot(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const profileId = String(body.profileId || '').trim();
  const expectedRevision = body.expectedRevision == null ? null : Number(body.expectedRevision);
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!validProfileId(profileId)) return sendJson(res, 400, { error: 'invalid_profile' });
  if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
    return sendJson(res, 400, { error: 'invalid_revision' });
  }
  const payload = sanitizePayload(body.payload);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT revision FROM profile_cloud_snapshots WHERE device_id=$1 AND profile_id=$2 FOR UPDATE`,
      [deviceId, profileId]
    );
    const current = currentResult.rows[0];
    const currentRevision = current ? Number(current.revision) : 0;
    if (expectedRevision != null && expectedRevision !== currentRevision) {
      await client.query('ROLLBACK');
      return sendJson(res, 409, { error: 'revision_conflict', revision: currentRevision });
    }
    const nextRevision = currentRevision + 1;
    await client.query(
      `INSERT INTO profile_cloud_snapshots(device_id,profile_id,revision,payload_json,updated_at)
       VALUES($1,$2,$3,$4::jsonb,NOW())
       ON CONFLICT(device_id,profile_id) DO UPDATE SET
         revision=EXCLUDED.revision,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,
      [deviceId, profileId, nextRevision, JSON.stringify(payload)]
    );
    await client.query('COMMIT');
    return sendJson(res, 200, { saved: true, revision: nextRevision, payload });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createPair(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const profileId = String(body.profileId || '').trim();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!validProfileId(profileId)) return sendJson(res, 400, { error: 'invalid_profile' });

  const snapshot = await pool.query(
    'SELECT revision FROM profile_cloud_snapshots WHERE device_id=$1 AND profile_id=$2 LIMIT 1',
    [deviceId, profileId]
  );
  if (!snapshot.rows[0]) return sendJson(res, 409, { error: 'cloud_snapshot_missing' });

  await pool.query('DELETE FROM cloud_pair_codes WHERE expires_at<=NOW() OR consumed_at IS NOT NULL');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = pairCode();
    const hash = pairHash(code);
    const inserted = await pool.query(
      `INSERT INTO cloud_pair_codes(code_hash,source_device_id,source_profile_id,expires_at)
       VALUES($1,$2,$3,NOW()+($4::text || ' minutes')::interval)
       ON CONFLICT(code_hash) DO NOTHING RETURNING expires_at`,
      [hash, deviceId, profileId, String(PAIR_TTL_MINUTES)]
    );
    if (inserted.rows[0]) {
      return sendJson(res, 201, {
        pairCode: code,
        expiresAt: new Date(inserted.rows[0].expires_at).getTime(),
        ttlMinutes: PAIR_TTL_MINUTES
      });
    }
  }
  return sendJson(res, 503, { error: 'pair_code_unavailable' });
}

async function restorePair(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const profileId = String(body.profileId || '').trim();
  const code = String(body.pairCode || '').trim().toUpperCase();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!validProfileId(profileId)) return sendJson(res, 400, { error: 'invalid_profile' });
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) return sendJson(res, 400, { error: 'invalid_pair_code' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pairResult = await client.query(
      `SELECT source_device_id,source_profile_id FROM cloud_pair_codes
       WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE`, [pairHash(code)]
    );
    const pair = pairResult.rows[0];
    if (!pair) {
      await client.query('ROLLBACK');
      return sendJson(res, 404, { error: 'pair_code_expired_or_used' });
    }
    if (pair.source_device_id === deviceId) {
      await client.query('ROLLBACK');
      return sendJson(res, 400, { error: 'same_device_pair' });
    }
    const sourceResult = await client.query(
      `SELECT payload_json FROM profile_cloud_snapshots
       WHERE device_id=$1 AND profile_id=$2 LIMIT 1`,
      [pair.source_device_id, pair.source_profile_id]
    );
    const source = sourceResult.rows[0];
    if (!source) throw new Error('source_snapshot_missing');
    const payload = sanitizePayload(source.payload_json || {});

    const targetResult = await client.query(
      `SELECT revision FROM profile_cloud_snapshots WHERE device_id=$1 AND profile_id=$2 FOR UPDATE`,
      [deviceId, profileId]
    );
    const nextRevision = (targetResult.rows[0] ? Number(targetResult.rows[0].revision) : 0) + 1;
    await client.query(
      `INSERT INTO profile_cloud_snapshots(device_id,profile_id,revision,payload_json,updated_at)
       VALUES($1,$2,$3,$4::jsonb,NOW())
       ON CONFLICT(device_id,profile_id) DO UPDATE SET
         revision=EXCLUDED.revision,payload_json=EXCLUDED.payload_json,updated_at=NOW()`,
      [deviceId, profileId, nextRevision, JSON.stringify(payload)]
    );
    await client.query('UPDATE cloud_pair_codes SET consumed_at=NOW() WHERE code_hash=$1', [pairHash(code)]);
    await client.query('COMMIT');
    return sendJson(res, 200, { restored: true, revision: nextRevision, payload });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function handle(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && requestUrl.pathname === PREFIX) { await getSnapshot(req, res, requestUrl); return true; }
  if (req.method === 'PUT' && requestUrl.pathname === PREFIX) { await putSnapshot(req, res); return true; }
  if (req.method === 'POST' && requestUrl.pathname === `${PREFIX}/pair/create`) { await createPair(req, res); return true; }
  if (req.method === 'POST' && requestUrl.pathname === `${PREFIX}/pair/restore`) { await restorePair(req, res); return true; }
  return false;
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedProfileCloudServer(listener) {
  if (typeof listener !== 'function') return originalCreateServer(listener);
  return originalCreateServer(async (req, res) => {
    try {
      if (String(req.url || '').startsWith(PREFIX) && await handle(req, res)) return;
    } catch (error) {
      const code = error?.message === 'payload_too_large' ? 413 : 500;
      const name = error?.message === 'invalid_payload' ? 'invalid_payload' :
        error?.message === 'payload_too_large' ? 'payload_too_large' :
        error?.message === 'source_snapshot_missing' ? 'source_snapshot_missing' : 'profile_cloud_error';
      if (!res.headersSent) sendJson(res, code, { error: name });
      else res.destroy();
      return;
    }
    return listener(req, res);
  });
};

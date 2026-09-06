import http from 'node:http';
import pg from 'pg';
import { createActivationCredentialCodec, isAuthLocked } from './auth-protection.mjs';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PLAYLIST_ENCRYPTION_KEY = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const PAYMENT_CHECKOUT_URL = String(process.env.BLOFY_PAYMENT_CHECKOUT_URL || '').trim();
const PAYMENT_CHECKOUT_SECRET = String(process.env.BLOFY_PAYMENT_CHECKOUT_SECRET || process.env.BLOFY_PAYMENT_WEBHOOK_SECRET || '').trim();
const PAYMENT_WEBHOOK_SECRET = String(process.env.BLOFY_PAYMENT_WEBHOOK_SECRET || '').trim();
const PUBLIC_BASE_URL = String(process.env.BLOFY_PUBLIC_BASE_URL || '').trim();
const PATH = '/api/v1/subscriptions/readiness';

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
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8_192) throw new Error('payload_too_large');
  }
  return raw ? JSON.parse(raw) : {};
}

function validIdentity(deviceId, activationCode) {
  return /^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) && /^\d{6}$/.test(activationCode);
}

function validHttps(value) {
  if (!value) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

async function authorizedDevice(deviceId, activationCode) {
  if (!pool || !activationCredentials || !validIdentity(deviceId, activationCode)) return null;
  const result = await pool.query(
    'SELECT device_id,status,expires_at,auth_locked_until,activation_code FROM devices WHERE device_id=$1 LIMIT 1',
    [deviceId]
  );
  const row = result.rows[0];
  if (!row || isAuthLocked(row) || !activationCredentials.matches(row, activationCode)) return null;
  return row;
}

async function readiness(req, res) {
  if (!pool || !activationCredentials) return sendJson(res, 503, { error: 'commercial_service_not_configured' });
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const device = await authorizedDevice(deviceId, activationCode);
  if (!device) return sendJson(res, 403, { error: 'unauthorized_device' });

  const [plans, subscription, pending] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM subscription_plans WHERE enabled=TRUE"),
    pool.query(
      `SELECT plan_key,status,starts_at,expires_at
       FROM device_subscriptions
       WHERE device_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY expires_at DESC NULLS FIRST, starts_at DESC
       LIMIT 1`,
      [deviceId]
    ),
    pool.query(
      `SELECT id,plan_key,amount_minor,currency,created_at
       FROM subscription_orders
       WHERE device_id=$1 AND status='pending'
       ORDER BY created_at DESC LIMIT 1`,
      [deviceId]
    )
  ]);

  const checkoutConfigured = validHttps(PAYMENT_CHECKOUT_URL) && PAYMENT_CHECKOUT_SECRET.length >= 16;
  const webhookConfigured = PAYMENT_WEBHOOK_SECRET.length >= 16;
  const callbacksConfigured = validHttps(PUBLIC_BASE_URL);
  const readyForLivePayments = checkoutConfigured && webhookConfigured && callbacksConfigured && Number(plans.rows[0]?.count || 0) > 0;

  return sendJson(res, 200, {
    readyForLivePayments,
    checkoutConfigured,
    webhookConfigured,
    callbacksConfigured,
    plansAvailable: Number(plans.rows[0]?.count || 0),
    deviceStatus: String(device.status || ''),
    subscription: subscription.rows[0] || null,
    pendingOrder: pending.rows[0] || null
  });
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedCommercialReadinessServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) {}
    if (req.method === 'POST' && pathname === PATH) {
      try { return await readiness(req, res); }
      catch {
        if (!res.headersSent) return sendJson(res, 500, { error: 'commercial_readiness_error' });
        res.destroy();
        return;
      }
    }
    return listener(req, res);
  });
};

import http from 'node:http';
import pg from 'pg';
import crypto from 'node:crypto';
import { createActivationCredentialCodec, isAuthLocked } from './auth-protection.mjs';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PLAYLIST_ENCRYPTION_KEY = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const PAYMENT_CHECKOUT_URL = String(process.env.BLOFY_PAYMENT_CHECKOUT_URL || '').trim();
const PAYMENT_CHECKOUT_SECRET = String(process.env.BLOFY_PAYMENT_CHECKOUT_SECRET || process.env.BLOFY_PAYMENT_WEBHOOK_SECRET || '').trim();
const PATH = '/api/v1/subscriptions/checkout';
const CHECKOUT_TTL_MS = 15 * 60 * 1000;

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
    if (raw.length > 16_384) throw new Error('payload_too_large');
  }
  return raw ? JSON.parse(raw) : {};
}

function validIdentity(deviceId, activationCode) {
  return /^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) && /^\d{6}$/.test(activationCode);
}

function checkoutBase() {
  if (!PAYMENT_CHECKOUT_URL) return null;
  try {
    const url = new URL(PAYMENT_CHECKOUT_URL);
    if (url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function signCheckout(order, expiresAtMs) {
  if (!PAYMENT_CHECKOUT_SECRET) return null;
  const payload = [
    order.id,
    order.device_id,
    order.plan_key,
    String(order.amount_minor),
    String(order.currency).toUpperCase(),
    String(expiresAtMs)
  ].join('|');
  return crypto.createHmac('sha256', PAYMENT_CHECKOUT_SECRET).update(payload, 'utf8').digest('hex');
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

async function checkout(req, res) {
  const base = checkoutBase();
  if (!pool || !base || !PAYMENT_CHECKOUT_SECRET) {
    return sendJson(res, 503, { error: 'payment_checkout_not_configured' });
  }

  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const orderId = String(body.orderId || '').trim();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return sendJson(res, 400, { error: 'invalid_order' });

  const result = await pool.query(
    `SELECT id,device_id,plan_key,status,amount_minor,currency,created_at
     FROM subscription_orders WHERE id=$1 AND device_id=$2 LIMIT 1`,
    [orderId, deviceId]
  );
  const order = result.rows[0];
  if (!order) return sendJson(res, 404, { error: 'order_not_found' });
  if (order.status === 'paid') return sendJson(res, 409, { error: 'order_already_paid' });
  if (order.status !== 'pending') return sendJson(res, 409, { error: 'order_not_payable' });
  if (!Number.isSafeInteger(Number(order.amount_minor)) || Number(order.amount_minor) <= 0) {
    return sendJson(res, 409, { error: 'invalid_order_amount' });
  }
  if (!/^[A-Z]{3}$/i.test(String(order.currency || ''))) {
    return sendJson(res, 409, { error: 'invalid_order_currency' });
  }

  const createdAt = new Date(order.created_at).getTime();
  const expiresAtMs = Number.isFinite(createdAt) ? createdAt + CHECKOUT_TTL_MS : 0;
  const remainingMs = expiresAtMs - Date.now();
  if (remainingMs <= 0) {
    await pool.query(
      `UPDATE subscription_orders SET status='cancelled',updated_at=NOW()
       WHERE id=$1 AND device_id=$2 AND status='pending'`,
      [orderId, deviceId]
    ).catch(() => {});
    return sendJson(res, 410, { error: 'order_expired' });
  }

  const signature = signCheckout(order, expiresAtMs);
  const url = new URL(base.toString());
  url.searchParams.set('order_id', order.id);
  url.searchParams.set('device_id', order.device_id);
  url.searchParams.set('plan', order.plan_key);
  url.searchParams.set('amount_minor', String(order.amount_minor));
  url.searchParams.set('currency', String(order.currency).toUpperCase());
  url.searchParams.set('expires_at', String(expiresAtMs));
  url.searchParams.set('state', signature);

  return sendJson(res, 200, {
    orderId: order.id,
    checkoutUrl: url.toString(),
    expiresInSeconds: Math.max(1, Math.min(900, Math.floor(remainingMs / 1000)))
  });
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedCheckoutCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) {}
    if (req.method === 'POST' && pathname === PATH) {
      try { return await checkout(req, res); }
      catch {
        if (!res.headersSent) return sendJson(res, 500, { error: 'payment_checkout_error' });
        res.destroy();
        return;
      }
    }
    return listener(req, res);
  });
};

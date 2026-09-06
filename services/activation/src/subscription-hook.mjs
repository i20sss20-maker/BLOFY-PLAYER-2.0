import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { createActivationCredentialCodec, isAuthLocked } from './auth-protection.mjs';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const PLAYLIST_ENCRYPTION_KEY = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const PAYMENT_WEBHOOK_SECRET = String(process.env.BLOFY_PAYMENT_WEBHOOK_SECRET || '').trim();
const PREFIX = '/api/v1/subscriptions';
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

async function readRaw(req, maxBytes = 16_384) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw new Error('payload_too_large');
  }
  return body;
}

async function readJson(req) {
  const body = await readRaw(req);
  return body ? JSON.parse(body) : {};
}

function validIdentity(deviceId, activationCode) {
  return /^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) && /^\d{6}$/.test(activationCode);
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

function timingSafeHexEqual(left, right) {
  const a = Buffer.from(String(left || '').toLowerCase());
  const b = Buffer.from(String(right || '').toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyWebhookSignature(rawBody, supplied) {
  if (!PAYMENT_WEBHOOK_SECRET || PAYMENT_WEBHOOK_SECRET.length < 24) return false;
  const signature = String(supplied || '').trim().replace(/^sha256=/i, '');
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', PAYMENT_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return timingSafeHexEqual(signature, expected);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function listPlans(_req, res) {
  if (!pool) return sendJson(res, 503, { error: 'subscription_service_unavailable' });
  const result = await pool.query(
    `SELECT plan_key,name,duration_days,max_devices,price_minor,currency
     FROM subscription_plans WHERE active=TRUE ORDER BY sort_order,name`
  );
  return sendJson(res, 200, {
    items: result.rows.map((row) => ({
      key: row.plan_key,
      name: row.name,
      durationDays: row.duration_days == null ? null : Number(row.duration_days),
      maxDevices: Number(row.max_devices),
      priceMinor: Number(row.price_minor),
      currency: row.currency
    }))
  });
}

async function quoteOrder(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const planKey = String(body.planKey || '').trim();
  const couponCode = String(body.couponCode || '').trim().toUpperCase();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(planKey)) return sendJson(res, 400, { error: 'invalid_plan' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const planResult = await client.query(
      `SELECT plan_key,name,duration_days,max_devices,price_minor,currency
       FROM subscription_plans WHERE plan_key=$1 AND active=TRUE FOR SHARE`, [planKey]
    );
    const plan = planResult.rows[0];
    if (!plan) { await client.query('ROLLBACK'); return sendJson(res, 404, { error: 'plan_not_found' }); }

    let amount = Number(plan.price_minor);
    let coupon = null;
    if (couponCode) {
      const couponResult = await client.query(
        `SELECT code,discount_type,discount_value,currency,max_redemptions,redemption_count,starts_at,expires_at
         FROM coupons WHERE code=$1 AND active=TRUE FOR SHARE`, [couponCode]
      );
      coupon = couponResult.rows[0] || null;
      const now = Date.now();
      const validWindow = coupon && (!coupon.starts_at || new Date(coupon.starts_at).getTime() <= now) &&
        (!coupon.expires_at || new Date(coupon.expires_at).getTime() > now);
      const capacity = coupon && (coupon.max_redemptions == null || Number(coupon.redemption_count) < Number(coupon.max_redemptions));
      const currencyOk = coupon && (!coupon.currency || coupon.currency === plan.currency);
      if (!validWindow || !capacity || !currencyOk) {
        await client.query('ROLLBACK');
        return sendJson(res, 400, { error: 'coupon_invalid' });
      }
      if (coupon.discount_type === 'percent') {
        const pct = Math.min(100, Number(coupon.discount_value));
        amount = Math.max(0, Math.round(amount * (100 - pct) / 100));
      } else {
        amount = Math.max(0, amount - Number(coupon.discount_value));
      }
    }

    await client.query('COMMIT');
    return sendJson(res, 200, {
      planKey: plan.plan_key,
      name: plan.name,
      durationDays: plan.duration_days == null ? null : Number(plan.duration_days),
      maxDevices: Number(plan.max_devices),
      amountMinor: amount,
      currency: plan.currency,
      couponCode: coupon?.code || null
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function createOrder(req, res) {
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  const planKey = String(body.planKey || '').trim();
  const couponCode = String(body.couponCode || '').trim().toUpperCase();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(planKey)) return sendJson(res, 400, { error: 'invalid_plan' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const planResult = await client.query(
      'SELECT plan_key,price_minor,currency FROM subscription_plans WHERE plan_key=$1 AND active=TRUE FOR SHARE', [planKey]
    );
    const plan = planResult.rows[0];
    if (!plan) { await client.query('ROLLBACK'); return sendJson(res, 404, { error: 'plan_not_found' }); }

    let amount = Number(plan.price_minor);
    let appliedCoupon = null;
    if (couponCode) {
      const couponResult = await client.query(
        `SELECT code,discount_type,discount_value,currency,max_redemptions,redemption_count,starts_at,expires_at
         FROM coupons WHERE code=$1 AND active=TRUE FOR UPDATE`, [couponCode]
      );
      const coupon = couponResult.rows[0];
      const now = Date.now();
      const valid = coupon && (!coupon.starts_at || new Date(coupon.starts_at).getTime() <= now) &&
        (!coupon.expires_at || new Date(coupon.expires_at).getTime() > now) &&
        (coupon.max_redemptions == null || Number(coupon.redemption_count) < Number(coupon.max_redemptions)) &&
        (!coupon.currency || coupon.currency === plan.currency);
      if (!valid) { await client.query('ROLLBACK'); return sendJson(res, 400, { error: 'coupon_invalid' }); }
      if (coupon.discount_type === 'percent') {
        amount = Math.max(0, Math.round(amount * (100 - Math.min(100, Number(coupon.discount_value))) / 100));
      } else amount = Math.max(0, amount - Number(coupon.discount_value));
      appliedCoupon = coupon.code;
    }

    const orderId = crypto.randomUUID();
    await client.query(
      `INSERT INTO subscription_orders(id,device_id,plan_key,status,amount_minor,currency,coupon_code)
       VALUES($1,$2,$3,'pending',$4,$5,$6)`,
      [orderId, deviceId, plan.plan_key, amount, plan.currency, appliedCoupon]
    );
    if (appliedCoupon) {
      await client.query('UPDATE coupons SET redemption_count=redemption_count+1,updated_at=NOW() WHERE code=$1', [appliedCoupon]);
      await client.query(
        'INSERT INTO coupon_redemptions(code,device_id,order_id) VALUES($1,$2,$3)',
        [appliedCoupon, deviceId, orderId]
      );
    }
    await client.query('COMMIT');
    return sendJson(res, 201, {
      orderId,
      status: 'pending',
      amountMinor: amount,
      currency: plan.currency,
      planKey: plan.plan_key,
      couponCode: appliedCoupon
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function orderStatus(req, res, requestUrl) {
  const deviceId = String(requestUrl.searchParams.get('deviceId') || '').trim();
  const activationCode = String(requestUrl.searchParams.get('activationCode') || '').trim();
  const orderId = String(requestUrl.searchParams.get('orderId') || '').trim();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  if (!validUuid(orderId)) return sendJson(res, 400, { error: 'invalid_order' });
  const result = await pool.query(
    `SELECT id,plan_key,status,amount_minor,currency,coupon_code,created_at,paid_at
     FROM subscription_orders WHERE id=$1 AND device_id=$2 LIMIT 1`, [orderId, deviceId]
  );
  const row = result.rows[0];
  if (!row) return sendJson(res, 404, { error: 'order_not_found' });
  return sendJson(res, 200, {
    orderId: row.id,
    planKey: row.plan_key,
    status: row.status,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    couponCode: row.coupon_code,
    createdAt: new Date(row.created_at).getTime(),
    paidAt: row.paid_at ? new Date(row.paid_at).getTime() : null
  });
}

async function subscriptionStatus(req, res, requestUrl) {
  const deviceId = String(requestUrl.searchParams.get('deviceId') || '').trim();
  const activationCode = String(requestUrl.searchParams.get('activationCode') || '').trim();
  if (!await authorizedDevice(deviceId, activationCode)) return sendJson(res, 403, { error: 'unauthorized_device' });
  const result = await pool.query(
    `SELECT ds.plan_key,ds.status,ds.starts_at,ds.expires_at,sp.name,sp.max_devices
     FROM device_subscriptions ds JOIN subscription_plans sp ON sp.plan_key=ds.plan_key
     WHERE ds.device_id=$1 ORDER BY ds.starts_at DESC LIMIT 1`, [deviceId]
  );
  const row = result.rows[0];
  if (!row) return sendJson(res, 200, { active: false });
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
  const active = row.status === 'active' && (!expiresAt || expiresAt > Date.now());
  return sendJson(res, 200, {
    active,
    planKey: row.plan_key,
    planName: row.name,
    maxDevices: Number(row.max_devices),
    startsAt: new Date(row.starts_at).getTime(),
    expiresAt
  });
}

async function reconcileDeviceEntitlement(client, deviceId) {
  const result = await client.query(
    `SELECT expires_at FROM device_subscriptions
     WHERE device_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW())
     ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END DESC, expires_at DESC NULLS FIRST, starts_at DESC
     LIMIT 1`, [deviceId]
  );
  const active = result.rows[0];
  if (active) {
    await client.query(
      `UPDATE devices SET status='active',expires_at=$2,updated_at=NOW() WHERE device_id=$1`,
      [deviceId, active.expires_at || null]
    );
  } else {
    await client.query(
      `UPDATE devices SET status='expired',expires_at=NOW(),updated_at=NOW() WHERE device_id=$1 AND status!='blocked'`,
      [deviceId]
    );
  }
}

async function applyPaymentEvent(client, payload) {
  const eventId = String(payload.eventId || '').trim();
  const type = String(payload.type || '').trim().toLowerCase();
  const provider = String(payload.provider || 'external').trim().toLowerCase().slice(0, 64);
  const providerReference = String(payload.providerReference || '').trim().slice(0, 160) || null;
  const orderId = String(payload.orderId || '').trim();
  if (!/^[A-Za-z0-9._:-]{4,160}$/.test(eventId)) throw new Error('invalid_event_id');
  if (!['paid', 'failed', 'cancelled', 'refunded'].includes(type)) throw new Error('invalid_event_type');
  if (!validUuid(orderId)) throw new Error('invalid_order');

  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const inserted = await client.query(
    `INSERT INTO payment_events(payment_provider,provider_event_id,event_type,payload_hash,processing_status)
     VALUES($1,$2,$3,$4,'received') ON CONFLICT(payment_provider,provider_event_id) DO NOTHING RETURNING id`,
    [provider, eventId, type, payloadHash]
  );
  if (!inserted.rows[0]) return { duplicate: true };

  const orderResult = await client.query(
    `SELECT so.*,sp.duration_days FROM subscription_orders so
     JOIN subscription_plans sp ON sp.plan_key=so.plan_key
     WHERE so.id=$1 FOR UPDATE`, [orderId]
  );
  const order = orderResult.rows[0];
  if (!order) throw new Error('order_not_found');

  if (type === 'paid') {
    const paidAmount = Number(payload.amountMinor);
    const currency = String(payload.currency || '').trim().toUpperCase();
    if (!Number.isFinite(paidAmount) || Math.round(paidAmount) !== Number(order.amount_minor)) throw new Error('payment_amount_mismatch');
    if (currency !== String(order.currency).toUpperCase()) throw new Error('payment_currency_mismatch');

    if (order.status !== 'paid') {
      await client.query(
        `UPDATE subscription_orders SET status='paid',payment_provider=$2,provider_reference=$3,paid_at=NOW(),updated_at=NOW()
         WHERE id=$1`, [orderId, provider, providerReference]
      );
      const currentResult = await client.query(
        `SELECT expires_at FROM device_subscriptions
         WHERE device_id=$1 AND status='active' ORDER BY starts_at DESC LIMIT 1 FOR UPDATE`, [order.device_id]
      );
      const current = currentResult.rows[0];
      const now = new Date();
      let expiresAt = null;
      if (order.duration_days != null) {
        const currentExpiry = current?.expires_at ? new Date(current.expires_at) : null;
        const base = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now;
        expiresAt = new Date(base.getTime() + Number(order.duration_days) * 86_400_000);
      }
      await client.query(
        `INSERT INTO device_subscriptions(id,device_id,plan_key,order_id,starts_at,expires_at,status)
         VALUES($1,$2,$3,$4,NOW(),$5,'active')`,
        [crypto.randomUUID(), order.device_id, order.plan_key, orderId, expiresAt]
      );
      await reconcileDeviceEntitlement(client, order.device_id);
    }
  } else if (type === 'refunded') {
    await client.query(`UPDATE subscription_orders SET status='refunded',updated_at=NOW() WHERE id=$1`, [orderId]);
    await client.query(`UPDATE device_subscriptions SET status='refunded',updated_at=NOW() WHERE order_id=$1`, [orderId]);
    await reconcileDeviceEntitlement(client, order.device_id);
  } else {
    const nextStatus = type === 'cancelled' ? 'cancelled' : 'failed';
    if (order.status === 'pending') {
      await client.query(`UPDATE subscription_orders SET status=$2,updated_at=NOW() WHERE id=$1`, [orderId, nextStatus]);
    }
  }

  await client.query(
    `UPDATE payment_events SET processing_status='applied',processed_at=NOW() WHERE id=$1`,
    [inserted.rows[0].id]
  );
  return { duplicate: false, orderId, type };
}

async function paymentWebhook(req, res) {
  if (!pool || !PAYMENT_WEBHOOK_SECRET || PAYMENT_WEBHOOK_SECRET.length < 24) {
    return sendJson(res, 503, { error: 'payment_webhook_not_configured' });
  }
  const raw = await readRaw(req, 65_536);
  if (!verifyWebhookSignature(raw, req.headers['x-blofy-signature'])) {
    return sendJson(res, 401, { error: 'invalid_webhook_signature' });
  }
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; }
  catch { return sendJson(res, 400, { error: 'invalid_json' }); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await applyPaymentEvent(client, payload);
    await client.query('COMMIT');
    return sendJson(res, 200, { accepted: true, duplicate: result.duplicate === true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return sendJson(res, 400, { error: String(error?.message || 'payment_event_rejected').slice(0, 96) });
  } finally {
    client.release();
  }
}

async function handle(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && requestUrl.pathname === `${PREFIX}/plans`) { await listPlans(req, res); return true; }
  if (req.method === 'POST' && requestUrl.pathname === `${PREFIX}/quote`) { await quoteOrder(req, res); return true; }
  if (req.method === 'POST' && requestUrl.pathname === `${PREFIX}/orders`) { await createOrder(req, res); return true; }
  if (req.method === 'GET' && requestUrl.pathname === `${PREFIX}/orders/status`) { await orderStatus(req, res, requestUrl); return true; }
  if (req.method === 'GET' && requestUrl.pathname === `${PREFIX}/status`) { await subscriptionStatus(req, res, requestUrl); return true; }
  if (req.method === 'POST' && requestUrl.pathname === `${PREFIX}/payment/webhook`) { await paymentWebhook(req, res); return true; }
  return false;
}

const originalCreateServer = http.createServer.bind(http);
http.createServer = function patchedCreateServer(listener) {
  if (typeof listener !== 'function') return originalCreateServer(listener);
  return originalCreateServer(async (req, res) => {
    try {
      if (String(req.url || '').startsWith(PREFIX) && await handle(req, res)) return;
    } catch {
      if (!res.headersSent) sendJson(res, 500, { error: 'subscription_service_error' });
      else res.destroy();
      return;
    }
    return listener(req, res);
  });
};

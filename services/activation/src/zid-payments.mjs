import crypto from 'node:crypto';
import { ADMIN_CONSOLE_SCHEMA } from './admin-console-schema.mjs';

export const ZID_DEVICE_FIELD = 'رقم جهاز BLOFY PLAYER (Device ID)';
const id = value => /^[1-9][0-9]{0,19}$/.test(String(value ?? '')) ? String(value) : null;
const deviceId = value => {
  const text = String(value ?? '').trim().toUpperCase();
  return /^BLOFY-[A-Z0-9-]{4,32}$/.test(text) ? text : null;
};
const fail = (code, status = 409) => Object.assign(new Error(code), { status });
const text = value => typeof value === 'string' ? value : value?.ar || value?.en || '';
const equal = (a, b) => {
  const first = Buffer.from(String(a || '')), second = Buffer.from(String(b || ''));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
};
export function moneyMinor(value) {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(String(value ?? ''))) throw fail('invalid_zid_amount');
  const amount = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw fail('invalid_zid_amount');
  return amount;
}

// Product IDs are explicitly allowlisted. Never grant a license based on a name or SKU alone.
export function parseZidPlans(source) {
  if (!source) return [];
  let items;
  try { items = JSON.parse(source); } catch { throw fail('invalid_zid_plans', 503); }
  if (!Array.isArray(items) || items.length > 20) throw fail('invalid_zid_plans', 503);
  const keys = new Set(), products = new Set();
  return items.map(item => {
    if (!item || !/^zid-[a-z0-9-]{2,60}$/.test(item.planKey || '') ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.productId || '') ||
        !/^BLOFY-PLAYER-(3M|6M|12M)$/.test(item.sku || '') ||
        item.durationDays !== ({'BLOFY-PLAYER-3M':90,'BLOFY-PLAYER-6M':180,'BLOFY-PLAYER-12M':365})[item.sku] || !item.name ||
        !Number.isSafeInteger(item.priceMinor) || item.priceMinor < 1 ||
        keys.has(item.planKey) || products.has(item.productId.toLowerCase())) throw fail('invalid_zid_plans', 503);
    let productUrl = null;
    if (item.productUrl) {
      const url = new URL(item.productUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
          !['blofysat.com', 'www.blofysat.com', 'blofy-sat.zid.store'].includes(url.hostname) ||
          !url.pathname.startsWith('/products/')) throw fail('invalid_zid_product_url', 503);
      productUrl = url.toString();
    }
    keys.add(item.planKey); products.add(item.productId.toLowerCase());
    return { planKey: item.planKey, productId: item.productId.toLowerCase(), sku: item.sku,
      name: String(item.name).slice(0, 120), durationDays: item.durationDays, maxDevices: 1,
      priceMinor: item.priceMinor, currency: 'SAR', productUrl };
  });
}

export function orderIdFromZidPayload(payload) {
  return id(payload?.order?.id ?? payload?.data?.order?.id ?? payload?.data?.id ?? payload?.id);
}

export function licenseLines(order, plans, storeId) {
  if (String(order?.store_id) !== String(storeId) || !id(order?.id)) throw fail('zid_order_store_mismatch');
  if (order.payment_status !== 'paid') return [];
  if (order.order_status?.code === 'cancelled' || order.is_potential_fraud) throw fail('zid_order_needs_review');
  if (order.currency_code !== 'SAR') throw fail('zid_currency_mismatch');
  moneyMinor(order.order_total);
  if (!Array.isArray(order.products)) throw fail('zid_order_products_missing');
  const seen = new Set();
  return order.products.flatMap(line => {
    const plan = plans.find(p => p.productId === String(line.id || '').toLowerCase());
    if (!plan) return [];
    if (line.sku !== plan.sku || Number(line.quantity) !== 1 || !id(line.order_product_id) || seen.has(id(line.order_product_id))) {
      throw fail('zid_product_mismatch');
    }
    const fields = (Array.isArray(line.custom_fields) ? line.custom_fields : [])
      .filter(field => [field.label, field.name, field.group_name].some(value => text(value) === ZID_DEVICE_FIELD));
    if (fields.length !== 1 || !deviceId(fields[0].value)) throw fail('zid_device_id_missing');
    // Zid's API is the authority for legitimate store discounts. Zero-price orders are rejected.
    const amountMinor = moneyMinor(line.discounted_total ?? line.total);
    seen.add(id(line.order_product_id));
    return [{ lineId: id(line.order_product_id), deviceId: deviceId(fields[0].value), plan, amountMinor }];
  });
}

export function renewedExpiry(device, durationDays, now = new Date()) {
  if (!device || device.status === 'blocked' || device.data_deleted_at) throw fail('zid_device_unavailable');
  if (device.status === 'active' && device.expires_at == null) return { startsAt: now, expiresAt: null };
  const current = device.expires_at ? new Date(device.expires_at) : null;
  const startsAt = current && ['active', 'trial'].includes(device.status) && current > now ? current : now;
  return { startsAt, expiresAt: new Date(startsAt.getTime() + durationDays * 86400000) };
}

const ZID_SCHEMA = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_subscriptions_order_unique
  ON device_subscriptions(order_id) WHERE order_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS zid_license_grants (
  store_id TEXT NOT NULL, zid_order_id TEXT NOT NULL, zid_line_id TEXT NOT NULL,
  subscription_order_id UUID NOT NULL REFERENCES subscription_orders(id),
  fingerprint TEXT NOT NULL, payment_status TEXT NOT NULL DEFAULT 'paid',
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(store_id,zid_order_id,zid_line_id)
);`;

export function createZidPaymentHandlers({ pool, json, readJson, authorize, env = process.env, fetchImpl = globalThis.fetch }) {
  const enabled = env.BLOFY_ZID_ENABLED === 'true';
  const selected = env.BLOFY_PAYMENT_PROVIDER === 'zid';
  const storeId = id(env.BLOFY_ZID_STORE_ID);
  const secret = String(env.BLOFY_ZID_WEBHOOK_SECRET || '');
  const appAuthorization = String(env.BLOFY_ZID_AUTHORIZATION || '');
  const managerToken = String(env.BLOFY_ZID_MANAGER_TOKEN || '');
  const plans = parseZidPlans(env.BLOFY_ZID_PLANS_JSON);
  const configured = Boolean(enabled && storeId && secret.length >= 32 && appAuthorization && managerToken && plans.length);
  const purchasesAvailable = Boolean(configured && plans.every(p => p.productUrl));
  let ready;
  function ensureSchema() {
    if (!ready) ready = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(718420641)');
        await client.query(ADMIN_CONSOLE_SCHEMA);
        await client.query(ZID_SCHEMA);
        for (const plan of plans) {
          await client.query(`INSERT INTO subscription_plans(plan_key,name,duration_days,max_devices,price_minor,currency,active)
            VALUES($1,$2,$3,1,$4,'SAR',FALSE) ON CONFLICT(plan_key) DO UPDATE SET name=EXCLUDED.name,
            duration_days=EXCLUDED.duration_days,price_minor=EXCLUDED.price_minor,updated_at=NOW()`,
          [plan.planKey, plan.name, plan.durationDays, plan.priceMinor]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  async function retrieveOrder(orderId) {
    const response = await fetchImpl(`https://api.zid.sa/v1/managers/store/orders/${orderId}/view`, {
      headers: { authorization: appAuthorization, 'x-manager-token': managerToken, 'accept-language': 'en', accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw fail('zid_order_verification_unavailable', 503);
    const body = await response.json();
    const order = body?.order;
    if (id(order?.id) !== orderId || String(order?.store_id) !== storeId) throw fail('zid_order_store_mismatch');
    return order;
  }
  async function fulfill(orderId) {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`blofy-zid:${storeId}:${orderId}`]);
      // Re-read the order after the lock: delivery order and webhook payload fields are not authoritative.
      const order = await retrieveOrder(orderId);
      if (order.payment_status !== 'paid' || order.order_status?.code === 'cancelled' || order.is_potential_fraud) {
        const result = await client.query(`UPDATE zid_license_grants SET payment_status=$3,needs_review=TRUE,updated_at=NOW()
          WHERE store_id=$1 AND zid_order_id=$2 AND needs_review=FALSE RETURNING subscription_order_id`,
        [storeId, orderId, String(order.payment_status || 'unknown').slice(0, 40)]);
        for (const row of result.rows) await client.query(`INSERT INTO device_audit(device_id,actor,action,details)
          SELECT device_id,'zid','payment_needs_review',jsonb_build_object('zidOrderId',$2::text)
          FROM subscription_orders WHERE id=$1`, [row.subscription_order_id, orderId]);
        await client.query('COMMIT');
        return { received: true, paid: false, needsReview: result.rows.length > 0 };
      }
      const lines = licenseLines(order, plans, storeId);
      if (!lines.length) { await client.query('COMMIT'); return { received: true, ignored: true }; }
      const ids = [...new Set(lines.map(line => line.deviceId))].sort();
      const devices = (await client.query('SELECT device_id,status,expires_at,data_deleted_at FROM devices WHERE device_id=ANY($1::text[]) ORDER BY device_id FOR UPDATE', [ids])).rows;
      let granted = 0;
      for (const line of lines) {
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify([line.plan.productId,line.plan.sku,line.deviceId,line.plan.durationDays,line.amountMinor])).digest('hex');
        const existing = (await client.query('SELECT fingerprint,needs_review FROM zid_license_grants WHERE store_id=$1 AND zid_order_id=$2 AND zid_line_id=$3', [storeId,orderId,line.lineId])).rows[0];
        if (existing) {
          if (existing.fingerprint !== fingerprint || existing.needs_review) throw fail('zid_grant_needs_review');
          continue;
        }
        const device = devices.find(row => row.device_id === line.deviceId);
        const expiry = renewedExpiry(device, line.plan.durationDays);
        const localOrderId = crypto.randomUUID();
        await client.query(`INSERT INTO subscription_orders(id,device_id,plan_key,status,amount_minor,currency,payment_provider,provider_reference,paid_at)
          VALUES($1,$2,$3,'paid',$4,'SAR','zid',$5,NOW())`, [localOrderId,line.deviceId,line.plan.planKey,line.amountMinor,`${storeId}:${orderId}:${line.lineId}`]);
        await client.query(`INSERT INTO device_subscriptions(id,device_id,plan_key,order_id,starts_at,expires_at,status)
          VALUES($1,$2,$3,$4,$5,$6,'active')`, [crypto.randomUUID(),line.deviceId,line.plan.planKey,localOrderId,expiry.startsAt,expiry.expiresAt]);
        await client.query("UPDATE devices SET status='active',expires_at=$2,updated_at=NOW() WHERE device_id=$1", [line.deviceId,expiry.expiresAt]);
        await client.query('INSERT INTO zid_license_grants(store_id,zid_order_id,zid_line_id,subscription_order_id,fingerprint) VALUES($1,$2,$3,$4,$5)', [storeId,orderId,line.lineId,localOrderId,fingerprint]);
        await client.query(`INSERT INTO device_audit(device_id,actor,action,details) VALUES($1,'zid','payment_captured',jsonb_build_object('zidOrderId',$2::text,'planKey',$3::text))`, [line.deviceId,orderId,line.plan.planKey]);
        device.status = 'active'; device.expires_at = expiry.expiresAt;
        granted++;
      }
      await client.query('COMMIT');
      return { received: true, paid: true, granted, replayed: granted === 0 };
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function handler(req, res, url) {
    const path = url.pathname;
    if (path === '/api/v1/payments/zid/webhook') {
      if (req.method !== 'POST') { json(res,405,{error:'method_not_allowed'}); return true; }
      if (!configured) { json(res,503,{error:'zid_not_configured'}); return true; }
      const expected = 'Basic ' + Buffer.from('blofy-zid:' + secret).toString('base64');
      if (!equal(req.headers.authorization, expected)) { json(res,401,{error:'unauthorized_webhook'}); return true; }
      try {
        const orderId = orderIdFromZidPayload(await readJson(req));
        if (!orderId) throw fail('invalid_zid_order_id',400);
        json(res,200,await fulfill(orderId));
      } catch (error) { json(res,error.status || 503,{error:error.status ? error.message : 'zid_verification_failed'}); }
      return true;
    }
    if (!selected) return false;
    if (path === '/api/v1/subscriptions/plans' && req.method === 'GET') {
      json(res,200,{items:purchasesAvailable ? plans.map(({productId,sku,productUrl,...p}) => p) : [],purchasesAvailable,sandbox:false,provider:'zid'});
      return true;
    }
    if (path === '/api/v1/subscriptions/checkout' && req.method === 'POST') {
      if (!purchasesAvailable) { json(res,503,{error:'zid_checkout_unavailable'}); return true; }
      const body = await readJson(req);
      const authorizedId = await authorize(req,res,body);
      if (!authorizedId) return true;
      const plan = plans.find(p => p.planKey === body.planKey);
      if (!plan) { json(res,400,{error:'invalid_plan'}); return true; }
      json(res,200,{provider:'zid',checkoutUrl:plan.productUrl,deviceId:authorizedId,requiresDeviceId:true});
      return true;
    }
    return false;
  }
  handler.selected = selected;
  handler.configured = configured;
  handler.purchasesAvailable = purchasesAvailable;
  return handler;
}

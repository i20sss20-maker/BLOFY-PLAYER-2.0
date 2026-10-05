import crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHARGE_RE = /^chg_[A-Za-z0-9_-]{6,160}$/;
const FAILED = new Set(['FAILED','DECLINED','RESTRICTED','TIMEDOUT','UNKNOWN']);
const CANCELLED = new Set(['ABANDONED','CANCELLED','VOID']);

function clean(value, max = 128) {
  return String(value ?? '').trim().slice(0, max);
}

function email(value) {
  const result = clean(value, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : '';
}

function phone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 ? digits : '';
}

function minorUnits(currency) {
  return ['BHD','JOD','KWD','OMR'].includes(String(currency || '').toUpperCase()) ? 3 : 2;
}

export function formatTapAmount(value, currency = 'SAR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('invalid_amount');
  return amount.toFixed(minorUnits(currency));
}

export function tapWebhookHash(payload, secretKey) {
  const currency = clean(payload?.currency, 3).toUpperCase();
  const amount = formatTapAmount(payload?.amount, currency);
  const gateway = clean(payload?.reference?.gateway, 256);
  const payment = clean(payload?.reference?.payment, 256);
  const created = clean(payload?.transaction?.created ?? payload?.created, 64);
  const source =
    'x_id' + clean(payload?.id, 192) +
    'x_amount' + amount +
    'x_currency' + currency +
    'x_gateway_reference' + gateway +
    'x_payment_reference' + payment +
    'x_status' + clean(payload?.status, 64) +
    'x_created' + created;
  return crypto.createHmac('sha256', secretKey).update(source).digest('hex');
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function orderIdFromCharge(charge) {
  const candidates = [
    charge?.metadata?.blofy_order_id,
    charge?.metadata?.order_id,
    charge?.reference?.order
  ];
  return candidates.map(value => clean(value, 64)).find(value => UUID_RE.test(value)) || '';
}

function amountMinorFromCharge(charge) {
  const currency = clean(charge?.currency, 3).toUpperCase();
  const units = minorUnits(currency);
  const amount = Number(charge?.amount);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * (10 ** units));
}

function publicBaseUrl(env) {
  const base = clean(env.BLOFY_PAYMENT_BASE_URL || env.BLOFY_PUBLIC_BASE_URL || 'https://api.blofyplayer.com', 512);
  return base.replace(/\/+$/, '');
}

function customerObject(body, deviceId) {
  const source = body && typeof body.customer === 'object' && body.customer ? body.customer : {};
  const firstName = clean(source.firstName || source.first_name || 'BLOFY', 40) || 'BLOFY';
  const lastName = clean(source.lastName || source.last_name || 'PLAYER', 40) || 'PLAYER';
  const customerEmail = email(source.email) || 'payments@blofyplayer.com';
  const rawPhone = phone(source.phone?.number || source.phone || '');
  const countryCode = phone(source.phone?.countryCode || source.phone?.country_code || '966') || '966';
  const result = {
    first_name: firstName,
    last_name: lastName,
    email: customerEmail
  };
  if (rawPhone) result.phone = { country_code: countryCode, number: rawPhone };
  result.metadata = { device: deviceId };
  return result;
}

function html(res, status, title, message) {
  const escapedTitle = String(title).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const escapedMessage = String(message).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  const body = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedTitle}</title><style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Tahoma,sans-serif;background:#0f0820;color:#fff;display:grid;min-height:100vh;place-items:center}.card{width:min(92vw,560px);padding:32px;border-radius:24px;background:#1d1134;border:1px solid #6f48ad;text-align:center;box-shadow:0 24px 80px #0008}h1{margin:0 0 12px;font-size:28px}p{margin:0;color:#ddd;line-height:1.8}.brand{color:#b89cff;font-weight:800;margin-bottom:18px}</style></head><body><main class="card"><div class="brand">BLOFY PLAYER</div><h1>${escapedTitle}</h1><p>${escapedMessage}</p></main></body></html>`;
  res.writeHead(status, {
    'content-type':'text/html; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'x-frame-options':'DENY',
    'referrer-policy':'no-referrer',
    'strict-transport-security':'max-age=31536000'
  });
  res.end(body);
}

export function createTapPaymentHandlers({
  pool,
  json,
  readJson,
  authorize,
  schemaSql,
  env = process.env,
  fetchImpl = globalThis.fetch
}) {
  const secretKey = clean(env.TAP_SECRET_KEY, 512);
  const merchantId = clean(env.TAP_MERCHANT_ID, 128);
  const tapBase = clean(env.TAP_API_BASE_URL || 'https://api.tap.company/v2', 512).replace(/\/+$/, '');
  const baseUrl = publicBaseUrl(env);
  const sandbox = secretKey.startsWith('sk_test_');
  let schemaReady;

  const configured = Boolean(secretKey);

  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = (async () => {
        await pool.query(schemaSql);
        await pool.query(
          'CREATE UNIQUE INDEX IF NOT EXISTS idx_device_subscriptions_order_unique ON device_subscriptions(order_id) WHERE order_id IS NOT NULL'
        );
        await pool.query(
          'CREATE INDEX IF NOT EXISTS idx_subscription_orders_provider_reference ON subscription_orders(provider_reference) WHERE provider_reference IS NOT NULL'
        );
        if (sandbox) {
          await pool.query(
            `INSERT INTO subscription_plans(plan_key,name,duration_days,max_devices,price_minor,currency,active,sort_order)
             VALUES('tap-sandbox-30d','BLOFY PLAYER — Sandbox 30 days',30,1,100,'SAR',TRUE,-100)
             ON CONFLICT(plan_key) DO UPDATE SET name=EXCLUDED.name,duration_days=EXCLUDED.duration_days,
               max_devices=EXCLUDED.max_devices,price_minor=EXCLUDED.price_minor,currency=EXCLUDED.currency,
               active=TRUE,sort_order=EXCLUDED.sort_order,updated_at=NOW()`
          );
        }
      })().catch(error => {
        schemaReady = null;
        throw error;
      });
    }
    await schemaReady;
  }

  async function tapRequest(path, options = {}) {
    if (!configured) throw Object.assign(new Error('tap_not_configured'), {status:503});
    const response = await fetchImpl(tapBase + path, {
      ...options,
      headers: {
        accept:'application/json',
        authorization:'Bearer ' + secretKey,
        'content-type':'application/json',
        lang_code:'ar',
        ...(options.headers || {})
      },
      signal: AbortSignal.timeout(15_000)
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error('tap_request_failed');
      error.status = response.status >= 500 ? 502 : 400;
      error.tapStatus = response.status;
      error.tapCode = clean(payload?.errors?.[0]?.code || payload?.response?.code || payload?.error, 80);
      throw error;
    }
    return payload;
  }

  async function retrieveCharge(chargeId) {
    if (!CHARGE_RE.test(chargeId)) throw Object.assign(new Error('invalid_charge_id'), {status:400});
    return tapRequest('/charges/' + encodeURIComponent(chargeId), {method:'GET'});
  }

  async function listPlans(res) {
    await ensureSchema();
    if (!configured) return json(res, 200, {items:[],purchasesAvailable:false,sandbox:false});
    const where = sandbox ? 'active=TRUE' : "active=TRUE AND plan_key NOT LIKE 'tap-sandbox-%'";
    const result = await pool.query(
      `SELECT plan_key,name,duration_days,max_devices,price_minor,currency
       FROM subscription_plans WHERE ${where} ORDER BY sort_order,price_minor,plan_key`
    );
    const items = result.rows.map(row => ({
      planKey:row.plan_key,
      name:row.name,
      durationDays:row.duration_days == null ? null : Number(row.duration_days),
      maxDevices:Number(row.max_devices),
      priceMinor:Number(row.price_minor),
      currency:row.currency
    }));
    return json(res, 200, {items,purchasesAvailable:items.length > 0,sandbox});
  }

  async function markOrderFailure(orderId, status, providerStatus, providerReference = null) {
    await pool.query(
      `UPDATE subscription_orders
       SET status=CASE WHEN status='paid' THEN status ELSE $2 END,
           payment_provider='tap',
           provider_reference=COALESCE(provider_reference,$3),
           updated_at=NOW()
       WHERE id=$1`,
      [orderId, status, providerReference]
    );
    if (providerStatus) {
      await pool.query(
        `INSERT INTO device_audit(device_id,actor,action,details)
         SELECT device_id,'tap','payment_status',jsonb_build_object('orderId',id::text,'status',$2::text)
         FROM subscription_orders WHERE id=$1`,
        [orderId, providerStatus]
      ).catch(() => {});
    }
  }

  async function fulfillCapturedCharge(charge) {
    await ensureSchema();
    const orderId = orderIdFromCharge(charge);
    if (!orderId) throw Object.assign(new Error('tap_order_reference_missing'), {status:409});
    const chargeId = clean(charge?.id, 192);
    if (!CHARGE_RE.test(chargeId)) throw Object.assign(new Error('invalid_charge_id'), {status:400});

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT o.*,p.duration_days,p.name AS plan_name
         FROM subscription_orders o
         JOIN subscription_plans p ON p.plan_key=o.plan_key
         WHERE o.id=$1 FOR UPDATE OF o`,
        [orderId]
      );
      const order = result.rows[0];
      if (!order) throw Object.assign(new Error('payment_order_not_found'), {status:404});
      if (order.provider_reference && order.provider_reference !== chargeId) {
        throw Object.assign(new Error('payment_reference_mismatch'), {status:409});
      }
      const amountMinor = amountMinorFromCharge(charge);
      if (amountMinor !== Number(order.amount_minor) || clean(charge?.currency,3).toUpperCase() !== String(order.currency).toUpperCase()) {
        throw Object.assign(new Error('payment_amount_mismatch'), {status:409});
      }
      if (order.status === 'paid') {
        await client.query('COMMIT');
        return {orderId,deviceId:order.device_id,paid:true,replayed:true};
      }
      if (clean(charge?.status,32).toUpperCase() !== 'CAPTURED') {
        throw Object.assign(new Error('payment_not_captured'), {status:409});
      }

      const device = (await client.query('SELECT status,expires_at FROM devices WHERE device_id=$1 FOR UPDATE',[order.device_id])).rows[0];
      if (!device || device.status === 'blocked') throw Object.assign(new Error('payment_device_unavailable'), {status:409});

      const now = new Date();
      let startsAt = now;
      if (device.expires_at && new Date(device.expires_at).getTime() > now.getTime() && ['active','trial'].includes(device.status)) {
        startsAt = new Date(device.expires_at);
      }
      const expiresAt = order.duration_days == null
        ? null
        : new Date(startsAt.getTime() + Number(order.duration_days) * 86_400_000);

      await client.query(
        `UPDATE subscription_orders SET status='paid',payment_provider='tap',provider_reference=$2,paid_at=NOW(),updated_at=NOW()
         WHERE id=$1`,
        [orderId,chargeId]
      );
      await client.query(
        `INSERT INTO device_subscriptions(id,device_id,plan_key,order_id,starts_at,expires_at,status)
         VALUES($1,$2,$3,$4,$5,$6,'active')
         ON CONFLICT(order_id) WHERE order_id IS NOT NULL DO NOTHING`,
        [crypto.randomUUID(),order.device_id,order.plan_key,orderId,startsAt,expiresAt]
      );
      await client.query(
        `UPDATE devices SET status='active',expires_at=$2,updated_at=NOW() WHERE device_id=$1`,
        [order.device_id,expiresAt]
      );
      await client.query(
        `INSERT INTO device_audit(device_id,actor,action,details)
         VALUES($1,'tap','payment_captured',jsonb_build_object('orderId',$2::text,'chargeId',$3::text,'planKey',$4::text))`,
        [order.device_id,orderId,chargeId,order.plan_key]
      ).catch(() => {});
      await client.query('COMMIT');
      return {
        orderId,
        deviceId:order.device_id,
        paid:true,
        replayed:false,
        expiresAt:expiresAt ? expiresAt.getTime() : null
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function reconcileCharge(charge) {
    const status = clean(charge?.status, 32).toUpperCase();
    const orderId = orderIdFromCharge(charge);
    if (!orderId) throw Object.assign(new Error('tap_order_reference_missing'), {status:409});
    if (status === 'CAPTURED') return fulfillCapturedCharge(charge);
    const mapped = CANCELLED.has(status) ? 'cancelled' : FAILED.has(status) ? 'failed' : 'pending';
    await markOrderFailure(orderId, mapped, status || 'UNKNOWN', clean(charge?.id,192) || null);
    return {orderId,paid:false,status};
  }

  async function checkout(req, res) {
    await ensureSchema();
    if (!configured) return json(res, 503, {error:'tap_not_configured'});
    const body = await readJson(req);
    const deviceId = await authorize(req, res, body);
    if (!deviceId) return;
    const planKey = clean(body.planKey, 80);
    const planResult = await pool.query(
      `SELECT plan_key,name,duration_days,max_devices,price_minor,currency
       FROM subscription_plans WHERE plan_key=$1 AND active=TRUE`,
      [planKey]
    );
    const plan = planResult.rows[0];
    if (!plan || (!sandbox && plan.plan_key.startsWith('tap-sandbox-'))) {
      return json(res, 404, {error:'plan_not_found'});
    }
    const orderId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO subscription_orders(id,device_id,plan_key,status,amount_minor,currency,payment_provider)
       VALUES($1,$2,$3,'pending',$4,$5,'tap')`,
      [orderId,deviceId,plan.plan_key,plan.price_minor,plan.currency]
    );

    const amount = Number(plan.price_minor) / (10 ** minorUnits(plan.currency));
    const referenceToken = orderId.replaceAll('-','').slice(0,24);
    const requestBody = {
      amount,
      currency:String(plan.currency).toUpperCase(),
      customer_initiated:true,
      threeDSecure:true,
      save_card:false,
      description:('BLOFY PLAYER - ' + plan.name).slice(0,255),
      metadata:{
        blofy_order_id:orderId,
        blofy_device_id:deviceId,
        blofy_plan_key:plan.plan_key
      },
      reference:{
        transaction:'blofy_' + referenceToken,
        order:orderId,
        idempotent:orderId
      },
      receipt:{email:false,sms:false},
      customer:customerObject(body,deviceId),
      source:{id:'src_all'},
      post:{url:baseUrl + '/api/v1/payments/tap/webhook'},
      redirect:{url:baseUrl + '/api/v1/payments/tap/redirect'}
    };
    if (merchantId) requestBody.merchant = {id:merchantId};

    try {
      const charge = await tapRequest('/charges/', {method:'POST',body:JSON.stringify(requestBody)});
      const chargeId = clean(charge?.id,192);
      if (chargeId && CHARGE_RE.test(chargeId)) {
        await pool.query(
          `UPDATE subscription_orders SET provider_reference=$2,updated_at=NOW() WHERE id=$1`,
          [orderId,chargeId]
        );
      }
      if (clean(charge?.status,32).toUpperCase() === 'CAPTURED') {
        await fulfillCapturedCharge(charge);
      }
      const checkoutUrl = clean(charge?.transaction?.url, 2048);
      if (!checkoutUrl && clean(charge?.status,32).toUpperCase() !== 'CAPTURED') {
        await markOrderFailure(orderId,'failed','NO_CHECKOUT_URL',chargeId || null);
        return json(res, 502, {error:'tap_checkout_unavailable'});
      }
      return json(res, 201, {
        orderId,
        chargeId:chargeId || null,
        checkoutUrl:checkoutUrl || null,
        status:clean(charge?.status,32) || 'UNKNOWN',
        sandbox
      });
    } catch (error) {
      await markOrderFailure(orderId,'failed',error.tapCode || error.message || 'CREATE_FAILED');
      return json(res, error.status || 502, {
        error:'payment_initialization_failed',
        providerCode:error.tapCode || undefined
      });
    }
  }

  async function webhook(req, res) {
    await ensureSchema();
    if (!configured) return json(res, 503, {error:'tap_not_configured'});
    const payload = await readJson(req);
    const postedHash = clean(req.headers.hashstring, 256);
    if (!postedHash) return json(res, 401, {error:'missing_hashstring'});
    const expected = tapWebhookHash(payload, secretKey);
    if (!constantTimeEqual(postedHash, expected)) return json(res, 401, {error:'invalid_hashstring'});
    const chargeId = clean(payload?.id,192);
    if (!CHARGE_RE.test(chargeId)) return json(res, 400, {error:'invalid_charge_id'});
    const verified = await retrieveCharge(chargeId);
    await reconcileCharge(verified);
    return json(res, 200, {received:true});
  }

  async function redirect(req, res, url) {
    if (!configured) return html(res,503,'الدفع غير متاح','بوابة الدفع غير مهيأة حاليًا.');
    const chargeId = clean(url.searchParams.get('tap_id'),192);
    if (!CHARGE_RE.test(chargeId)) return html(res,400,'تعذر التحقق','رقم عملية الدفع غير صالح.');
    try {
      const charge = await retrieveCharge(chargeId);
      const result = await reconcileCharge(charge);
      if (result.paid) {
        return html(res,200,'تم الدفع بنجاح','تم تفعيل اشتراك BLOFY PLAYER على جهازك. يمكنك الرجوع للتطبيق الآن.');
      }
      return html(res,200,'لم يكتمل الدفع','حالة العملية: ' + clean(charge?.status,32) + '. لم يتم تفعيل الاشتراك.');
    } catch {
      return html(res,502,'تعذر التحقق من الدفع','لم نستطع التحقق من العملية الآن. إذا تم الخصم فسيتم تحديث الاشتراك تلقائيًا عبر إشعار الدفع.');
    }
  }

  async function statusForDevice(deviceId) {
    await ensureSchema();
    const row = (await pool.query(
      `SELECT s.plan_key,p.name,s.starts_at,s.expires_at,s.status,o.id AS order_id
       FROM device_subscriptions s
       JOIN subscription_plans p ON p.plan_key=s.plan_key
       LEFT JOIN subscription_orders o ON o.id=s.order_id
       WHERE s.device_id=$1 AND s.status='active'
       ORDER BY s.created_at DESC LIMIT 1`,
      [deviceId]
    )).rows[0];
    return row ? {
      planKey:row.plan_key,
      planName:row.name,
      startsAt:new Date(row.starts_at).getTime(),
      expiresAt:row.expires_at ? new Date(row.expires_at).getTime() : null,
      orderId:row.order_id || null
    } : null;
  }

  async function handler(req, res, url) {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/v1/subscriptions/plans') {
      await listPlans(res);
      return true;
    }
    if (req.method === 'POST' && path === '/api/v1/subscriptions/checkout') {
      await checkout(req,res);
      return true;
    }
    if (req.method === 'POST' && path === '/api/v1/payments/tap/webhook') {
      await webhook(req,res);
      return true;
    }
    if (req.method === 'GET' && path === '/api/v1/payments/tap/redirect') {
      await redirect(req,res,url);
      return true;
    }
    return false;
  }

  handler.configured = configured;
  handler.sandbox = sandbox;
  handler.statusForDevice = statusForDevice;
  return handler;
}

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

export function parseConfiguredPlans(raw) {
  const source = String(raw || '').trim();
  if (!source) return [];
  let value;
  try { value = JSON.parse(source); } catch { throw new Error('invalid_payment_plans_json'); }
  if (!Array.isArray(value) || value.length > 20) throw new Error('invalid_payment_plans_json');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_payment_plan');
    const planKey = clean(item.planKey ?? item.plan_key, 80).toLowerCase();
    const name = clean(item.name, 120);
    const durationSource = item.durationDays ?? item.duration_days;
    const durationDays = durationSource == null || durationSource === '' ? null : Number(durationSource);
    const maxDevices = Number(item.maxDevices ?? item.max_devices ?? 1);
    const priceMinor = Number(item.priceMinor ?? item.price_minor);
    const currency = clean(item.currency || 'SAR', 3).toUpperCase();
    const sortOrder = Number(item.sortOrder ?? item.sort_order ?? index);
    if (!/^tap-live-[a-z0-9][a-z0-9-]{1,60}$/.test(planKey) || !name) throw new Error('invalid_payment_plan');
    if (durationDays !== null && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650)) throw new Error('invalid_payment_plan');
    if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 50) throw new Error('invalid_payment_plan');
    if (!Number.isInteger(priceMinor) || priceMinor < 1 || priceMinor > 100000000) throw new Error('invalid_payment_plan');
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100000) throw new Error('invalid_payment_plan');
    return {
      planKey,
      name,
      durationDays,
      maxDevices,
      priceMinor,
      currency,
      active:item.active !== false,
      sortOrder
    };
  });
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
  return result;
}

function customerRecord(source) {
  const value = source && typeof source === 'object' ? source : {};
  const firstName = clean(value.firstName || value.first_name, 80);
  const lastName = clean(value.lastName || value.last_name, 80);
  const name = clean(value.name || [firstName,lastName].filter(Boolean).join(' '), 160);
  const customerEmail = email(value.email);
  const rawPhone = phone(value.phone?.number || value.phone || '');
  const countryCode = phone(value.phone?.countryCode || value.phone?.country_code || '966') || '966';
  const customerPhone = rawPhone ? (rawPhone.startsWith(countryCode) ? rawPhone : countryCode + rawPhone.replace(/^0+/,'')) : '';
  return {name, email:customerEmail, phone:customerPhone};
}

async function upsertTapCustomer(db, deviceId, source, reference) {
  const customer = customerRecord(source);
  await db.query(
    `INSERT INTO device_customers(device_id,customer_name,customer_email,customer_phone,source,last_order_reference)
     VALUES($1,NULLIF($2,''),NULLIF($3,''),NULLIF($4,''),'tap',$5)
     ON CONFLICT(device_id) DO UPDATE SET
       customer_name=COALESCE(NULLIF(EXCLUDED.customer_name,''),device_customers.customer_name),
       customer_email=COALESCE(NULLIF(EXCLUDED.customer_email,''),device_customers.customer_email),
       customer_phone=COALESCE(NULLIF(EXCLUDED.customer_phone,''),device_customers.customer_phone),
       source='tap',
       last_order_reference=EXCLUDED.last_order_reference,
       updated_at=NOW()`,
    [deviceId,customer.name,customer.email,customer.phone,reference]
  );
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
  const livePlans = sandbox ? [] : parseConfiguredPlans(env.BLOFY_PAYMENT_PLANS_JSON);
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
        } else {
          for (const plan of livePlans) {
            await pool.query(
              `INSERT INTO subscription_plans(plan_key,name,duration_days,max_devices,price_minor,currency,active,sort_order)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT(plan_key) DO UPDATE SET name=EXCLUDED.name,duration_days=EXCLUDED.duration_days,
                 max_devices=EXCLUDED.max_devices,price_minor=EXCLUDED.price_minor,currency=EXCLUDED.currency,
                 active=EXCLUDED.active,sort_order=EXCLUDED.sort_order,updated_at=NOW()`,
              [plan.planKey,plan.name,plan.durationDays,plan.maxDevices,plan.priceMinor,plan.currency,plan.active,plan.sortOrder]
            );
          }
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
    const where = sandbox
      ? "active=TRUE AND plan_key LIKE 'tap-sandbox-%'"
      : "active=TRUE AND plan_key NOT LIKE 'tap-sandbox-%'";
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
      await upsertTapCustomer(client, order.device_id, charge?.customer, chargeId);
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
    if (!plan || (sandbox ? !plan.plan_key.startsWith('tap-sandbox-') : plan.plan_key.startsWith('tap-sandbox-'))) {
      return json(res, 404, {error:'plan_not_found'});
    }
    const orderId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO subscription_orders(id,device_id,plan_key,status,amount_minor,currency,payment_provider)
       VALUES($1,$2,$3,'pending',$4,$5,'tap')`,
      [orderId,deviceId,plan.plan_key,plan.price_minor,plan.currency]
    );
    await upsertTapCustomer(pool, deviceId, body.customer, orderId);

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


  async function sandboxTestCheckout(req, res) {
    await ensureSchema();
    if (!configured || !sandbox) return json(res, 404, {error:'sandbox_unavailable'});

    let body = {};
    try { body = await readJson(req); } catch {}

    const plan = (await pool.query(
      `SELECT plan_key,name,duration_days,max_devices,price_minor,currency
       FROM subscription_plans WHERE plan_key='tap-sandbox-30d' AND active=TRUE`
    )).rows[0];
    if (!plan) return json(res, 503, {error:'sandbox_plan_unavailable'});

    const token = crypto.randomBytes(4).toString('hex').toUpperCase();
    const deviceId = 'BLOFY-' + token.slice(0,4) + '-' + token.slice(4,8);
    await pool.query(
      `INSERT INTO devices(device_id,activation_code,status,expires_at,last_seen_at,last_app_version,last_platform)
       VALUES($1,'sandbox-test-only','expired',NOW(),NOW(),'tap-sandbox','web-test')
       ON CONFLICT(device_id) DO NOTHING`,
      [deviceId]
    );

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
      description:'BLOFY PLAYER - Tap Sandbox Test',
      metadata:{
        blofy_order_id:orderId,
        blofy_device_id:deviceId,
        blofy_plan_key:plan.plan_key,
        blofy_sandbox_test:'true'
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
        sandbox:true,
        testDeviceId:deviceId
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
        if (String(charge?.metadata?.blofy_sandbox_test || '') === 'true') {
          return html(res,200,'نجح اختبار Tap','تمت عملية الدفع التجريبية بنجاح في Sandbox بدون خصم حقيقي.');
        }
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

  function servePayPage(res) {
    const body = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BLOFY PLAYER — الدفع</title>
<style>
:root{color-scheme:dark;--bg:#0e0819;--card:#1b102f;--line:#6d45a9;--accent:#b598f5;--muted:#bdb5ca}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#2a1450 0,#0e0819 48%);font-family:system-ui,-apple-system,Segoe UI,Tahoma,sans-serif;color:#fff}
.wrap{width:min(94vw,760px);margin:auto;padding:48px 0}.brand{text-align:center;font-weight:900;letter-spacing:.08em;color:var(--accent);font-size:20px}.card{margin-top:18px;background:#1b102fee;border:1px solid #6d45a977;border-radius:26px;padding:26px;box-shadow:0 28px 90px #0008}
h1{font-size:30px;margin:0 0 8px;text-align:center}.lead{color:var(--muted);text-align:center;line-height:1.8;margin:0 0 22px}.sandbox{display:none;margin:0 0 18px;padding:11px 14px;border-radius:14px;background:#d49b1b20;border:1px solid #d49b1b66;color:#ffd77b;text-align:center;font-weight:700}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field{display:grid;gap:7px}.field.full{grid-column:1/-1}label{font-size:13px;color:#d5cfe0}input{width:100%;border:1px solid #ffffff22;background:#0d0818;color:#fff;border-radius:14px;padding:14px 15px;font:inherit;outline:none}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px #b598f522}
.plans{display:grid;gap:12px;margin-top:20px}.plan{display:flex;align-items:center;justify-content:space-between;gap:16px;border:1px solid #ffffff1f;background:#120a21;border-radius:16px;padding:16px;cursor:pointer}.plan:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 3px #b598f51c}.plan strong{display:block}.plan small{color:var(--muted)}.price{font-weight:900;color:#d9c8ff;white-space:nowrap}
button{width:100%;margin-top:20px;border:0;border-radius:15px;padding:15px;font:inherit;font-weight:900;cursor:pointer;background:linear-gradient(135deg,#8458d8,#b987f0);color:#fff}button:disabled{opacity:.5;cursor:wait}.status{min-height:28px;margin-top:14px;text-align:center;color:#e2dceb}.foot{font-size:12px;color:#8e849e;text-align:center;margin-top:18px;line-height:1.8}
@media(max-width:620px){.wrap{padding:22px 0}.card{padding:20px}.grid{grid-template-columns:1fr}.field.full{grid-column:auto}h1{font-size:25px}}
</style>
</head>
<body>
<main class="wrap">
  <div class="brand">BLOFY PLAYER</div>
  <section class="card">
    <h1>تفعيل وتجديد الاشتراك</h1>
    <p class="lead">أدخل بيانات جهازك، اختر الباقة، وبعدها تنتقل لصفحة Tap الآمنة لإكمال الدفع.</p>
    <div class="sandbox" id="sandbox">وضع تجريبي — لن يتم خصم مبلغ حقيقي</div>
    <div class="grid">
      <div class="field"><label for="deviceId">رقم الجهاز</label><input id="deviceId" autocomplete="off" placeholder="BLOFY-XXXX-XXXX"></div>
      <div class="field"><label for="activationCode">كود التفعيل</label><input id="activationCode" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="••••••"></div>
      <div class="field"><label for="firstName">الاسم</label><input id="firstName" autocomplete="name" maxlength="80" placeholder="اسم العميل"></div>
      <div class="field"><label for="phone">رقم الجوال</label><input id="phone" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="05xxxxxxxx"></div>
      <div class="field full"><label for="email">البريد الإلكتروني</label><input id="email" type="email" autocomplete="email" maxlength="254" placeholder="اختياري"></div>
    </div>
    <div class="plans" id="plans"></div>
    <button id="pay" disabled>متابعة إلى الدفع</button>
    <button id="testPay" style="display:none;background:#23143d;border:1px solid #b598f566">اختبار Tap بدون رقم جهاز</button>
    <div class="status" id="status"></div>
    <div class="foot">بيانات البطاقة لا تمر عبر BLOFY PLAYER؛ يتم إدخالها مباشرة في صفحة Tap. لا تشارك كود التفعيل مع أي شخص.</div>
  </section>
</main>
<script>
(function(){
  const $=id=>document.getElementById(id);
  const status=$('status'), pay=$('pay'), testPay=$('testPay'), plans=$('plans');
  function setStatus(text){status.textContent=text||''}
  function fillFragment(){
    const p=new URLSearchParams(location.hash.replace(/^#/,''));
    if(p.get('deviceId')) $('deviceId').value=p.get('deviceId');
    if(p.get('code')) $('activationCode').value=p.get('code');
  }
  function price(item){
    const n=(Number(item.priceMinor||0)/100).toFixed(2);
    return n+' '+String(item.currency||'SAR');
  }
  async function loadPlans(){
    setStatus('جاري تحميل الباقات…');
    const r=await fetch('/api/v1/subscriptions/plans',{headers:{accept:'application/json'}});
    const data=await r.json();
    if(data.sandbox){$('sandbox').style.display='block';testPay.style.display='block';}
    plans.innerHTML='';
    (data.items||[]).forEach((item,index)=>{
      const label=document.createElement('label');
      label.className='plan';
      label.innerHTML='<span><strong></strong><small></small></span><span class="price"></span><input type="radio" name="plan" hidden>';
      label.querySelector('strong').textContent=item.name;
      label.querySelector('small').textContent=item.durationDays ? item.durationDays+' يوم' : 'بدون تاريخ انتهاء';
      label.querySelector('.price').textContent=price(item);
      const radio=label.querySelector('input');
      radio.value=item.planKey;
      radio.checked=index===0;
      radio.addEventListener('change',()=>pay.disabled=false);
      plans.appendChild(label);
    });
    pay.disabled=!(data.items||[]).length;
    setStatus((data.items||[]).length?'':'لا توجد باقات متاحة حاليًا.');
  }
  testPay.addEventListener('click',async()=>{
    testPay.disabled=true;pay.disabled=true;setStatus('جاري تجهيز اختبار Tap…');
    try{
      const response=await fetch('/api/v1/payments/tap/test-checkout',{
        method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({customer:{firstName:$('firstName').value.trim()||undefined,phone:$('phone').value.trim()||undefined,email:$('email').value.trim()||undefined}})
      });
      const data=await response.json();
      if(!response.ok){setStatus('تعذر تجهيز اختبار Tap. حاول مرة أخرى.');testPay.disabled=false;pay.disabled=false;return}
      if(data.checkoutUrl){location.assign(data.checkoutUrl);return}
      if(String(data.status||'').toUpperCase()==='CAPTURED'){setStatus('نجح اختبار Tap.');return}
      setStatus('تعذر فتح صفحة Tap.');testPay.disabled=false;pay.disabled=false;
    }catch(_){setStatus('تعذر الاتصال بالخادم. حاول مرة أخرى.');testPay.disabled=false;pay.disabled=false}
  });
  pay.addEventListener('click',async()=>{
    const deviceId=$('deviceId').value.trim();
    const activationCode=$('activationCode').value.trim();
    const planKey=document.querySelector('input[name=plan]:checked')?.value;
    const customerName=$('firstName').value.trim();
    const customerPhone=$('phone').value.trim();
    if(!/^BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(deviceId)){setStatus('تحقق من رقم الجهاز.');return}
    if(!/^\\d{6}$/.test(activationCode)){setStatus('كود التفعيل يجب أن يكون 6 أرقام.');return}
    if(customerName.length<2){setStatus('اكتب اسم العميل.');return}
    if(customerPhone.replace(/\\D/g,'').length<9){setStatus('تحقق من رقم الجوال.');return}
    if(!planKey){setStatus('اختر باقة أولًا.');return}
    pay.disabled=true;setStatus('جاري تجهيز عملية الدفع…');
    try{
      const response=await fetch('/api/v1/subscriptions/checkout',{
        method:'POST',headers:{'content-type':'application/json',accept:'application/json'},
        body:JSON.stringify({
          deviceId,activationCode,planKey,
          customer:{firstName:customerName,phone:customerPhone,email:$('email').value.trim()||undefined}
        })
      });
      const data=await response.json();
      if(!response.ok){
        setStatus(response.status===403?'رقم الجهاز أو كود التفعيل غير صحيح.':'تعذر تجهيز الدفع. حاول مرة أخرى.');
        pay.disabled=false;return;
      }
      if(data.checkoutUrl){location.assign(data.checkoutUrl);return}
      if(String(data.status||'').toUpperCase()==='CAPTURED'){setStatus('تم الدفع والتفعيل بنجاح.');return}
      setStatus('تعذر فتح صفحة الدفع.');pay.disabled=false;
    }catch(_){setStatus('تعذر الاتصال بالخادم. حاول مرة أخرى.');pay.disabled=false}
  });
  fillFragment();
  loadPlans().catch(()=>{setStatus('تعذر تحميل الباقات.');pay.disabled=true});
})();
</script>
</body></html>`;
    res.writeHead(200,{
      'content-type':'text/html; charset=utf-8',
      'content-length':Buffer.byteLength(body),
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'x-frame-options':'DENY',
      'referrer-policy':'no-referrer',
      'permissions-policy':'camera=(), microphone=(), geolocation=()',
      'strict-transport-security':'max-age=31536000',
      'content-security-policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
    });
    res.end(body);
  }

  async function handler(req, res, url) {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/pay') {
      servePayPage(res);
      return true;
    }
    if (req.method === 'GET' && path === '/api/v1/subscriptions/plans') {
      await listPlans(res);
      return true;
    }
    if (req.method === 'POST' && path === '/api/v1/subscriptions/checkout') {
      await checkout(req,res);
      return true;
    }
    if (req.method === 'POST' && path === '/api/v1/payments/tap/test-checkout') {
      await sandboxTestCheckout(req,res);
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

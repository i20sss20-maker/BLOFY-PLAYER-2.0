import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import {
  createActivationCredentialCodec,
  createFixedWindowLimiter,
  isAuthLocked,
  nextAuthFailureState,
  requestClientKey
} from './auth-protection.mjs';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const KEY_HEX = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const STORE_URL = String(process.env.BLOFY_ZID_STORE_URL || 'https://blofy-sat.zid.store').trim().replace(/\/+$/, '');
const WEBHOOK_USER = String(process.env.ZID_WEBHOOK_USERNAME || '').trim();
const WEBHOOK_PASSWORD = String(process.env.ZID_WEBHOOK_PASSWORD || '').trim();
const AUTH_RATE_WINDOW_MS = Number(process.env.BLOFY_AUTH_RATE_WINDOW_MS || 60_000);
const AUTH_IP_RATE_LIMIT = Number(process.env.BLOFY_AUTH_IP_RATE_LIMIT || 60);
const AUTH_DEVICE_RATE_LIMIT = Number(process.env.BLOFY_AUTH_DEVICE_RATE_LIMIT || 20);
const AUTH_MAX_FAILURES = Number(process.env.BLOFY_AUTH_MAX_FAILURES || 5);
const AUTH_FAILURE_WINDOW_MS = Number(process.env.BLOFY_AUTH_FAILURE_WINDOW_MS || 900_000);
const AUTH_LOCK_MS = Number(process.env.BLOFY_AUTH_LOCK_MS || 900_000);

const UUIDISH_RE = /^[A-Za-z0-9_-]{6,128}$/;
const DEVICE_RE = /^BLOFY-[A-Z0-9-]{4,32}$/i;
const CODE_RE = /^\d{6}$/;

function clean(value, max = 256) {
  return String(value ?? '').trim().slice(0, max);
}

function safeHttpsUrl(value) {
  const raw = clean(value, 1024);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function parseZidProducts(raw) {
  const source = String(raw || '').trim();
  if (!source) return [];
  let value;
  try { value = JSON.parse(source); } catch { throw new Error('invalid_zid_products_json'); }
  if (!Array.isArray(value) || value.length > 20) throw new Error('invalid_zid_products_json');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_zid_product');
    const planKey = clean(item.planKey ?? item.plan_key, 80).toLowerCase();
    const name = clean(item.name, 120);
    const durationDays = Number(item.durationDays ?? item.duration_days);
    const productId = clean(item.productId ?? item.product_id, 128);
    const sku = clean(item.sku, 128);
    const productUrlSource = clean(item.productUrl ?? item.product_url ?? item.url, 1024);
    const productUrl = safeHttpsUrl(productUrlSource);
    const priceLabel = clean(item.priceLabel ?? item.price_label, 80);
    const sortOrder = Number(item.sortOrder ?? item.sort_order ?? index);
    if (!/^zid-[a-z0-9][a-z0-9-]{1,60}$/.test(planKey)) throw new Error('invalid_zid_product');
    if (!name || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) throw new Error('invalid_zid_product');
    if (!productId && !sku) throw new Error('invalid_zid_product');
    if (productId && !UUIDISH_RE.test(productId)) throw new Error('invalid_zid_product');
    if (productUrlSource && !productUrl) throw new Error('invalid_zid_product');
    if (!Number.isInteger(sortOrder) || Math.abs(sortOrder) > 100000) throw new Error('invalid_zid_product');
    return {
      planKey,
      name,
      durationDays,
      productId,
      sku,
      productUrl,
      priceLabel,
      active: item.active !== false,
      sortOrder
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.planKey.localeCompare(b.planKey));
}

export function extractZidOrder(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
  if (data?.order && typeof data.order === 'object') return data.order;
  if (payload.order && typeof payload.order === 'object') return payload.order;
  if (data && (data.id || data.invoice_number || data.products)) return data;
  return payload;
}

export function extractDeviceIdFromProduct(product) {
  const fields = Array.isArray(product?.custom_fields) ? product.custom_fields : [];
  for (const field of fields) {
    const value = clean(field?.value ?? field?.formatted_value, 96).toUpperCase();
    if (DEVICE_RE.test(value)) return value;
  }
  const candidates = [
    product?.meta?.blofy_device_id,
    product?.metadata?.blofy_device_id,
    product?.blofy_device_id
  ];
  for (const candidate of candidates) {
    const value = clean(candidate, 96).toUpperCase();
    if (DEVICE_RE.test(value)) return value;
  }
  return '';
}

function productIdentity(product) {
  return {
    id: clean(product?.id ?? product?.product_id, 128),
    sku: clean(product?.sku, 128)
  };
}

export function matchZidPlan(product, plans) {
  const identity = productIdentity(product);
  return plans.find(plan =>
    (plan.productId && identity.id && plan.productId === identity.id) ||
    (plan.sku && identity.sku && plan.sku === identity.sku)
  ) || null;
}

function orderIdFrom(order) {
  return clean(order?.id ?? order?.invoice_number ?? order?.code, 128);
}

function paymentStatusFrom(order, payload) {
  return clean(
    order?.payment_status ??
    order?.payment?.status ??
    payload?.payment_status ??
    payload?.data?.payment_status,
    32
  ).toLowerCase();
}

function eventNameFrom(payload) {
  return clean(payload?.event ?? payload?.type ?? payload?.topic, 96).toLowerCase();
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyWebhookBasicAuth(req) {
  if (!WEBHOOK_USER || !WEBHOOK_PASSWORD) return false;
  const expected = 'Basic ' + Buffer.from(WEBHOOK_USER + ':' + WEBHOOK_PASSWORD).toString('base64');
  return constantTimeEqual(req.headers.authorization || '', expected);
}

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra
  });
  res.end(payload);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 256_000) throw Object.assign(new Error('payload_too_large'), { status: 413 });
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function paymentPage() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b0712">
<title>BLOFY PLAYER — الدفع والتجديد</title>
<style>
:root{color-scheme:dark;--bg:#07070d;--card:#14101f;--line:#312442;--accent:#8b37ff;--muted:#aaa4b7;--good:#52df9a;--bad:#ff8793}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 85% 0,#3b176944,transparent 36rem),var(--bg);color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Tahoma,Arial,sans-serif}
main{width:min(760px,calc(100% - 28px));margin:0 auto;padding:36px 0 60px}.brand{display:flex;align-items:center;gap:12px;margin-bottom:34px}.brand img{width:52px;height:52px;object-fit:contain}.brand strong{font-size:20px}.brand span{display:block;color:#b995ef;font-size:12px;margin-top:3px}
.card{border:1px solid var(--line);border-radius:24px;background:linear-gradient(155deg,#1a1428ee,#0d0b13ee);padding:24px;box-shadow:0 24px 80px #0006}.card+.card{margin-top:16px}
h1{margin:0 0 9px;font-size:28px}p{margin:0;color:var(--muted);line-height:1.8}.device{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;margin-top:18px;padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:#0c0912}.device code{direction:ltr;font-weight:800;color:#e8dcff}
button,a.plan{font:inherit}.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}.plan{min-height:110px;padding:16px;border:1px solid var(--line);border-radius:18px;background:#100c18;color:#fff;text-decoration:none;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;cursor:pointer}.plan:hover{border-color:var(--accent);background:#191123}.plan strong{font-size:18px}.plan small{margin-top:7px;color:var(--good);font-weight:800}
.notice{margin-top:18px;padding:14px 16px;border:1px solid #6d4a2d;border-radius:15px;background:#2b1b0f;color:#f0d1a8;line-height:1.75;font-size:13px}.status{min-height:24px;margin-top:14px;color:#d4c5ed}.bad{color:var(--bad)}.copy{border:1px solid var(--line);border-radius:12px;background:#1a1324;color:#fff;padding:10px 13px;cursor:pointer;font-weight:800}
.back{display:inline-block;margin-top:18px;color:#c7a6ff;text-decoration:none}
@media(max-width:640px){.plans{grid-template-columns:1fr}.card{padding:20px}.device{align-items:flex-start}.copy{width:100%}}
</style>
</head>
<body>
<main>
  <div class="brand"><img src="/blofy-logo.png" alt=""><div><strong>BLOFY PLAYER</strong><span>الدفع عبر متجر BLOFY SAT</span></div></div>
  <section class="card">
    <h1>تجديد اشتراك الجهاز</h1>
    <p>اختر المدة، وسيتم تحويلك إلى متجر BLOFY SAT لإكمال الدفع عبر وسائل الدفع المتاحة في المتجر.</p>
    <div id="deviceBox" class="device" hidden><div><span style="color:var(--muted)">رقم الجهاز</span><br><code id="deviceText"></code></div><button id="copyBtn" class="copy" type="button">نسخ رقم الجهاز</button></div>
    <div id="status" class="status">جاري التحقق من بيانات الجهاز…</div>
  </section>
  <section id="plansCard" class="card" hidden>
    <h1 style="font-size:22px">اختر مدة الاشتراك</h1>
    <div id="plans" class="plans"></div>
    <div class="notice">في صفحة المنتج داخل BLOFY SAT أدخل <b>رقم جهاز BLOFY PLAYER</b> الظاهر أعلاه في الحقل المخصص. بعد اكتمال الدفع، يتم التفعيل تلقائيًا عند وصول إشعار الدفع من زد.</div>
    <a class="back" href="/">الرجوع إلى بوابة الجهاز</a>
  </section>
</main>
<script>
(function(){
  const statusNode=document.getElementById('status');
  const deviceBox=document.getElementById('deviceBox');
  const deviceText=document.getElementById('deviceText');
  const plansCard=document.getElementById('plansCard');
  const plansNode=document.getElementById('plans');
  const copyBtn=document.getElementById('copyBtn');
  const params=new URLSearchParams(location.hash.slice(1));
  const deviceId=String(params.get('deviceId')||'').trim();
  const code=String(params.get('code')||'').trim();

  function fail(message){statusNode.textContent=message;statusNode.classList.add('bad');}
  async function copyDevice(){
    const text=deviceText.textContent||'';
    if(!text)return;
    try{await navigator.clipboard.writeText(text);copyBtn.textContent='تم النسخ ✓';}
    catch{
      const input=document.createElement('input');input.value=text;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();copyBtn.textContent='تم النسخ ✓';
    }
    setTimeout(()=>copyBtn.textContent='نسخ رقم الجهاز',1600);
  }
  copyBtn.addEventListener('click',copyDevice);

  if(!deviceId||!code){fail('بيانات الجهاز غير موجودة. افتح صفحة الدفع من الباركود داخل BLOFY PLAYER.');return;}
  fetch('/api/v1/payments/zid/session',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId,activationCode:code})
  }).then(async response=>{
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'تعذر التحقق من الجهاز');
    deviceText.textContent=data.deviceId;
    deviceBox.hidden=false;
    statusNode.textContent=data.expiresAt?'تم التحقق من الجهاز. الاشتراك الحالي محفوظ وسيُمدد من تاريخ الانتهاء.':'تم التحقق من الجهاز.';
    if(!Array.isArray(data.plans)||!data.plans.length){throw new Error('لم تتم إضافة منتجات BLOFY PLAYER إلى متجر BLOFY SAT بعد.');}
    plansNode.innerHTML='';
    data.plans.forEach(plan=>{
      const a=document.createElement('a');a.className='plan';
      if(plan.productUrl){a.href=plan.productUrl;a.rel='noopener';}
      else{a.href='#';a.addEventListener('click',e=>{e.preventDefault();alert('رابط هذا المنتج لم يُضف بعد.');});}
      const strong=document.createElement('strong');strong.textContent=plan.name;
      const small=document.createElement('small');small.textContent=plan.priceLabel||('مدة '+plan.durationDays+' يوم');
      a.append(strong,small);plansNode.appendChild(a);
    });
    plansCard.hidden=false;
  }).catch(error=>fail(error.message||'تعذر تجهيز الدفع.'));
})();
</script>
</body></html>`;
}

function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'strict-transport-security': 'max-age=31536000',
    'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'"
  });
  res.end(body);
}

if (DATABASE_URL && /^[a-fA-F0-9]{64}$/.test(KEY_HEX)) {
  const pool = new Pool({ ...databaseOptions(DATABASE_URL) });
  const credentials = createActivationCredentialCodec(KEY_HEX);
  const ipLimiter = createFixedWindowLimiter({ limit: AUTH_IP_RATE_LIMIT, windowMs: AUTH_RATE_WINDOW_MS });
  const deviceLimiter = createFixedWindowLimiter({ limit: AUTH_DEVICE_RATE_LIMIT, windowMs: AUTH_RATE_WINDOW_MS });
  const plans = parseZidProducts(process.env.BLOFY_ZID_PRODUCTS_JSON);
  let schemaReady;

  async function ensureSchema() {
    if (!schemaReady) {
      schemaReady = (async () => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS zid_payment_fulfillments (
            id UUID PRIMARY KEY,
            zid_order_id TEXT NOT NULL,
            zid_order_product_key TEXT NOT NULL,
            device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
            plan_key TEXT NOT NULL,
            product_id TEXT,
            product_sku TEXT,
            quantity INTEGER NOT NULL DEFAULT 1,
            duration_days INTEGER NOT NULL,
            paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(zid_order_id,zid_order_product_key)
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS zid_payment_events (
            event_key TEXT PRIMARY KEY,
            zid_order_id TEXT,
            payment_status TEXT,
            result TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query('CREATE INDEX IF NOT EXISTS idx_zid_fulfillment_device ON zid_payment_fulfillments(device_id,created_at DESC)');
      })().catch(error => { schemaReady = null; throw error; });
    }
    await schemaReady;
  }

  async function recordCredentialFailure(client, row) {
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

  async function authorizeDevice(req, body) {
    const deviceId = clean(body?.deviceId, 96).toUpperCase();
    const activationCode = clean(body?.activationCode ?? body?.code, 12);
    const ipResult = ipLimiter.consume(requestClientKey(req));
    const deviceResult = deviceLimiter.consume(deviceId || 'invalid');
    if (!ipResult.allowed || !deviceResult.allowed) {
      throw Object.assign(new Error('rate_limited'), { status: 429, retryAfter: Math.max(ipResult.retryAfterSeconds, deviceResult.retryAfterSeconds) });
    }
    if (!DEVICE_RE.test(deviceId) || !CODE_RE.test(activationCode)) throw Object.assign(new Error('invalid_device_identity'), { status: 400 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId]);
      const row = result.rows[0];
      if (!row || isAuthLocked(row) || !credentials.matches(row, activationCode)) {
        if (row && !isAuthLocked(row)) await recordCredentialFailure(client, row);
        await client.query('COMMIT');
        throw Object.assign(new Error('invalid_device_identity'), { status: 401 });
      }
      if (!credentials.isProof(row.activation_code)) {
        const proof = credentials.proof(row.device_id, activationCode);
        await client.query('UPDATE devices SET activation_code=$2,updated_at=NOW() WHERE device_id=$1', [row.device_id, proof]);
      }
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function fulfillLine({ orderId, product, productIndex, plan, deviceId }) {
    const quantity = Math.max(1, Math.min(50, Number.parseInt(product?.quantity, 10) || 1));
    const orderProductKey = clean(product?.order_product_id ?? product?.id ?? product?.sku ?? productIndex, 160) || String(productIndex);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const deviceResult = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId]);
      const device = deviceResult.rows[0];
      if (!device) throw Object.assign(new Error('device_not_found'), { status: 404 });
      if (device.status === 'blocked') throw Object.assign(new Error('device_blocked'), { status: 409 });

      const insert = await client.query(
        `INSERT INTO zid_payment_fulfillments(
           id,zid_order_id,zid_order_product_key,device_id,plan_key,product_id,product_sku,quantity,duration_days
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT(zid_order_id,zid_order_product_key) DO NOTHING
         RETURNING id`,
        [
          crypto.randomUUID(),
          orderId,
          orderProductKey,
          deviceId,
          plan.planKey,
          clean(product?.id ?? product?.product_id, 128) || null,
          clean(product?.sku, 128) || null,
          quantity,
          plan.durationDays
        ]
      );
      if (!insert.rows.length) {
        await client.query('COMMIT');
        return { deviceId, planKey: plan.planKey, replayed: true };
      }

      const now = Date.now();
      const currentExpiry = device.expires_at ? new Date(device.expires_at).getTime() : 0;
      const base = currentExpiry > now && ['trial', 'active'].includes(device.status) ? currentExpiry : now;
      const expiresAt = new Date(base + plan.durationDays * quantity * 86_400_000);

      await client.query(
        `UPDATE devices
         SET status='active',expires_at=$2,trial_registration_pending=FALSE,updated_at=NOW()
         WHERE device_id=$1`,
        [deviceId, expiresAt]
      );
      await client.query(
        `INSERT INTO device_audit(device_id,actor,action,details)
         VALUES($1,'zid','payment_captured',jsonb_build_object(
           'zidOrderId',$2::text,'planKey',$3::text,'quantity',$4::int,'durationDays',$5::int
         ))`,
        [deviceId, orderId, plan.planKey, quantity, plan.durationDays]
      ).catch(() => {});
      await client.query('COMMIT');
      return { deviceId, planKey: plan.planKey, replayed: false, expiresAt: expiresAt.getTime() };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function processPaidOrder(payload) {
    await ensureSchema();
    const order = extractZidOrder(payload);
    if (!order) return { processed: 0, issues: ['order_missing'] };
    const orderId = orderIdFrom(order);
    if (!orderId) return { processed: 0, issues: ['order_id_missing'] };
    const products = Array.isArray(order.products) ? order.products : [];
    const issues = [];
    const results = [];

    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      const plan = matchZidPlan(product, plans);
      if (!plan || !plan.active) continue;
      const deviceId = extractDeviceIdFromProduct(product);
      if (!deviceId) {
        issues.push('device_id_missing:' + clean(product?.sku ?? product?.id ?? index, 96));
        continue;
      }
      try {
        results.push(await fulfillLine({ orderId, product, productIndex: index, plan, deviceId }));
      } catch (error) {
        issues.push(clean(error?.message || 'fulfillment_failed', 96) + ':' + deviceId);
      }
    }

    const eventKey = crypto.createHash('sha256').update(
      [eventNameFrom(payload), orderId, paymentStatusFrom(order, payload), products.length, JSON.stringify(results.map(r => [r.deviceId,r.planKey,r.replayed]))].join('|')
    ).digest('hex');
    await pool.query(
      `INSERT INTO zid_payment_events(event_key,zid_order_id,payment_status,result)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(event_key) DO UPDATE SET result=EXCLUDED.result,updated_at=NOW()`,
      [eventKey, orderId, paymentStatusFrom(order, payload), issues.length ? issues.join(',').slice(0,500) : 'ok']
    ).catch(() => {});
    return { processed: results.length, issues, results };
  }

  async function handleZid(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/pay') {
      return html(res, 200, paymentPage());
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/payments/zid/health') {
      return json(res, 200, {
        ok: true,
        provider: 'zid',
        storeUrl: STORE_URL,
        plansConfigured: plans.filter(plan => plan.active).length,
        webhookAuthConfigured: Boolean(WEBHOOK_USER && WEBHOOK_PASSWORD)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/payments/zid/session') {
      const body = await readJson(req);
      const row = await authorizeDevice(req, body);
      return json(res, 200, {
        deviceId: row.device_id,
        status: row.status,
        expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
        storeUrl: STORE_URL,
        plans: plans.filter(plan => plan.active).map(plan => ({
          planKey: plan.planKey,
          name: plan.name,
          durationDays: plan.durationDays,
          productUrl: plan.productUrl,
          priceLabel: plan.priceLabel
        }))
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/payments/zid/webhook') {
      if (!WEBHOOK_USER || !WEBHOOK_PASSWORD) return json(res, 503, { error: 'zid_webhook_auth_not_configured' });
      if (!verifyWebhookBasicAuth(req)) return json(res, 401, { error: 'invalid_webhook_auth' });
      const payload = await readJson(req);
      const order = extractZidOrder(payload);
      const eventName = eventNameFrom(payload);
      const paymentStatus = paymentStatusFrom(order || {}, payload);
      if (eventName && eventName !== 'order.payment_status.update') {
        return json(res, 200, { received: true, ignored: 'unsupported_event' });
      }
      if (paymentStatus !== 'paid') {
        return json(res, 200, { received: true, ignored: 'payment_not_paid', paymentStatus });
      }
      const result = await processPaidOrder(payload);
      return json(res, 200, { received: true, ...result });
    }

    return false;
  }

  const previousCreateServer = http.createServer.bind(http);
  http.createServer = function patchedZidPaymentServer(listener) {
    if (typeof listener !== 'function') return previousCreateServer(listener);
    return previousCreateServer(async (req, res) => {
      let url;
      try { url = new URL(req.url || '/', 'http://localhost'); }
      catch { return listener(req, res); }
      const isZidRoute = url.pathname === '/pay' || url.pathname.startsWith('/api/v1/payments/zid/');
      if (!isZidRoute) return listener(req, res);
      try {
        const handled = await handleZid(req, res, url);
        if (handled === false) return listener(req, res);
      } catch (error) {
        const status = Number(error?.status) || (error?.message === 'payload_too_large' ? 413 : 500);
        const extra = error?.retryAfter ? { 'retry-after': String(error.retryAfter) } : {};
        return json(res, status, { error: status >= 500 ? 'zid_payment_internal_error' : clean(error?.message || 'request_failed', 96) }, extra);
      }
    });
  };
}

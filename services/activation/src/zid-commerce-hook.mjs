import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { createActivationCredentialCodec } from './auth-protection.mjs';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const PLAYLIST_ENCRYPTION_KEY = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const ZID_WEBHOOK_USERNAME = String(process.env.BLOFY_ZID_WEBHOOK_USERNAME || '').trim();
const ZID_WEBHOOK_PASSWORD = String(process.env.BLOFY_ZID_WEBHOOK_PASSWORD || '').trim();
const ZID_PRODUCT_PLAN_MAP_RAW = String(process.env.BLOFY_ZID_PRODUCT_PLAN_MAP || '{}').trim();
const ZID_PLAN_URLS_RAW = String(process.env.BLOFY_ZID_PLAN_URLS || '{}').trim();
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } }) : null;
const activationCredentials = /^[a-fA-F0-9]{64}$/.test(PLAYLIST_ENCRYPTION_KEY) ? createActivationCredentialCodec(PLAYLIST_ENCRYPTION_KEY) : null;

function safeMap(raw) { try { const v = JSON.parse(raw); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } }
const ZID_PRODUCT_PLAN_MAP = safeMap(ZID_PRODUCT_PLAN_MAP_RAW);
const ZID_PLAN_URLS = safeMap(ZID_PLAN_URLS_RAW);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store' });
  res.end(payload);
}

function html(res, body) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function readRaw(req, max = 256_000) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > max) throw new Error('payload_too_large'); }
  return raw;
}
async function readJson(req) { const raw = await readRaw(req); return raw ? JSON.parse(raw) : {}; }

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function adminAuthorized(req) {
  if (!ADMIN_TOKEN) return false;
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  return constantTimeEqual(supplied, ADMIN_TOKEN);
}

function zidAuthorized(req) {
  if (!ZID_WEBHOOK_USERNAME || !ZID_WEBHOOK_PASSWORD) return false;
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Basic ')) return false;
  let decoded = '';
  try { decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8'); } catch { return false; }
  return constantTimeEqual(decoded, `${ZID_WEBHOOK_USERNAME}:${ZID_WEBHOOK_PASSWORD}`);
}

function collectStrings(node, output = [], depth = 0) {
  if (depth > 8 || output.length > 4000) return output;
  if (typeof node === 'string' || typeof node === 'number') output.push(String(node));
  else if (Array.isArray(node)) node.forEach((v) => collectStrings(v, output, depth + 1));
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => collectStrings(v, output, depth + 1));
  return output;
}

function firstByKey(node, keys, depth = 0) {
  if (depth > 8 || !node || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node)) {
    if (keys.has(String(key).toLowerCase()) && value != null && typeof value !== 'object') return String(value);
  }
  for (const value of Object.values(node)) {
    const found = firstByKey(value, keys, depth + 1); if (found != null) return found;
  }
  return null;
}

function extractDeviceId(payload) {
  return collectStrings(payload).map((s) => s.trim()).find((s) => /^BLOFY-[A-Z0-9-]{4,32}$/i.test(s)) || null;
}

function extractProductKeys(payload) {
  const found = new Set();
  const walk = (node, depth = 0) => {
    if (depth > 8 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((v) => walk(v, depth + 1));
    for (const [k, v] of Object.entries(node)) {
      const key = k.toLowerCase();
      if (['product_id','productid','sku','id'].includes(key) && (typeof v === 'string' || typeof v === 'number')) found.add(String(v));
      if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(payload);
  return [...found];
}

function planFromPayload(payload) {
  for (const key of extractProductKeys(payload)) if (ZID_PRODUCT_PLAN_MAP[key]) return String(ZID_PRODUCT_PLAN_MAP[key]);
  return null;
}

function zidOrderId(payload) {
  return firstByKey(payload, new Set(['order_id','orderid','id','order_number','ordernumber'])) || crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

function customerData(payload) {
  return {
    name: firstByKey(payload, new Set(['customer_name','customername','name','full_name','fullname']))?.slice(0, 160) || null,
    email: firstByKey(payload, new Set(['email','customer_email','customeremail']))?.slice(0, 254) || null,
    phone: firstByKey(payload, new Set(['phone','mobile','customer_phone','customerphone']))?.slice(0, 64) || null
  };
}

async function ensureCommerceSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_customers (
      device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      source TEXT NOT NULL DEFAULT 'zid',
      last_order_reference TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_device_customers_email ON device_customers(customer_email);
    CREATE INDEX IF NOT EXISTS idx_device_customers_phone ON device_customers(customer_phone);
  `);
}
const schemaReady = ensureCommerceSchema().catch((error) => console.error('Zid commerce schema init failed', error?.message || error));

async function grantPaidZidOrder(payload) {
  await schemaReady;
  const event = String(payload.event || payload.type || payload.event_name || '').toLowerCase();
  const paymentStatus = String(firstByKey(payload, new Set(['payment_status','paymentstatus','status'])) || '').toLowerCase();
  const isPaid = event.includes('payment_status') ? paymentStatus === 'paid' : (event.includes('paid') || paymentStatus === 'paid');
  if (!isPaid) return { ignored: true, reason: 'not_paid' };

  const deviceId = extractDeviceId(payload);
  const planKey = planFromPayload(payload);
  if (!deviceId) return { ignored: true, reason: 'device_id_missing' };
  if (!planKey) return { ignored: true, reason: 'plan_mapping_missing' };

  const providerReference = zidOrderId(payload).slice(0, 160);
  const eventId = `${providerReference}:${paymentStatus || 'paid'}`.slice(0, 160);
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const duplicate = await client.query(
      `INSERT INTO payment_events(payment_provider,provider_event_id,event_type,payload_hash,processing_status)
       VALUES('zid',$1,'paid',$2,'received') ON CONFLICT(payment_provider,provider_event_id) DO NOTHING RETURNING id`,
      [eventId, payloadHash]
    );
    if (!duplicate.rows[0]) { await client.query('COMMIT'); return { duplicate: true }; }

    const device = await client.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId]);
    if (!device.rows[0]) throw new Error('device_not_found');
    const planResult = await client.query('SELECT plan_key,duration_days,price_minor,currency FROM subscription_plans WHERE plan_key=$1 AND active=TRUE FOR SHARE', [planKey]);
    const plan = planResult.rows[0];
    if (!plan) throw new Error('plan_not_found');

    const existing = await client.query("SELECT id FROM subscription_orders WHERE payment_provider='zid' AND provider_reference=$1 LIMIT 1", [providerReference]);
    const orderId = existing.rows[0]?.id || crypto.randomUUID();
    if (!existing.rows[0]) {
      await client.query(
        `INSERT INTO subscription_orders(id,device_id,plan_key,status,amount_minor,currency,payment_provider,provider_reference,paid_at)
         VALUES($1,$2,$3,'paid',$4,$5,'zid',$6,NOW())`,
        [orderId, deviceId, plan.plan_key, Number(plan.price_minor), plan.currency, providerReference]
      );
    }

    const current = await client.query(
      `SELECT expires_at FROM device_subscriptions WHERE device_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>NOW())
       ORDER BY expires_at DESC NULLS FIRST LIMIT 1 FOR UPDATE`, [deviceId]
    );
    const now = Date.now();
    const currentExpiry = current.rows[0]?.expires_at ? new Date(current.rows[0].expires_at).getTime() : 0;
    const startsAtMs = Math.max(now, Number.isFinite(currentExpiry) ? currentExpiry : 0);
    const expiresAt = plan.duration_days == null ? null : new Date(startsAtMs + Number(plan.duration_days) * 86_400_000);
    await client.query(
      `INSERT INTO device_subscriptions(id,device_id,plan_key,order_id,starts_at,expires_at,status)
       VALUES($1,$2,$3,$4,$5,$6,'active') ON CONFLICT DO NOTHING`,
      [crypto.randomUUID(), deviceId, plan.plan_key, orderId, new Date(startsAtMs), expiresAt]
    );
    await client.query("UPDATE devices SET status='active',expires_at=$2,updated_at=NOW() WHERE device_id=$1 AND status!='blocked'", [deviceId, expiresAt]);

    const customer = customerData(payload);
    await client.query(
      `INSERT INTO device_customers(device_id,customer_name,customer_email,customer_phone,source,last_order_reference)
       VALUES($1,$2,$3,$4,'zid',$5)
       ON CONFLICT(device_id) DO UPDATE SET
         customer_name=COALESCE(EXCLUDED.customer_name,device_customers.customer_name),
         customer_email=COALESCE(EXCLUDED.customer_email,device_customers.customer_email),
         customer_phone=COALESCE(EXCLUDED.customer_phone,device_customers.customer_phone),
         source='zid',last_order_reference=EXCLUDED.last_order_reference,updated_at=NOW()`,
      [deviceId, customer.name, customer.email, customer.phone, providerReference]
    );
    await client.query("UPDATE payment_events SET processing_status='applied',processed_at=NOW() WHERE payment_provider='zid' AND provider_event_id=$1", [eventId]);
    await client.query('COMMIT');
    return { applied: true, deviceId, planKey, expiresAt: expiresAt?.getTime() || null };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

async function zidWebhook(req, res) {
  if (!pool) return json(res, 503, { error: 'database_unavailable' });
  if (!zidAuthorized(req)) return json(res, 401, { error: 'unauthorized' });
  const raw = await readRaw(req);
  let payload; try { payload = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'invalid_json' }); }
  try { const result = await grantPaidZidOrder(payload); return json(res, 200, { ok: true, ...result }); }
  catch (error) { console.error('Zid webhook failed', error?.message || error); return json(res, 422, { ok: false, error: String(error?.message || 'zid_webhook_failed') }); }
}

async function readiness(_req, res) {
  return json(res, 200, {
    ok: true,
    trialDays: 7,
    webhookAuthConfigured: Boolean(ZID_WEBHOOK_USERNAME && ZID_WEBHOOK_PASSWORD),
    productPlanMapConfigured: Object.keys(ZID_PRODUCT_PLAN_MAP).length > 0,
    planUrlsConfigured: Object.keys(ZID_PLAN_URLS).length > 0
  });
}

async function renewValidate(req, res) {
  await schemaReady;
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim();
  const activationCode = String(body.activationCode || '').trim();
  if (!/^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) || !/^\d{6}$/.test(activationCode) || !activationCredentials) return json(res, 400, { error: 'invalid_device' });
  const result = await pool.query('SELECT device_id,activation_code,status,expires_at FROM devices WHERE device_id=$1 LIMIT 1', [deviceId]);
  const row = result.rows[0];
  if (!row || !activationCredentials.matches(row, activationCode)) return json(res, 403, { error: 'unauthorized_device' });
  const plans = await pool.query('SELECT plan_key,name,duration_days,price_minor,currency FROM subscription_plans WHERE active=TRUE ORDER BY sort_order,name');
  return json(res, 200, {
    deviceId,
    status: row.status,
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    plans: plans.rows.map((p) => ({ key: p.plan_key, name: p.name, durationDays: p.duration_days == null ? null : Number(p.duration_days), priceMinor: Number(p.price_minor), currency: p.currency, zidUrl: ZID_PLAN_URLS[p.plan_key] || null }))
  });
}

async function adminUsers(req, res, requestUrl) {
  if (!adminAuthorized(req)) return json(res, 401, { error: 'unauthorized' });
  await schemaReady;
  const q = String(requestUrl.searchParams.get('q') || '').trim();
  const limit = Math.min(200, Math.max(1, Number(requestUrl.searchParams.get('limit') || 100)));
  const params = [];
  let where = '';
  if (q) { params.push(`%${q.replace(/[%_]/g, '')}%`); where = `WHERE d.device_id ILIKE $1 OR dc.customer_name ILIKE $1 OR dc.customer_email ILIKE $1 OR dc.customer_phone ILIKE $1`; }
  params.push(limit);
  const result = await pool.query(
    `SELECT d.device_id,d.status,d.trial_started_at,d.expires_at,d.created_at,d.last_seen_at,d.last_app_version,d.last_platform,
            dc.customer_name,dc.customer_email,dc.customer_phone,dc.source,dc.last_order_reference,
            (SELECT ds.plan_key FROM device_subscriptions ds WHERE ds.device_id=d.device_id ORDER BY ds.starts_at DESC LIMIT 1) AS plan_key
     FROM devices d LEFT JOIN device_customers dc ON dc.device_id=d.device_id
     ${where} ORDER BY d.created_at DESC LIMIT $${params.length}`,
    params
  );
  return json(res, 200, { items: result.rows });
}

async function adminGrant(req, res) {
  if (!adminAuthorized(req)) return json(res, 401, { error: 'unauthorized' });
  const body = await readJson(req);
  const deviceId = String(body.deviceId || '').trim(); const planKey = String(body.planKey || '').trim();
  if (!/^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) || !/^[A-Za-z0-9._-]{1,64}$/.test(planKey)) return json(res, 400, { error: 'invalid_request' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const planResult = await client.query('SELECT plan_key,duration_days FROM subscription_plans WHERE plan_key=$1 AND active=TRUE FOR SHARE', [planKey]);
    const plan = planResult.rows[0]; if (!plan) { await client.query('ROLLBACK'); return json(res, 404, { error: 'plan_not_found' }); }
    const device = await client.query('SELECT expires_at FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId]);
    if (!device.rows[0]) { await client.query('ROLLBACK'); return json(res, 404, { error: 'device_not_found' }); }
    const now = Date.now(); const existing = device.rows[0].expires_at ? new Date(device.rows[0].expires_at).getTime() : 0;
    const start = Math.max(now, Number.isFinite(existing) ? existing : 0); const expiresAt = plan.duration_days == null ? null : new Date(start + Number(plan.duration_days) * 86_400_000);
    await client.query(`INSERT INTO device_subscriptions(id,device_id,plan_key,starts_at,expires_at,status) VALUES($1,$2,$3,$4,$5,'active')`, [crypto.randomUUID(), deviceId, plan.plan_key, new Date(start), expiresAt]);
    await client.query("UPDATE devices SET status='active',expires_at=$2,updated_at=NOW() WHERE device_id=$1 AND status!='blocked'", [deviceId, expiresAt]);
    await client.query('COMMIT'); return json(res, 200, { ok: true, expiresAt: expiresAt?.getTime() || null });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
}

function renewPage() {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BLOFY Renew</title><style>body{margin:0;background:#0d0813;color:#fff;font-family:system-ui;display:grid;place-items:center;min-height:100vh}.box{width:min(92vw,680px);background:#1b1227;border:1px solid #6d4590;border-radius:24px;padding:28px}input,button,a{box-sizing:border-box;width:100%;padding:14px;border-radius:14px;margin-top:10px;font-size:16px}input{background:#100a18;color:#fff;border:1px solid #4b365e}button,a{background:#7b3ed0;color:#fff;border:0;text-align:center;text-decoration:none;display:block}.plans{display:grid;gap:10px;margin-top:16px}.muted{color:#b9a9c7}</style><div class="box"><h1>تجديد BLOFY PLAYER</h1><p class="muted">أدخل رقم الجهاز ورمز الربط. التجربة تبدأ تلقائيًا لمدة 7 أيام من أول تشغيل.</p><input id="d" placeholder="BLOFY-XXXX-XXXX"><input id="c" placeholder="رمز الربط 6 أرقام" inputmode="numeric"><button onclick="go()">عرض خطط التجديد</button><div id="msg" class="muted"></div><div id="plans" class="plans"></div></div><script>async function go(){const msg=document.getElementById('msg'),plans=document.getElementById('plans');plans.innerHTML='';msg.textContent='جاري التحقق...';const r=await fetch('/api/v1/renew/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:d.value.trim(),activationCode:c.value.trim()})});const x=await r.json();if(!r.ok){msg.textContent='تعذر التحقق من الجهاز';return}msg.textContent='رقم جهازك: '+x.deviceId+' — انسخه في خانة رقم الجهاز داخل طلب زد.';(x.plans||[]).forEach(p=>{const a=document.createElement('a');a.textContent=p.name+' — '+(p.priceMinor/100).toFixed(2)+' '+p.currency;if(p.zidUrl){a.href=p.zidUrl;a.target='_blank'}else{a.style.opacity='.45';a.textContent+=' (رابط زد غير مضاف)'}plans.appendChild(a)})}</script>`;
}

function adminPage() {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BLOFY Admin</title><style>body{margin:0;background:#0d0813;color:#fff;font-family:system-ui;padding:18px}input,button{padding:11px;border-radius:10px;border:1px solid #4b365e;background:#181020;color:#fff;margin:4px}button{background:#7440bd}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}td,th{border-bottom:1px solid #352642;padding:9px;text-align:right}.wrap{overflow:auto}</style><h1>BLOFY Admin</h1><input id="t" type="password" placeholder="Admin token"><input id="q" placeholder="بحث: جهاز / اسم / جوال / بريد"><button onclick="load()">بحث</button><div class="wrap"><table><thead><tr><th>الجهاز</th><th>المستخدم</th><th>الجوال</th><th>الحالة</th><th>الخطة</th><th>الانتهاء</th></tr></thead><tbody id="rows"></tbody></table></div><script>async function load(){sessionStorage.setItem('blofy_admin',t.value);const r=await fetch('/api/v1/admin/users?q='+encodeURIComponent(q.value),{headers:{authorization:'Bearer '+t.value}});const x=await r.json();rows.innerHTML=(x.items||[]).map(v=>'<tr><td>'+v.device_id+'</td><td>'+(v.customer_name||'-')+'</td><td>'+(v.customer_phone||'-')+'</td><td>'+v.status+'</td><td>'+(v.plan_key||'-')+'</td><td>'+(v.expires_at?new Date(v.expires_at).toLocaleString('ar-SA'):'-')+'</td></tr>').join('')}</script>`;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function patchedZidCreateServer(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let url; try { url = new URL(req.url || '/', 'http://localhost'); } catch { return listener(req, res); }
    try {
      if (req.method === 'POST' && url.pathname === '/api/v1/zid/webhook') return await zidWebhook(req, res);
      if (req.method === 'GET' && url.pathname === '/api/v1/zid/readiness') return await readiness(req, res);
      if (req.method === 'POST' && url.pathname === '/api/v1/renew/validate') return await renewValidate(req, res);
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/users') return await adminUsers(req, res, url);
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/grant') return await adminGrant(req, res);
      if (req.method === 'GET' && url.pathname === '/renew') return html(res, renewPage());
      if (req.method === 'GET' && url.pathname === '/admin') return html(res, adminPage());
    } catch (error) {
      console.error('Zid commerce route failed', error?.message || error);
      if (!res.headersSent) return json(res, 500, { error: 'commerce_error' });
      return res.destroy();
    }
    return listener(req, res);
  });
};

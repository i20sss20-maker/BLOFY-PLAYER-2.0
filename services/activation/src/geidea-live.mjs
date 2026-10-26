// Geidea KSA Live checkout for BLOFY PLAYER. Never load TEST keys or enable by default.
// Card details are handled exclusively by Geidea Hosted Payment Page.
import crypto from 'node:crypto';
import { ADMIN_CONSOLE_SCHEMA } from './admin-console-schema.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API = 'https://api.ksamerchant.geidea.net';
// Modal hosted card-entry checkout only; never redirect to an unrestricted wallet-enabled HPP.
// Merchant settings already disable Google Pay and Samsung Pay (verified by
// non-paying Geidea Live preflight 2026-10-26). Hiding a disabled wallet makes
// Geidea reject session creation with HPP error 110/112.
export const CARD_ONLY_WALLETS = Object.freeze(['apple-pay']);
const error = (code, status=400) => Object.assign(new Error(code), {status});
const clean = (v, n=128) => String(v ?? '').trim().slice(0,n);

export function minor(value) {
  if (!['string','number'].includes(typeof value) || !/^\d{1,8}(?:\.\d{1,2})?$/.test(String(value))) throw error('geidea_invalid_amount');
  const [whole, fraction=''] = String(value).split('.');
  return Number(whole)*100 + Number(fraction.padEnd(2,'0'));
}
export function plansFromConfig(source) {
  if (!source) return [];
  let rows;
  try { rows=JSON.parse(source); } catch {throw error('geidea_invalid_plan_configuration',503);}
  if (!Array.isArray(rows) || rows.length>20) throw error('geidea_invalid_plan_configuration',503);
  const seen=new Set();
  return rows.map((p,index) => {
    const raw=clean(p?.planKey ?? p?.plan_key,80);
    const key=raw.replace(/^tap-live-/,'geidea-live-');
    const name=clean(p?.name,120);
    const duration=p?.durationDays ?? p?.duration_days;
    const durationDays=duration==null ? null : Number(duration);
    const priceMinor=Number(p?.priceMinor ?? p?.price_minor);
    const maxDevices=Number(p?.maxDevices ?? p?.max_devices ?? 1);
    const currency=clean(p?.currency || 'SAR',3);
    const sortOrder=Number(p?.sortOrder ?? p?.sort_order ?? index);
    if (!/^geidea-live-[a-z0-9][a-z0-9-]{1,60}$/.test(key) || seen.has(key) || !name ||
        !Number.isInteger(priceMinor) || priceMinor<100 || priceMinor>100000000 ||
        currency!=='SAR' || maxDevices!==1 ||
        (durationDays!==null && (!Number.isInteger(durationDays) || durationDays<1 || durationDays>3650)) ||
        !Number.isInteger(sortOrder)) throw error('geidea_invalid_plan_configuration',503);
    seen.add(key);
    return {planKey:key,name,durationDays,priceMinor,maxDevices,currency,sortOrder,active:p.active!==false};
  });
}
export function createSignature({publicKey,password,amountMinor,currency='SAR',reference,timestamp}) {
  return crypto.createHmac('sha256',password)
    .update(publicKey+(amountMinor/100).toFixed(2)+currency+reference+timestamp,'utf8')
    .digest('base64');
}
export function verifyGeideaCallback(payload, order, config) {
  const p=payload?.order, stamp=payload?.timeStamp ?? payload?.timestamp;
  if (!p || !UUID.test(p.orderId || '') || p.merchantReferenceId!==order.id ||
      p.merchantPublicKey!==config.publicKey || p.currency!=='SAR' ||
      minor(p.amount)!==Number(order.amount_minor) || p.isTest!==false ||
      !/^[A-Za-z]{1,40}$/.test(p.status || '') ||
      typeof stamp!=='string' || !stamp || stamp.length>80 ||
      (payload.timeStamp && payload.timestamp && payload.timeStamp!==payload.timestamp) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(payload.signature || '')) throw error('geidea_invalid_callback',401);
  const data=config.publicKey+(Number(order.amount_minor)/100).toFixed(2)+order.currency+
    p.orderId+p.status+order.id+stamp;
  const hash=crypto.createHmac('sha256',config.password).update(data,'utf8').digest();
  const supplied=Buffer.from(payload.signature,'base64');
  if (supplied.length!==hash.length || !crypto.timingSafeEqual(supplied,hash)) throw error('geidea_invalid_callback_signature',401);
  return p.orderId;
}
export function verifiedPayment(provider, order, config) {
  if (!provider || !UUID.test(provider.orderId || '') ||
      provider.merchantReferenceId!==order.id || provider.merchantPublicKey!==config.publicKey ||
      provider.isTest!==false || provider.currency!=='SAR' ||
      minor(provider.amount)!==Number(order.amount_minor) ||
      (provider.totalAmount!==undefined && minor(provider.totalAmount)!==Number(order.amount_minor)) ||
      (order.provider_reference && order.provider_reference!==provider.orderId)) throw error('geidea_order_mismatch',409);
  if (provider.status==='Success' && provider.detailedStatus==='Paid') {
    // Never grant a BLOFY entitlement for Apple Pay / Google Pay / Samsung Pay or another wallet.
    // Provider read is authoritative. Missing card evidence fails closed.
    // The order-level paymentMethod is optional in Geidea order lookups.
    // The captured transaction's paymentMethod is mandatory and verified below.
    if ((provider.paymentMethod != null && (
          provider.paymentMethod.type!=='Card' || provider.paymentMethod.wallet != null ||
          !['mada','visa','mastercard'].includes(String(provider.paymentMethod.brand||'').toLowerCase())
        )) ||
        minor(provider.totalCapturedAmount)!==Number(order.amount_minor) ||
        minor(provider.totalRefundedAmount)!==0 || provider.paymentOperation!=='Pay' ||
        !Array.isArray(provider.transactions) || !provider.transactions.some(tx =>
          tx.type==='Pay' && tx.status==='Success' && tx.currency==='SAR' &&
          tx.paymentMethod?.type==='Card' && tx.paymentMethod.wallet == null &&
          ['mada','visa','mastercard'].includes(String(tx.paymentMethod?.brand||'').toLowerCase()) &&
          minor(tx.amount)===Number(order.amount_minor) &&
          tx.codes?.responseCode==='000' && tx.codes?.detailedResponseCode==='000'))
      throw error('geidea_capture_not_verified',409);
    return 'paid';
  }
  if (['Cancelled','Canceled'].includes(provider.status) || ['Cancelled','Canceled'].includes(provider.detailedStatus)) return 'cancelled';
  if (provider.status==='Failed' || provider.detailedStatus==='OrderFailed') return 'failed';
  return 'pending';
}
function document(res,status,title,content) {
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const html='<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+
    esc(title)+'</title><style>body{min-height:100vh;display:grid;place-items:center;margin:0;background:#100920;color:#fff;font-family:system-ui,Tahoma,sans-serif}main{background:#21133b;padding:34px;border:1px solid #7652b5;border-radius:24px;text-align:center;max-width:560px;margin:20px;line-height:1.8}small{color:#bfa1fa}</style><main><small>BLOFY PLAYER</small><h1>'+esc(title)+'</h1><p>'+esc(content)+'</p><a style="color:#cbb8ff" href="/pay">العودة للدفع</a></main></html>';
  res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none';"});
  res.end(html);
}
export function createGeideaLiveHandlers({pool,json,readJson,authorize,env=process.env,fetchImpl=globalThis.fetch}) {
  const selected=env.BLOFY_PAYMENT_PROVIDER==='geidea';
  const publicKey=clean(env.GEIDEA_LIVE_MERCHANT_PUBLIC_KEY,100);
  const password=String(env.GEIDEA_LIVE_API_PASSWORD||'');
  const configured=selected && env.BLOFY_GEIDEA_CHECKOUT_ENABLED==='true' && UUID.test(publicKey) && password.length>=16;
  const base=clean(env.BLOFY_PAYMENT_BASE_URL || 'https://api.blofyplayer.com',512).replace(/\/+$/,'');
  if (selected && !/^https:\/\/(?:api\.)?blofyplayer\.com$/.test(base)) throw error('geidea_invalid_public_origin',503);
  const config={publicKey,password};
  const configuredPlans=selected ? plansFromConfig(env.BLOFY_GEIDEA_PLANS_JSON || env.BLOFY_PAYMENT_PLANS_JSON):[];
  let schemaReady;
  async function schema() {
    if (!schemaReady) schemaReady=(async()=>{
      await pool.query(ADMIN_CONSOLE_SCHEMA);
      await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_device_subscriptions_order_unique ON device_subscriptions(order_id) WHERE order_id IS NOT NULL');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_subscription_orders_provider_reference ON subscription_orders(provider_reference) WHERE provider_reference IS NOT NULL');
      for (const p of configuredPlans) {
        await pool.query('INSERT INTO subscription_plans(plan_key,name,duration_days,max_devices,price_minor,currency,active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(plan_key) DO UPDATE SET name=EXCLUDED.name,duration_days=EXCLUDED.duration_days,max_devices=EXCLUDED.max_devices,price_minor=EXCLUDED.price_minor,currency=EXCLUDED.currency,active=EXCLUDED.active,sort_order=EXCLUDED.sort_order,updated_at=NOW()',
          [p.planKey,p.name,p.durationDays,1,p.priceMinor,'SAR',p.active,p.sortOrder]);
      }
    })().catch(e=>{schemaReady=null;throw e;});
    await schemaReady;
  }
  async function provider(path,method='GET',body) {
    const headers={authorization:'Basic '+Buffer.from(publicKey+':'+password).toString('base64'),accept:'application/json'};
    if (body) headers['content-type']='application/json';
    let response;
    try {response=await fetchImpl(API+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch {throw error('geidea_network_unavailable',503);}
    if (!response.ok) throw error('geidea_provider_http_error',503);
    let result;
    try {result=await response.json();} catch {throw error('geidea_provider_invalid_response',502);}
    if (result?.responseCode!=='000' || result?.detailedResponseCode!=='000') throw error('geidea_provider_rejected',502);
    return result;
  }
  async function fetchOrder(reference, providerOrderId) {
    const path=providerOrderId ? '/pgw/api/v1/direct/order/'+encodeURIComponent(providerOrderId) :
      '/pgw/api/v1/direct/order?MerchantReferenceId='+encodeURIComponent(reference);
    const result=await provider(path);
    const orders=result.order ? [result.order]:result.orders;
    if (!Array.isArray(orders) || orders.length!==1) throw error('geidea_order_lookup_ambiguous',503);
    if (providerOrderId && orders[0].orderId!==providerOrderId) throw error('geidea_order_mismatch',409);
    return orders[0];
  }
  async function applyVerified(reference, providerOrder) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const found=await client.query("SELECT o.*,p.duration_days FROM subscription_orders o JOIN subscription_plans p ON p.plan_key=o.plan_key WHERE o.id=$1 AND o.payment_provider='geidea' FOR UPDATE OF o",[reference]);
      const order=found.rows[0];
      if (!order) throw error('geidea_order_not_found',404);
      const state=verifiedPayment(providerOrder,order,config);
      if (order.status==='paid') {await client.query('COMMIT');return {paid:true,replayed:true};}
      if (state==='paid') {
        const device=(await client.query('SELECT status,expires_at,data_deleted_at FROM devices WHERE device_id=$1 FOR UPDATE',[order.device_id])).rows[0];
        if (!device || device.status==='blocked' || device.data_deleted_at) throw error('geidea_device_unavailable',409);
        const now=new Date();
        const startsAt=device.expires_at && new Date(device.expires_at)>now && ['active','trial'].includes(device.status) ? new Date(device.expires_at) : now;
        const expiresAt=order.duration_days==null ? null : new Date(startsAt.getTime()+Number(order.duration_days)*86400000);
        await client.query("UPDATE subscription_orders SET status='paid',provider_reference=$2,paid_at=NOW(),updated_at=NOW() WHERE id=$1",[reference,providerOrder.orderId]);
        await client.query("INSERT INTO device_subscriptions(id,device_id,plan_key,order_id,starts_at,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,'active') ON CONFLICT(order_id) WHERE order_id IS NOT NULL DO NOTHING",[crypto.randomUUID(),order.device_id,order.plan_key,reference,startsAt,expiresAt]);
        await client.query("UPDATE devices SET status='active',expires_at=$2,updated_at=NOW() WHERE device_id=$1",[order.device_id,expiresAt]);
        await client.query("INSERT INTO device_audit(device_id,actor,action,details) VALUES($1,'geidea','payment_captured',jsonb_build_object('orderId',$2::text,'providerOrderId',$3::text,'planKey',$4::text))",[order.device_id,reference,providerOrder.orderId,order.plan_key]);
      } else {
        await client.query("UPDATE subscription_orders SET status=$2,provider_reference=COALESCE(provider_reference,$3),updated_at=NOW() WHERE id=$1 AND status<>'paid'",[reference,state,providerOrder.orderId]);
      }
      await client.query('COMMIT');
      return {paid:state==='paid',state};
    } catch(e) {await client.query('ROLLBACK').catch(()=>{});throw e;} finally {client.release();}
  }
  async function reconcile(reference, providerOrderId) {
    const row=(await pool.query("SELECT id,amount_minor,currency,provider_reference FROM subscription_orders WHERE id=$1 AND payment_provider='geidea'",[reference])).rows[0];
    if (!row) throw error('geidea_order_not_found',404);
    const detail=await fetchOrder(reference,providerOrderId || row.provider_reference);
    return applyVerified(reference,detail);
  }
  async function webhook(req,res) {
    if (!configured) return json(res,503,{error:'geidea_not_enabled'});
    const payload=await readJson(req);
    const reference=payload?.order?.merchantReferenceId;
    if (!UUID.test(reference||'')) return json(res,400,{error:'geidea_invalid_reference'});
    const row=(await pool.query("SELECT id,amount_minor,currency,payment_provider FROM subscription_orders WHERE id=$1",[reference])).rows[0];
    if (!row || row.payment_provider!=='geidea') return json(res,404,{error:'geidea_order_not_found'});
    const id=verifyGeideaCallback(payload,row,config);
    await reconcile(reference,id);
    return json(res,200,{received:true});
  }
  async function checkout(req,res) {
    if (!configured || !configuredPlans.some(p=>p.active)) return json(res,503,{error:'geidea_not_enabled'});
    await schema();
    const body=await readJson(req);
    const deviceId=await authorize(req,res,body);
    if (!deviceId) return;
    const plan=configuredPlans.find(p=>p.planKey===body.planKey && p.active);
    if (!plan) return json(res,404,{error:'plan_not_found'});
    const id=crypto.randomUUID();
    await pool.query("INSERT INTO subscription_orders(id,device_id,plan_key,status,amount_minor,currency,payment_provider) VALUES($1,$2,$3,'pending',$4,'SAR','geidea')",
      [id,deviceId,plan.planKey,plan.priceMinor]);
    const timestamp=new Date().toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
    const request={
      amount:(plan.priceMinor/100).toFixed(2),currency:'SAR',timestamp,merchantReferenceId:id,
      signature:createSignature({publicKey,password,amountMinor:plan.priceMinor,reference:id,timestamp}),
      paymentOperation:'Pay',language:'ar',
      // Apple Pay explicitly hidden. Google Pay and Samsung Pay are disabled
      // at merchant level; specifying them here produces Geidea error 110/112.
      hideWallets:[...CARD_ONLY_WALLETS],expressCheckouts:[],
      acceptTabbyPaymentMethod:false,acceptTamaraPaymentMethod:false,
      appearance:{uiMode:'modal'},
      callbackUrl:base+'/api/v1/payments/geidea/webhook',
      returnUrl:base+'/api/v1/payments/geidea/return?reference='+id
    };
    let created;
    try {created=await provider('/payment-intent/api/v2/direct/session','POST',request);}
    catch {return json(res,503,{error:'geidea_session_unavailable',orderId:id});}
    if (!UUID.test(created?.session?.id||'') || Date.parse(created?.session?.expiryDate||'')<=Date.now())
      return json(res,502,{error:'geidea_session_invalid',orderId:id});
    // Return the session ID, not a redirect URL. Client MUST launch Geidea modal
    // so the provider's documented hideWallets setting is honored.
    return json(res,201,{provider:'geidea',orderId:id,sessionId:created.session.id,
      checkoutMode:'modal',status:'PENDING',sandbox:false});
  }
  async function returnPage(res,url) {
    const ref=url.searchParams.get('reference');
    if (!UUID.test(ref||'')) return document(res,400,'تعذر التحقق','رقم العملية غير صالح.');
    try {
      const result=await reconcile(ref);
      return result.paid ? document(res,200,'تم الدفع بنجاح','تم التحقق من Geidea وتفعيل BLOFY PLAYER. ارجع للتطبيق.') :
        document(res,200,'الدفع قيد التحقق','لم يتم تأكيد الدفع حتى الآن. يرجى العودة إلى التطبيق والتحقق من حالة اشتراكك.');
    } catch {return document(res,200,'الدفع قيد التحقق','قد يتأخر التحقق من الدفع. لا تعِد الدفع قبل مراجعة حالة اشتراكك أو التواصل مع الدعم.');}
  }
  async function handler(req,res,url) {
    if (!selected) return false;
    const p=url.pathname;
    if (p==='/api/v1/subscriptions/plans' && req.method==='GET') {
      json(res,200,{provider:'geidea',sandbox:false,purchasesAvailable:configured&&configuredPlans.some(p=>p.active),
        items:configured?configuredPlans.filter(p=>p.active).map(p=>({
          planKey:p.planKey,name:p.name,durationDays:p.durationDays,maxDevices:1,priceMinor:p.priceMinor,currency:'SAR'
        })):[]});return true;
    }
    if (p==='/api/v1/subscriptions/checkout' && req.method==='POST') {await checkout(req,res);return true;}
    if (p==='/api/v1/payments/geidea/webhook' && req.method==='POST') {await webhook(req,res);return true;}
    if (p==='/api/v1/payments/geidea/return' && req.method==='GET') {await returnPage(res,url);return true;}
    return false;
  }
  handler.configured=configured&&configuredPlans.some(p=>p.active);
  return handler;
}

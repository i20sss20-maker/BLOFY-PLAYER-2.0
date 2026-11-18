// Optional BLOFY customer portal. It NEVER replaces guest checkout or treats a browser redirect as paid.
// Orders may only be linked with their existing 256-bit guest access token.
import crypto from 'node:crypto';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';
import {parseStoreCart,cartVouchers,publicOrderNumber} from './store-cart.mjs';
import {decryptStreamCode} from './xtream-code-vault.mjs';
import {streamCodeProof} from './xtream-duration-codes.mjs';
import {createCustomerReminderEngine} from './store-customer-reminders.mjs';
import {classifyResendFailure,checkResendSender} from './store-customer-resend.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS=/^[A-Za-z0-9_-]{42,44}$/;
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}$/;
const COOKIE='__Host-blofy_customer';
const ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const maxRequests=createFixedWindowLimiter({limit:5,windowMs:600000});
const maxVerifies=createFixedWindowLimiter({limit:12,windowMs:600000});
const maxClaims=createFixedWindowLimiter({limit:20,windowMs:600000});
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>/^[a-f0-9]{64}$/.test(String(a||''))&&/^[a-f0-9]{64}$/.test(String(b||''))&&
  crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const normalizedEmail=value=>typeof value==='string'&&EMAIL.test(value.trim().toLowerCase())
  ?value.trim().toLowerCase():null;
const error=(code,status)=>Object.assign(new Error(code),{status});
const codeProof=(key,email,code)=>crypto.createHmac('sha256',Buffer.from(key,'hex'))
  .update('blofy-customer-otp-v1:'+email+':'+code).digest('hex');
export function expiryAlert(expiresAt,now=Date.now()){
 if(!expiresAt)return null;
 const days=Math.ceil((new Date(expiresAt).getTime()-now)/86400000);
 return !Number.isFinite(days)?null:days<=0?'expired':days<=7?'expiring':null;
}
export function customerCookie(token,maxAge=2592000){
 return COOKIE+'='+token+'; Path=/; Max-Age='+maxAge+'; HttpOnly; Secure; SameSite=Strict';
}
function cookieToken(req){
 const found=String(req.headers?.cookie||'').split(';').map(x=>x.trim())
   .find(x=>x.startsWith(COOKIE+'='));
 const token=found?.slice(COOKIE.length+1)||'';
 return /^[A-Za-z0-9_-]{42,44}$/.test(token)?token:null;
}
function browserMutation(req,res,json){
 const origin=String(req.headers?.origin||'');
 if(!ORIGINS.has(origin)||!['same-origin','same-site'].includes(String(req.headers?.['sec-fetch-site']||''))){
  json(res,403,{error:'origin_forbidden'});return false;
 }
 if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/json')){
  json(res,415,{error:'json_required'});return false;
 }
 return true;
}
function renderCode(row,keyHex){
 if(!row?.code_vault||row.revoked_at)throw error('code_unavailable',503);
 const code=decryptStreamCode(row.id,row.code_vault,keyHex);
 if(!code||!equal(streamCodeProof(code,keyHex),row.code_hash))throw error('code_integrity_unavailable',503);
 return {code,sku:row.sku||null,channel:row.channel||row.code_channel,
   durationDays:Number(row.duration_days),activatedAt:row.redeemed_at||null,
   expiresAt:row.expires_at||null,alert:expiryAlert(row.expires_at)};
}
export function createStoreCustomerHandlers({pool,json,readJson,keyHex,
  authorizeAdmin=()=>false,env=process.env,fetchImpl=globalThis.fetch,sendCode}){
 const keyOK=/^[a-f0-9]{64}$/i.test(String(keyHex||''));
 const enabled=env.BLOFY_CUSTOMER_ACCOUNTS_ENABLED==='true'&&keyOK;
 const mailKey=String(env.BLOFY_CUSTOMER_RESEND_API_KEY||'').trim();
 const mailFrom=String(env.BLOFY_CUSTOMER_MAIL_FROM||'').trim();
 const mailReady=typeof sendCode==='function'||(mailKey.startsWith('re_')&&mailFrom.includes('@'));
 // Readiness is distinct from merely having a configured key. A syntactically
 // present key can still be revoked; don't label email delivery "ready" until
 // an actual provider-domain read verifies it. Send-only keys are *unknown*.
 let mailProviderStatus=typeof sendCode==='function'?'test_sender_injected':
   mailReady?'provider_probe_pending':'not_configured';
 // Run a read-only provider domain check after startup. Keys with send-only access
 // cannot query domains: that is inconclusive, NOT a reason to disable sending.
 if(enabled&&mailReady&&typeof sendCode!=='function'){
  const probe=setTimeout(()=>void checkResendSender({mailKey,mailFrom,fetchImpl})
    .then(result=>{
      const allowed=new Set(['verified','key_invalid','key_inspection_unauthorized','key_send_only_cannot_inspect',
        'sender_domain_absent','sender_domain_not_verified','provider_query_failed',
        'provider_probe_unavailable','invalid_config']);
      mailProviderStatus=allowed.has(result?.status)?result.status:'provider_probe_unavailable';
      console.info('[customer-email-readiness]',JSON.stringify(result));
    })
    .catch(()=>{mailProviderStatus='provider_probe_unavailable'}),2000);
  probe.unref?.();
 }
 const reminderEngine=createCustomerReminderEngine({pool,env,fetchImpl});
 reminderEngine.start();
 let migration;
 async function schema(){
  if(!migration)migration=(async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(718420711)');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_customers ('+
      'id UUID PRIMARY KEY,email TEXT NOT NULL UNIQUE,alerts_opt_in BOOLEAN NOT NULL DEFAULT FALSE,'+
      'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),last_login_at TIMESTAMPTZ)');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_customer_challenges ('+
      'email TEXT PRIMARY KEY,code_hash TEXT NOT NULL,attempts SMALLINT NOT NULL DEFAULT 0,'+
      'expires_at TIMESTAMPTZ NOT NULL,issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_customer_sessions ('+
      'token_hash TEXT PRIMARY KEY,customer_id UUID NOT NULL REFERENCES blofy_store_customers(id) ON DELETE CASCADE,'+
      'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_blofy_store_customer_sessions_owner '+
      'ON blofy_store_customer_sessions(customer_id,expires_at)');
    // The order table is initialized by the independent checkout module.
    // Avoid a startup ordering dependency, but only link after its existence is confirmed.
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_customer_orders ('+
      'order_id UUID PRIMARY KEY,customer_id UUID NOT NULL REFERENCES blofy_store_customers(id) ON DELETE CASCADE,'+
      'claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await db.query('CREATE INDEX IF NOT EXISTS idx_blofy_store_customer_orders_owner '+
      'ON blofy_store_customer_orders(customer_id,claimed_at DESC)');
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
  })().catch(e=>{migration=null;throw e;});
  return migration;
 }
 async function sendLogin(email,code){
  if(sendCode)return sendCode(email,code);
  const response=await fetchImpl('https://api.resend.com/emails',{
    method:'POST',headers:{authorization:'Bearer '+mailKey,'content-type':'application/json'},
    body:JSON.stringify({from:mailFrom,to:[email],subject:'رمز الدخول إلى BLOFY',
      text:'رمز دخول BLOFY: '+code+'\nالرمز صالح لمدة 10 دقائق. لا تشاركه مع أحد.'}),
    signal:AbortSignal.timeout(9000)
  });
  if(!response.ok){
   const body=await response.json().catch(()=>({}));
   const classified=classifyResendFailure(response.status,body);
   console.warn('[customer-email-send]',JSON.stringify({httpStatus:response.status,reason:classified.reason}));
   throw error(classified.clientCode,503);
  }
  // POST /emails accepted the request; domain inspection privileges are independent.
  mailProviderStatus='send_accepted';
 }
 async function current(req){
  const token=cookieToken(req);
  if(!token)return null;
  const result=await pool.query('SELECT c.id,c.email,c.alerts_opt_in FROM blofy_store_customer_sessions s '+
    'JOIN blofy_store_customers c ON c.id=s.customer_id '+
    'WHERE s.token_hash=$1 AND s.expires_at>NOW() LIMIT 1',[sha(token)]);
  return result.rows[0]||null;
 }
 async function account(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const orders=(await pool.query(
    'SELECT o.id,o.sku,o.status,o.amount_minor,o.currency,o.created_at,o.paid_at,o.public_order_number,'+
    'o.cart_items,o.duration_days,o.channel FROM blofy_store_customer_orders m '+
    'JOIN blofy_store_geidea_orders o ON o.id=m.order_id WHERE m.customer_id=$1 '+
    'ORDER BY o.created_at DESC LIMIT 100',[customer.id])).rows;
  return json(res,200,{email:customer.email,alertsOptIn:customer.alerts_opt_in,
    orders:orders.map(o=>({orderId:o.id,orderNumber:o.public_order_number||publicOrderNumber(o.id,o.created_at),
      status:o.status,sku:o.sku,items:o.cart_items||null,amountMinor:o.amount_minor,
      currency:o.currency,createdAt:o.created_at,paidAt:o.paid_at}))});
 }
 async function alerts(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  // One bounded query, no voucher decryption, and no per-order HTTP requests.
  const sql='SELECT order_number,channel,expires_at FROM ('+
    'SELECT o.public_order_number AS order_number,v.code_channel AS channel,v.expires_at '+
    'FROM blofy_store_customer_orders m JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
    'JOIN blofy_xtream_gateway_duration_codes v ON v.id=o.voucher_id '+
    "WHERE m.customer_id=$1 AND o.status='paid' "+
    'UNION ALL SELECT o.public_order_number,v.code_channel,v.expires_at '+
    'FROM blofy_store_customer_orders m JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
    'JOIN blofy_store_cart_vouchers cv ON cv.order_id=o.id '+
    'JOIN blofy_xtream_gateway_duration_codes v ON v.id=cv.voucher_id '+
    "WHERE m.customer_id=$1 AND o.status='paid' "+
    'UNION ALL SELECT o.public_order_number,v.code_channel,v.expires_at '+
    'FROM blofy_store_customer_orders m JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
    'JOIN blofy_store_order_vouchers ov ON ov.order_id=o.id '+
    'JOIN blofy_xtream_gateway_duration_codes v ON v.id=ov.voucher_id '+
    "WHERE m.customer_id=$1 AND o.status='paid') x "+
    "WHERE expires_at IS NOT NULL AND expires_at<=NOW()+INTERVAL '7 days' "+
    'ORDER BY expires_at DESC LIMIT 100';
  const rows=(await pool.query(sql,[customer.id])).rows;
  return json(res,200,{alerts:rows.map(row=>({
    orderNumber:row.order_number,channel:row.channel,expiresAt:row.expires_at,
    status:expiryAlert(row.expires_at)
  }))});
 }
 async function adminSummary(req,res){
  const tables=(await pool.query("SELECT "+
    "to_regclass('public.blofy_store_customers') AS customers,"+
    "to_regclass('public.blofy_store_customer_orders') AS orders,"+
    "to_regclass('public.blofy_store_customer_reminders') AS reminders")).rows[0]||{};
  let customers=null,linkedOrders=null,sentReminders=null;
  let recentOtpVerifications=0,lastOtpVerifiedAt=null;
  if(tables.customers){
    const row=(await pool.query('SELECT COUNT(*)::int AS n, '+
      "COUNT(*) FILTER (WHERE last_login_at>NOW()-INTERVAL '24 hours')::int AS recent, "+
      "MAX(last_login_at) FILTER (WHERE last_login_at>NOW()-INTERVAL '24 hours') AS last_verified_at "+
      'FROM blofy_store_customers')).rows[0]||{};
    customers=Number(row.n||0);
    recentOtpVerifications=Number(row.recent||0);
    lastOtpVerifiedAt=row.last_verified_at||null;
  }
  if(tables.orders)linkedOrders=Number((await pool.query(
    'SELECT COUNT(*)::int AS n FROM blofy_store_customer_orders')).rows[0]?.n||0);
  if(tables.reminders)sentReminders=Number((await pool.query(
    'SELECT COUNT(*)::int AS n FROM blofy_store_customer_reminders WHERE sent_at IS NOT NULL')).rows[0]?.n||0);
  return json(res,200,{ok:true,accountsEnabled:enabled,emailConfigured:mailReady,
    emailProviderStatus:mailProviderStatus,
    emailProviderVerified:mailProviderStatus==='verified',
    // A successfully verified OTP is stronger delivery evidence than a GET-only
    // provider domain probe; this is recent history, NOT proof of current API health.
    emailDeliveryVerified:typeof sendCode!=='function'&&recentOtpVerifications>0,
    emailDeliveryEvidence:recentOtpVerifications>0?'otp_verified_within_24h':null,
    lastOtpVerifiedAt,
    remindersEnabled:reminderEngine.configured,customers,linkedOrders,sentReminders,
    livePaymentTestVerified:false});
 }
 async function requestCode(req,res){
  if(!mailReady)return json(res,503,{error:'customer_email_not_configured'});
  if(!maxRequests.consume(requestClientKey(req)).allowed)return json(res,429,{error:'rate_limited'});
  const body=await readJson(req),email=normalizedEmail(body?.email);
  if(!email)return json(res,400,{error:'invalid_email'});
  await schema();
  const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  const saved=await pool.query('INSERT INTO blofy_store_customer_challenges(email,code_hash,attempts,expires_at) '+
    "VALUES($1,$2,0,NOW()+INTERVAL '10 minutes') ON CONFLICT(email) DO UPDATE "+
    "SET code_hash=EXCLUDED.code_hash,attempts=0,expires_at=EXCLUDED.expires_at,issued_at=NOW() "+
    "WHERE blofy_store_customer_challenges.issued_at<NOW()-INTERVAL '60 seconds' RETURNING email",
    [email,codeProof(keyHex,email,code)]);
  if(saved.rowCount)try{await sendLogin(email,code);}
  catch(e){
   await pool.query('DELETE FROM blofy_store_customer_challenges WHERE email=$1 AND code_hash=$2',
     [email,codeProof(keyHex,email,code)]).catch(()=>{});
   // Only curated failure codes are exposed; never pass provider text, keys or email content.
   const reason=/^customer_email_(key_invalid|domain_unverified|sender_restricted|provider_rate_limited|sender_invalid)$/.test(e?.message||'')
     ?e.message:'customer_email_unavailable';
   if(reason==='customer_email_unavailable')console.warn('[customer-email-send]',JSON.stringify({reason:'network_or_timeout'}));
   return json(res,503,{error:reason});
  }
  return json(res,202,{ok:true,message:'check_email'});
 }
 async function verifyCode(req,res){
  if(!maxVerifies.consume(requestClientKey(req)).allowed)return json(res,429,{error:'rate_limited'});
  const body=await readJson(req),email=normalizedEmail(body?.email),code=body?.code;
  if(!email||typeof code!=='string'||!/^\d{6}$/.test(code))
    return json(res,400,{error:'invalid_login_code'});
  await schema();
  const db=await pool.connect();
  let token=null;
  try{
   await db.query('BEGIN');
   const row=(await db.query('SELECT * FROM blofy_store_customer_challenges WHERE email=$1 FOR UPDATE',[email])).rows[0];
   if(!row||row.attempts>=5||new Date(row.expires_at).getTime()<=Date.now()){
    await db.query('COMMIT');return json(res,401,{error:'login_code_incorrect'});
   }
   if(!equal(row.code_hash,codeProof(keyHex,email,code))){
    await db.query('UPDATE blofy_store_customer_challenges SET attempts=attempts+1 WHERE email=$1',[email]);
    await db.query('COMMIT');return json(res,401,{error:'login_code_incorrect'});
   }
   await db.query('DELETE FROM blofy_store_customer_challenges WHERE email=$1',[email]);
   const customer=(await db.query('INSERT INTO blofy_store_customers(id,email,last_login_at) '+
    'VALUES($1,$2,NOW()) ON CONFLICT(email) DO UPDATE SET last_login_at=NOW() RETURNING id',
    [crypto.randomUUID(),email])).rows[0];
   token=crypto.randomBytes(32).toString('base64url');
   await db.query("INSERT INTO blofy_store_customer_sessions(token_hash,customer_id,expires_at) "+
    "VALUES($1,$2,NOW()+INTERVAL '30 days')",[sha(token),customer.id]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
  return json(res,200,{ok:true}, {'set-cookie':customerCookie(token)});
 }
 async function linkCheckoutOrder(req,orderId,accessToken){
  if(!enabled||!UUID.test(orderId||'')||!ACCESS.test(accessToken||''))return false;
  const customer=await current(req);
  if(!customer)return false;
  const inserted=await pool.query('INSERT INTO blofy_store_customer_orders(order_id,customer_id) '+
    'SELECT id,$2 FROM blofy_store_geidea_orders WHERE id=$1 AND access_hash=$3 '+
    'ON CONFLICT(order_id) DO NOTHING',[orderId,customer.id,sha(accessToken)]);
  return inserted.rowCount>0;
 }
 async function claim(req,res){
  if(!maxClaims.consume(requestClientKey(req)).allowed)return json(res,429,{error:'rate_limited'});
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const body=await readJson(req);
  if(!UUID.test(body?.orderId||'')||!ACCESS.test(body?.accessToken||''))
   return json(res,400,{error:'invalid_order_access'});
  const h=sha(body.accessToken);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const row=(await db.query('SELECT id,access_hash FROM blofy_store_geidea_orders WHERE id=$1 FOR UPDATE',
     [body.orderId])).rows[0];
   if(!row||!equal(row.access_hash,h)){
    await db.query('ROLLBACK');return json(res,404,{error:'order_not_found'});
   }
   await db.query('INSERT INTO blofy_store_customer_orders(order_id,customer_id) '+
    'VALUES($1,$2) ON CONFLICT(order_id) DO NOTHING',[row.id,customer.id]);
   const owner=(await db.query('SELECT customer_id FROM blofy_store_customer_orders WHERE order_id=$1',
     [row.id])).rows[0];
   if(owner?.customer_id!==customer.id){
    await db.query('ROLLBACK');return json(res,409,{error:'order_already_linked'});
   }
   await db.query('COMMIT');
   return json(res,200,{ok:true,orderId:row.id});
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}finally{db.release();}
 }
 async function receipt(req,res,id){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const order=(await pool.query('SELECT o.* FROM blofy_store_customer_orders m '+
    'JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
    'WHERE m.customer_id=$1 AND m.order_id=$2',[customer.id,id])).rows[0];
  if(!order)return json(res,404,{error:'order_not_found'});
  const out={orderId:order.id,orderNumber:order.public_order_number||publicOrderNumber(order.id,order.created_at),
    sku:order.sku,status:order.status,amountMinor:order.amount_minor,currency:'SAR',
    createdAt:order.created_at,paidAt:order.paid_at,fulfilled:false,codes:[]};
  if(order.status!=='paid')return json(res,200,out);
  let rows=[],expected=null;
  if(order.sku==='cart'){
   expected=cartVouchers(order.cart_items);
   if(!parseStoreCart(order.cart_items)||!expected)return json(res,503,{error:'order_integrity_unavailable'});
   rows=(await pool.query('SELECT cv.position,cv.sku,cv.channel,cv.duration_days,'+
    'v.id,v.code_hash,v.code_vault,v.revoked_at,v.redeemed_at,v.expires_at '+
    'FROM blofy_store_cart_vouchers cv JOIN blofy_xtream_gateway_duration_codes v ON v.id=cv.voucher_id '+
    'WHERE cv.order_id=$1 ORDER BY cv.position',[id])).rows;
  }else if(order.sku==='bundle-2y'){
   expected=[...(order.bundle_selection||[])].map(channel=>({channel,durationDays:365}));
   if(expected.length!==2)return json(res,503,{error:'order_integrity_unavailable'});
   rows=(await pool.query('SELECT ov.position,ov.channel,365 AS duration_days,'+
    'v.id,v.code_hash,v.code_vault,v.revoked_at,v.redeemed_at,v.expires_at '+
    'FROM blofy_store_order_vouchers ov JOIN blofy_xtream_gateway_duration_codes v ON v.id=ov.voucher_id '+
    'WHERE ov.order_id=$1 ORDER BY ov.position',[id])).rows;
  }else{
   if(!order.voucher_id)return json(res,503,{error:'order_delivery_unavailable'});
   expected=[{channel:order.channel,durationDays:Number(order.duration_days)}];
   rows=(await pool.query('SELECT v.id,v.code_channel AS channel,v.duration_days,v.code_hash,'+
    'v.code_vault,v.revoked_at,v.redeemed_at,v.expires_at FROM blofy_xtream_gateway_duration_codes v '+
    'WHERE v.id=$1',[order.voucher_id])).rows;
  }
  if(rows.length!==expected.length||rows.some((r,i)=>r.channel!==expected[i].channel||
      Number(r.duration_days)!==Number(expected[i].durationDays)||
      (expected[i].sku&&r.sku!==expected[i].sku)))
    return json(res,503,{error:'order_delivery_unavailable'});
  try{out.codes=rows.map(r=>renderCode(r,keyHex));}
  catch{return json(res,503,{error:'order_delivery_unavailable'});}
  out.fulfilled=true;
  return json(res,200,out);
 }
 async function preferences(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const body=await readJson(req);
  if(typeof body?.alertsOptIn!=='boolean')return json(res,400,{error:'invalid_preferences'});
  await pool.query('UPDATE blofy_store_customers SET alerts_opt_in=$2 WHERE id=$1',
    [customer.id,body.alertsOptIn]);
  // This flag records consent; an email reminder worker is NOT enabled by this endpoint.
  return json(res,200,{ok:true,alertsOptIn:body.alertsOptIn,
    delivery:reminderEngine.configured?'email_when_eligible':'dashboard_only'});
 }
 async function logout(req,res){
  const token=cookieToken(req);
  if(token)await pool.query('DELETE FROM blofy_store_customer_sessions WHERE token_hash=$1',[sha(token)]);
  return json(res,200,{ok:true},{'set-cookie':customerCookie('',0)});
 }
 const handler=async function handler(req,res,url){
  const path=url.pathname;
  if(path==='/api/v1/admin/store/customer-accounts/summary'&&req.method==='GET'){
   if(!authorizeAdmin(req,res))return true;
   await adminSummary(req,res);return true;
  }
  if(!path.startsWith('/api/v1/store/account'))return false;
  if(!enabled){json(res,503,{error:'customer_accounts_disabled'});return true;}
  if(req.method==='POST'&&!browserMutation(req,res,json))return true;
  try{
   await schema();
   if(path==='/api/v1/store/account/request-code'&&req.method==='POST')await requestCode(req,res);
   else if(path==='/api/v1/store/account/verify-code'&&req.method==='POST')await verifyCode(req,res);
   else if(path==='/api/v1/store/account/claim'&&req.method==='POST')await claim(req,res);
   else if(path==='/api/v1/store/account/preferences'&&req.method==='POST')await preferences(req,res);
   else if(path==='/api/v1/store/account/logout'&&req.method==='POST')await logout(req,res);
   else if(path==='/api/v1/store/account'&&req.method==='GET')await account(req,res);
   else if(path==='/api/v1/store/account/alerts'&&req.method==='GET')await alerts(req,res);
   else if(/^\/api\/v1\/store\/account\/orders\/[a-fA-F0-9-]{36}$/.test(path)&&req.method==='GET')
     await receipt(req,res,path.split('/').at(-1));
   else json(res,404,{error:'not_found'});
  }catch(e){if(e.status)json(res,e.status,{error:e.message});else throw e;}
  return true;
 };
 handler.linkCheckoutOrder=linkCheckoutOrder;
 return handler;
}

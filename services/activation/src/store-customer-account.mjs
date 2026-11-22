// Optional BLOFY customer portal. It NEVER replaces guest checkout or treats a browser redirect as paid.
// Orders may only be linked with their existing 256-bit guest access token.
import crypto from 'node:crypto';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';
import {parseStoreCart,parseSavedStoreCart,cartVouchers,publicOrderNumber} from './store-cart.mjs';
import {decryptStreamCode} from './xtream-code-vault.mjs';
import {decryptGatewayAccountPassword} from './xtream-account-vault.mjs';
import {normalizeXtreamPublicOrigin} from './xtream-public-origin.mjs';
import {streamCodeProof} from './xtream-duration-codes.mjs';
import {createCustomerReminderEngine} from './store-customer-reminders.mjs';
import {preparePaidLeadSchema,listPaidLeads,updatePaidLeadFollowup} from './store-paid-leads.mjs';
import {buildStorePaymentReceipt,createStoreReceiptEmailEngine} from './store-order-receipts.mjs';
import {classifyResendFailure,checkResendSender} from './store-customer-resend.mjs';
import {createStoreSubscriptionAdmin} from './store-subscription-admin.mjs';
import {PAID_OWNED_VOUCHERS_SQL,renewalStartAndExpiry} from './store-same-code-renewal.mjs';
import {publicStorePlans} from './store-geidea-checkout.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS=/^[A-Za-z0-9_-]{42,44}$/;
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}$/;
const COOKIE='__Host-blofy_customer';
const ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const maxRequests=createFixedWindowLimiter({limit:5,windowMs:600000});
const maxVerifies=createFixedWindowLimiter({limit:12,windowMs:600000});
const maxClaims=createFixedWindowLimiter({limit:20,windowMs:600000});
const maxProfiles=createFixedWindowLimiter({limit:8,windowMs:600000});
// Phone number is collected for customer contact and one-trial-per-phone
// enforcement. It is NOT SMS-verified: do not imply phone ownership verification.
export function normalizeCustomerPhone(input){
 const digits=String(input||'').trim().replace(/[\s()\-]/g,'');
 if(/^05[0-9]{8}$/.test(digits))return '+966'+digits.slice(1);
 if(/^5[0-9]{8}$/.test(digits))return '+966'+digits;
 if(/^\+9665[0-9]{8}$/.test(digits))return digits;
 if(/^009665[0-9]{8}$/.test(digits))return '+'+digits.slice(2);
 return null;
}
export function normalizeCustomerName(input){
 const name=String(input||'').trim().replace(/\s+/g,' ');
 if(name.length<2||name.length>100||/[<>\u0000-\u001f]/.test(name))return null;
 return name;
}
const completeProfile=customer=>Boolean(customer?.full_name&&customer?.phone_e164);
// Verified email + paid-order ownership is required for all password recovery.
const maxReveals=createFixedWindowLimiter({limit:10,windowMs:600000});
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
// The optional linked player account may have no expiry timestamp.
 // Date(null) is 1970-01-01, NOT a valid subscription expiry.
 // Never show a purchase or unredeemed voucher as already expired.
export function safeOwnedSubscriptionExpiry(row){
 if(!row?.redeemed_at||!row?.expires_at)return null;
 const voucherExpiry=new Date(row.expires_at).getTime();
 if(!Number.isFinite(voucherExpiry)||voucherExpiry<=0)return null;
 const linkedExpiry=row.account_expires_at==null?null:
   new Date(row.account_expires_at).getTime();
 const effective=Number.isFinite(linkedExpiry)&&linkedExpiry>0
   ?Math.min(voucherExpiry,linkedExpiry):voucherExpiry;
 return new Date(effective).toISOString();
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
 const loginRequiredForStore=env.BLOFY_STORE_REQUIRE_CUSTOMER_LOGIN==='true';
 const profileRequired=env.BLOFY_CUSTOMER_PROFILE_REQUIRED==='true';
 let reconcileOwnedPayment=async()=>false;
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
      const allowed=new Set(['verified','key_invalid','key_send_only_cannot_inspect',
        'key_inspection_unauthorized','send_accepted',
        'sender_domain_absent','sender_domain_not_verified','provider_query_failed',
        'provider_probe_unavailable','invalid_config']);
      mailProviderStatus=allowed.has(result?.status)?result.status:'provider_probe_unavailable';
      console.info('[customer-email-readiness]',JSON.stringify(result));
    })
    .catch(()=>{mailProviderStatus='provider_probe_unavailable'}),2000);
  probe.unref?.();
 }
 const reminderEngine=createCustomerReminderEngine({pool,env,fetchImpl});
 const receiptEmailEngine=createStoreReceiptEmailEngine({pool,env,fetchImpl});
 let ensureOpsSchema=async()=>{};
 const subscriptionAdmin=createStoreSubscriptionAdmin({pool,json,authorizeAdmin,
   ensureStoreSchema:()=>ensureOpsSchema()});
 reminderEngine.start();
 receiptEmailEngine.start();
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
    await db.query('ALTER TABLE blofy_store_customers ADD COLUMN IF NOT EXISTS full_name TEXT');
    await db.query('ALTER TABLE blofy_store_customers ADD COLUMN IF NOT EXISTS phone_e164 TEXT');
    // Optional BLOFY promotional offers; reminders use a different consent flag.
    await db.query('ALTER TABLE blofy_store_customers ADD COLUMN IF NOT EXISTS marketing_consent_at TIMESTAMPTZ');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_blofy_store_customer_phone_unique '+
      'ON blofy_store_customers(phone_e164) WHERE phone_e164 IS NOT NULL');
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
    // A customer can save only catalog SKUs, quantities and an optional coupon;
    // prices, card data, codes and tokens never enter the cart table.
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_customer_carts ('+
      'customer_id UUID PRIMARY KEY REFERENCES blofy_store_customers(id) ON DELETE CASCADE,'+
      "items JSONB NOT NULL DEFAULT '[]'::jsonb,coupon_code TEXT,"+
      'revision BIGINT NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
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
   if(classified.reason==='invalid_api_key')mailProviderStatus='key_invalid';
   console.warn('[customer-email-send]',JSON.stringify({httpStatus:response.status,reason:classified.reason}));
   throw error(classified.clientCode,503);
  }
  mailProviderStatus='send_accepted';
 }
 async function current(req){
  const token=cookieToken(req);
  if(!token)return null;
  const result=await pool.query('SELECT c.id,c.email,c.alerts_opt_in,c.marketing_consent_at,c.full_name,c.phone_e164 FROM blofy_store_customer_sessions s '+
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
  return json(res,200,{customerId:customer.id,email:customer.email,fullName:customer.full_name||'',phone:customer.phone_e164||'',profileComplete:completeProfile(customer),profileRequired,alertsOptIn:customer.alerts_opt_in,
   marketingOptIn:Boolean(customer.marketing_consent_at),
    orders:orders.map(o=>({orderId:o.id,orderNumber:o.public_order_number||publicOrderNumber(o.id,o.created_at),
      status:o.status,sku:o.sku,items:o.cart_items||null,amountMinor:o.amount_minor,
      currency:o.currency,createdAt:o.created_at,paidAt:o.paid_at}))});
 }
 async function subscriptions(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  // Only previously paid-and-owned vouchers appear. This endpoint never
  // decrypts or discloses codes or account credentials.
  const rows=(await pool.query(
    'SELECT DISTINCT v.id,v.code_hint,v.code_channel,v.redeemed_at,'+
    'v.expires_at,v.revoked_at,v.account_id,v.code_vault,'+
    'a.enabled AS account_enabled,a.expires_at AS account_expires_at '+
    'FROM ('+PAID_OWNED_VOUCHERS_SQL+') owned '+
    'JOIN blofy_xtream_gateway_duration_codes v ON v.id=owned.voucher_id '+
    'LEFT JOIN blofy_xtream_gateway_accounts a ON a.id=v.account_id '+
    'ORDER BY v.id LIMIT 100',[customer.id])).rows;
  return json(res,200,{ok:true,
   renewalsAvailable:env.BLOFY_STORE_SAME_CODE_RENEWAL_ENABLED==='true'&&loginRequiredForStore&&
     env.BLOFY_STORE_GEIDEA_ENABLED==='true',
   subscriptions:rows.map(row=>{
    const eligible=Boolean(renewalStartAndExpiry(row,90));
    const expiresAt=safeOwnedSubscriptionExpiry(row);
    return {voucherId:row.id,codeHint:row.code_hint||'',
      channel:row.code_channel,redeemed:!!row.redeemed_at,accountEnabled:row.account_enabled===true,expiresAt,canRenew:eligible,
      reason:eligible?null:row.revoked_at?'revoked':!row.redeemed_at?'not_activated':'not_eligible'};
   }),
   plans:publicStorePlans().map(x=>({sku:x.sku,channel:x.channel,
     durationDays:x.durationDays,priceMinor:x.priceMinor,currency:x.currency}))});
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
  let recentOtpVerified=0,lastOtpVerifiedAt=null;
  if(tables.customers){
   const evidence=(await pool.query(
    "SELECT COUNT(*)::int AS n, "+
    "COUNT(*) FILTER (WHERE last_login_at>NOW()-INTERVAL '24 hours')::int AS recent, "+
    "MAX(last_login_at) FILTER (WHERE last_login_at>NOW()-INTERVAL '24 hours') AS last_verified_at "+
    'FROM blofy_store_customers')).rows[0]||{};
   customers=Number(evidence.n||0);
   recentOtpVerified=Number(evidence.recent||0);
   lastOtpVerifiedAt=evidence.last_verified_at||null;
  }
  if(tables.orders)linkedOrders=Number((await pool.query(
    'SELECT COUNT(*)::int AS n FROM blofy_store_customer_orders')).rows[0]?.n||0);
  if(tables.reminders)sentReminders=Number((await pool.query(
    'SELECT COUNT(*)::int AS n FROM blofy_store_customer_reminders WHERE sent_at IS NOT NULL')).rows[0]?.n||0);
  return json(res,200,{ok:true,accountsEnabled:enabled,emailConfigured:mailReady,
    emailProviderStatus:mailProviderStatus,
    emailProviderVerified:mailProviderStatus==='verified',
    // A verified OTP within the last 24h is real evidence of a successful
    // customer login, not merely successful provider domain lookup.
    // Historical evidence does NOT prove the provider works at this moment.
    emailDeliveryVerified:typeof sendCode!=='function'&&recentOtpVerified>0,
    emailDeliveryEvidence:recentOtpVerified>0?'otp_verified_within_24h':null,
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
 async function saveProfile(req,res){
   if(!maxProfiles.consume(requestClientKey(req)).allowed)
     return json(res,429,{error:'rate_limited'});
   const customer=await current(req);
   if(!customer)return json(res,401,{error:'login_required'});
   const body=await readJson(req);
   const name=normalizeCustomerName(body?.fullName),phone=normalizeCustomerPhone(body?.phone);
   if(!name||!phone)return json(res,400,{error:'invalid_customer_profile'});
   try{
     const saved=await pool.query('UPDATE blofy_store_customers '+
       'SET full_name=$2,phone_e164=$3 WHERE id=$1 RETURNING id,full_name,phone_e164',
       [customer.id,name,phone]);
     if(!saved.rowCount)return json(res,401,{error:'login_required'});
   }catch(e){
     if(e.code==='23505')return json(res,409,{error:'customer_phone_in_use'});
     throw e;
   }
   return json(res,200,{ok:true,fullName:name,phone,profileComplete:true});
 }
 async function checkoutIdentity(req){
  if(!loginRequiredForStore)return {ok:true,guestCheckoutAllowed:true};
  if(!enabled||!mailReady)return {ok:false,status:503,error:'store_login_unavailable'};
  await schema();
  const customer=await current(req);
  if(!customer)return {ok:false,status:401,error:'customer_login_required'};
  if(profileRequired&&!completeProfile(customer))return {ok:false,status:403,error:'customer_profile_required'};
  return {ok:true,customerId:customer.id};
 }
 async function savedCart(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const row=(await pool.query(
    'SELECT items,coupon_code,revision,updated_at FROM blofy_store_customer_carts WHERE customer_id=$1',
    [customer.id])).rows[0];
  return json(res,200,{ok:true,items:row?.items||[],couponCode:row?.coupon_code||'',
    revision:Number(row?.revision||0),updatedAt:row?.updated_at||null});
 }
 async function saveCart(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const body=await readJson(req);
  const raw=body?.items;
  const savedItems=parseSavedStoreCart(raw);
  if(!savedItems)return json(res,400,{error:'store_invalid_cart'});
  const coupon=typeof body?.couponCode==='string'
    ?body.couponCode.trim().toUpperCase():'';
  if(coupon&&!/^[A-Z0-9][A-Z0-9_-]{3,19}$/.test(coupon))
    return json(res,400,{error:'store_invalid_coupon'});
  // Prevent old tabs from resurrecting a recently deleted or paid cart.
  const revision=body?.revision;
  if(!Number.isSafeInteger(revision)||revision<0)
    return json(res,400,{error:'store_invalid_cart_revision'});
  const row=(await pool.query(
    'INSERT INTO blofy_store_customer_carts(customer_id,items,coupon_code,revision) '+
    'VALUES($1,$2::jsonb,$3,1) ON CONFLICT(customer_id) DO UPDATE SET '+
    'items=EXCLUDED.items,coupon_code=EXCLUDED.coupon_code,'+
    'revision=blofy_store_customer_carts.revision+1,updated_at=NOW() '+
    'WHERE blofy_store_customer_carts.revision=$4 RETURNING revision,updated_at',
    [customer.id,JSON.stringify(savedItems),coupon||null,revision])).rows[0];
  if(!row)return json(res,409,{error:'store_cart_changed_on_another_device'});
  return json(res,200,{ok:true,revision:Number(row.revision),updatedAt:row.updated_at});
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
 // One controlled credential reveal for an ACTIVE, already redeemed Xtream
 // voucher belonging to an authenticated, paid-order customer. No issuance.
 async function ownedXtreamCredentials(req,res,id){
  if(!UUID.test(id||''))return json(res,400,{error:'invalid_voucher_id'});
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  if(!maxReveals.consume(requestClientKey(req)+':'+customer.id).allowed)
   return json(res,429,{error:'credential_reveal_rate_limited'});
  const body=await readJson(req);
  if(body?.acknowledge!==true)
   return json(res,400,{error:'credential_reveal_confirmation_required'});
  const origin=normalizeXtreamPublicOrigin(env.BLOFY_XTREAM_PUBLIC_ORIGIN);
  if(!origin)return json(res,503,{error:'xtream_host_not_ready'});
  const row=(await pool.query(
    'SELECT v.id,v.code_channel,v.redeemed_at,v.expires_at,v.revoked_at,v.account_id,'+
    'a.id AS account_identity,a.username,a.credential_vault,a.enabled,a.expires_at AS account_expiry '+
    'FROM blofy_xtream_gateway_duration_codes v '+
    'LEFT JOIN blofy_xtream_gateway_accounts a ON a.id=v.account_id '+
    'WHERE v.id=$2 AND EXISTS (SELECT 1 FROM ('+PAID_OWNED_VOUCHERS_SQL+
    ') owned WHERE owned.voucher_id=v.id) LIMIT 1',[customer.id,id])).rows[0];
  if(!row)return json(res,404,{error:'owned_subscription_not_found'});
  if(row.code_channel!=='xtream')
   return json(res,409,{error:'not_an_xtream_subscription'});
  if(!row.redeemed_at||!row.account_id)
   return json(res,409,{error:'activate_xtream_first'});
  const voucherExpiry=new Date(row.expires_at).getTime();
  const accountExpiry=new Date(row.account_expiry).getTime();
  if(row.revoked_at||row.enabled!==true||row.account_identity!==row.account_id||
     !Number.isFinite(voucherExpiry)||!Number.isFinite(accountExpiry)||
     Math.min(voucherExpiry,accountExpiry)<=Date.now())
   return json(res,409,{error:'subscription_expired_or_disabled'});
  const password=decryptGatewayAccountPassword(row.account_id,row.credential_vault,keyHex);
  if(!password||!row.username)
   return json(res,409,{error:'credential_not_recoverable'});
  const query=new URLSearchParams({
   username:row.username,password,type:'m3u_plus',output:'ts'
  });
  return json(res,200,{ok:true,subscriptionUnchanged:true,
   credentials:{serverUrl:origin,port:443,username:row.username,password,
    m3uUrl:origin+'/get.php?'+query.toString()},
   expiresAt:new Date(Math.min(voucherExpiry,accountExpiry)).toISOString()},
   {'cache-control':'no-store, private','pragma':'no-cache',
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
 }
 // The universal extractor recovers ALREADY-ACTIVATED credentials only
 // for the OTP-verified owner of this exact code. Original voucher code
 // alone is NOT authorization for disclosing an active subscriber's password.
 async function ownedUniversalXtream(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{ok:false,error:'stream_extraction_login_required'});
  if(!maxReveals.consume(requestClientKey(req)+':'+customer.id).allowed)
   return json(res,429,{ok:false,error:'credential_reveal_rate_limited'});
  const body=await readJson(req);
  if(body?.acknowledge!==true)
   return json(res,400,{ok:false,error:'credential_reveal_confirmation_required'});
  const proof=streamCodeProof(body?.code,keyHex);
  if(!proof)return json(res,400,{ok:false,error:'stream_code_invalid'});
  // Prepare existing paid voucher/cart ownership tables without starting
  // checkout or changing payments. Trial-only users may have no paid orders.
  await ensureOpsSchema();
  const origin=normalizeXtreamPublicOrigin(env.BLOFY_XTREAM_PUBLIC_ORIGIN);
  if(!origin)return json(res,503,{ok:false,error:'xtream_host_not_ready'});
  // The trial table is optional if no free stock has ever been created.
  const trialReady=(await pool.query(
   "SELECT to_regclass('public.blofy_store_trial_inventory') AS table_name"
  )).rows[0]?.table_name;
  const trialExists=trialReady?
   ` OR EXISTS(SELECT 1 FROM blofy_store_trial_inventory t
    WHERE t.voucher_id=v.id AND t.customer_id=$1
     AND t.claimed_at IS NOT NULL)`:'';
  const sql=`SELECT v.id,v.code_channel,v.duration_days,v.redeemed_at,
   v.expires_at,v.revoked_at,v.account_id,
   a.id AS account_identity,a.username,a.credential_vault,a.enabled,
   a.expires_at AS account_expiry
   FROM blofy_xtream_gateway_duration_codes v
   LEFT JOIN blofy_xtream_gateway_accounts a ON a.id=v.account_id
   WHERE v.code_hash=$2 AND
    (EXISTS(SELECT 1 FROM (${PAID_OWNED_VOUCHERS_SQL}) paid
      WHERE paid.voucher_id=v.id)${trialExists})
   LIMIT 1`;
  const row=(await pool.query(sql,[customer.id,proof])).rows[0];
  if(!row)return json(res,404,{ok:false,error:'stream_extraction_not_owned'});
  if(!row.redeemed_at||!row.account_id)
   return json(res,409,{ok:false,error:'stream_extraction_not_activated'});
  const cExpiry=new Date(row.expires_at).getTime();
  const aExpiry=new Date(row.account_expiry).getTime();
  if(row.revoked_at||row.enabled!==true||row.account_identity!==row.account_id||
     !Number.isFinite(cExpiry)||!Number.isFinite(aExpiry)||
     Math.min(cExpiry,aExpiry)<=Date.now())
   return json(res,409,{ok:false,error:'subscription_expired_or_disabled'});
  const password=decryptGatewayAccountPassword(row.account_id,row.credential_vault,keyHex);
  if(!password||!row.username)
   return json(res,409,{ok:false,error:'credential_not_recoverable'});
  const args=new URLSearchParams({
   username:row.username,password,type:'m3u_plus',output:'ts'
  });
  return json(res,200,{
   ok:true,recovered:true,universalExtraction:true,subscriptionUnchanged:true,
   originalVoucherPreserved:true,
   account:{id:row.account_id,
    activatedAt:new Date(row.redeemed_at).getTime(),
    expiresAt:Math.min(cExpiry,aExpiry),durationDays:Number(row.duration_days)},
   credentials:{serverUrl:origin,port:443,username:row.username,password,
    m3uUrl:origin+'/get.php?'+args.toString()}
  },{'cache-control':'no-store, private','pragma':'no-cache',
    'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
 }
 async function paymentReceipt(req,res,id){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const order=(await pool.query(
   'SELECT o.* FROM blofy_store_customer_orders m '+
   'JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
   'WHERE m.customer_id=$1 AND o.id=$2',[customer.id,id])).rows[0];
  if(!order)return json(res,404,{error:'order_not_found'});
  if(order.status!=='paid')return json(res,409,{error:'payment_not_confirmed'});
  const payment=buildStorePaymentReceipt(order);
  if(!payment)return json(res,503,{error:'receipt_not_available'});
  // Receipt contains NO code, bearer link, card number or customer email.
  return json(res,200,payment,{'cache-control':'no-store'});
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
  if(order.sku==='renewal'){
   // Renewal is a verified payment for the SAME existing voucher.
   // It does not create a fresh voucher or overwrite its original duration.
   const renewed=(await pool.query(
     'SELECT v.id,v.code_hash,v.code_vault,v.revoked_at,v.redeemed_at,'+
     'v.expires_at,v.duration_days,v.code_channel AS channel FROM blofy_store_renewal_orders r '+
     'JOIN blofy_xtream_gateway_duration_codes v ON v.id=r.voucher_id '+
     'WHERE r.order_id=$1',[id])).rows[0];
   if(!renewed)return json(res,503,{error:'order_delivery_unavailable'});
   expected=[{channel:order.channel,durationDays:Number(renewed.duration_days)}];
   rows=[renewed];
   out.renewalDays=Number(order.duration_days);
   out.sameCodeRenewal=true;
  }else if(order.sku==='cart'){
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
 // Authenticated order-status refresh: no receipt bearer token required.
 // Every provider query is gated by order ownership and an atomic DB cooldown.
 async function refreshOwnedPayment(req,res,id){
   if(!UUID.test(id||''))return json(res,400,{error:'invalid_order_id'});
   const customer=await current(req);
   if(!customer)return json(res,401,{error:'login_required'});
   const order=(await pool.query(
     'SELECT o.id,o.status,o.session_id FROM blofy_store_customer_orders m '+
     'JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
     'WHERE m.customer_id=$1 AND o.id=$2',[customer.id,id])).rows[0];
   if(!order)return json(res,404,{error:'order_not_found'});
   let checked=false,providerUnavailable=false;
   if(order.status==='pending'&&order.session_id){
     // Limit provider calls across app instances and open tabs; paid orders are
     // immutable after successful verified fulfillment.
     const lease=await pool.query(
       'UPDATE blofy_store_geidea_orders SET last_checked_at=NOW() '+
       "WHERE id=$1 AND status='pending' AND session_id IS NOT NULL "+
       "AND (last_checked_at IS NULL OR last_checked_at<NOW()-INTERVAL '15 seconds') "+
       'RETURNING id',[id]);
     if(lease.rowCount){
       checked=true;
       try{await reconcileOwnedPayment(id);}
       catch(e){
         providerUnavailable=true;
         console.warn('[customer-payment-check]',JSON.stringify({reason:
           e?.status===503?'provider_unavailable':e?.status===409?'provider_mismatch_or_delivery':'reconciliation_failed'}));
       }
     }
   }
   // Never infer payment success from the Geidea redirect alone.
   // Return confirmed server order status; no private code or access token here.
   const latest=(await pool.query(
     'SELECT o.status,o.paid_at FROM blofy_store_customer_orders m '+
     'JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
     'WHERE m.customer_id=$1 AND o.id=$2',[customer.id,id])).rows[0];
   return json(res,200,{ok:true,orderId:id,status:latest?.status||order.status,
     confirmedPaid:latest?.status==='paid',paidAt:latest?.paid_at||null,
     checked,providerUnavailable});
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
 async function marketingPreferences(req,res){
  const customer=await current(req);
  if(!customer)return json(res,401,{error:'login_required'});
  const body=await readJson(req);
  if(typeof body?.marketingOptIn!=='boolean')
   return json(res,400,{error:'invalid_marketing_preferences'});
  const updated=await pool.query(`UPDATE blofy_store_customers
   SET marketing_consent_at=CASE WHEN $2::boolean THEN NOW() ELSE NULL END
   WHERE id=$1 RETURNING marketing_consent_at`,[customer.id,body.marketingOptIn]);
  if(updated.rowCount!==1)return json(res,404,{error:'customer_not_found'});
  return json(res,200,{ok:true,marketingOptIn:Boolean(updated.rows[0].marketing_consent_at),
   promotionalMessagesSent:0},
   {'cache-control':'no-store, private','referrer-policy':'no-referrer'});
 }
 let paidLeadsReady=null;
 async function ensurePaidLeads(){
  if(!paidLeadsReady)paidLeadsReady=(async()=>{
    await schema();
    await ensureOpsSchema();
    await preparePaidLeadSchema(pool);
  })().catch(error=>{paidLeadsReady=null;throw error});
  return paidLeadsReady;
 }
 async function paidLeads(req,res,route){
  if(!authorizeAdmin(req,res))return;
  if(!browserMutation(req,res,json))return;
  await ensurePaidLeads();
  const body=await readJson(req);
  const safeHeaders={'cache-control':'no-store, private','referrer-policy':'no-referrer'};
  try{
   const payload=route==='followup'?
    await updatePaidLeadFollowup(pool,body):
    await listPaidLeads(pool,body);
   return json(res,200,payload,safeHeaders);
  }catch(error){
   if(error.status)return json(res,error.status,{error:error.message},safeHeaders);
   throw error;
  }
 }
 async function logout(req,res){
  const token=cookieToken(req);
  if(token)await pool.query('DELETE FROM blofy_store_customer_sessions WHERE token_hash=$1',[sha(token)]);
  return json(res,200,{ok:true},{'set-cookie':customerCookie('',0)});
 }
 const handler=async function handler(req,res,url){
  const path=url.pathname;
  if(path==='/api/v1/admin/store/subscription-operations'&&req.method==='GET'){
   await subscriptionAdmin.handler(req,res,url);return true;
  }
  if(path==='/api/v1/admin/store/customer-accounts/summary'&&req.method==='GET'){
   if(!authorizeAdmin(req,res))return true;
   await adminSummary(req,res);return true;
  }
  if(req.method==='POST'&&path==='/api/v1/admin/store/paid-leads'){
   await paidLeads(req,res,'list');return true;
  }
  if(req.method==='POST'&&path==='/api/v1/admin/store/paid-leads/followup'){
   await paidLeads(req,res,'followup');return true;
  }
  if(!path.startsWith('/api/v1/store/account'))return false;
  if(!enabled){json(res,503,{error:'customer_accounts_disabled'});return true;}
  if(req.method==='POST'&&!browserMutation(req,res,json))return true;
  try{
   await schema();
   if(path==='/api/v1/store/account/cart'&&req.method==='GET')await savedCart(req,res);
   else if(path==='/api/v1/store/account/cart'&&req.method==='POST')await saveCart(req,res);
   else if(path==='/api/v1/store/account/request-code'&&req.method==='POST')await requestCode(req,res);
   else if(path==='/api/v1/store/account/verify-code'&&req.method==='POST')await verifyCode(req,res);
   else if(path==='/api/v1/store/account/profile'&&req.method==='POST')await saveProfile(req,res);
   else if(path==='/api/v1/store/account/claim'&&req.method==='POST')await claim(req,res);
   else if(path==='/api/v1/store/account/preferences'&&req.method==='POST')await preferences(req,res);
   else if(path==='/api/v1/store/account/extract-xtream'&&req.method==='POST')await ownedUniversalXtream(req,res);
   else if(path==='/api/v1/store/account/marketing-preferences'&&req.method==='POST')await marketingPreferences(req,res);
   else if(path==='/api/v1/store/account/logout'&&req.method==='POST')await logout(req,res);
   else if(path==='/api/v1/store/account'&&req.method==='GET')await account(req,res);
   else if(path==='/api/v1/store/account/alerts'&&req.method==='GET')await alerts(req,res);
   else if(path==='/api/v1/store/account/subscriptions'&&req.method==='GET')await subscriptions(req,res);
   else if(/^\/api\/v1\/store\/account\/subscriptions\/[a-fA-F0-9-]{36}\/xtream$/.test(path)&&req.method==='POST')
    await ownedXtreamCredentials(req,res,path.split('/').at(-2));
   else if(/^\/api\/v1\/store\/account\/orders\/[a-fA-F0-9-]{36}\/payment-receipt$/.test(path)&&req.method==='GET')
     await paymentReceipt(req,res,path.split('/').at(-2));
   else if(/^\/api\/v1\/store\/account\/orders\/[a-fA-F0-9-]{36}\/check$/.test(path)&&req.method==='POST')
     await refreshOwnedPayment(req,res,path.split('/').at(-2));
   else if(/^\/api\/v1\/store\/account\/orders\/[a-fA-F0-9-]{36}$/.test(path)&&req.method==='GET')
     await receipt(req,res,path.split('/').at(-1));
   else json(res,404,{error:'not_found'});
  }catch(e){if(e.status)json(res,e.status,{error:e.message});else throw e;}
  return true;
 };
 handler.linkCheckoutOrder=linkCheckoutOrder;
 handler.checkoutIdentity=checkoutIdentity;
 // One-day trials require a real OTP-verified customer session, never guest checkout.
 handler.authenticatedCustomer=async req=>{
  if(!enabled||!mailReady)return null;
  await schema();
  return current(req);
 };
 handler.setReconciler=fn=>{if(typeof fn==='function')reconcileOwnedPayment=fn;};
 handler.setStoreSchema=fn=>{if(typeof fn==='function')ensureOpsSchema=fn;};
 return handler;
}

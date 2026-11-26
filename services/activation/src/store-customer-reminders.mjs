// Opt-in transactional expiry notices. No WhatsApp marketing, no raw code in messages.
// Run on an interval only when explicitly enabled with a verified Resend sender.
import crypto from 'node:crypto';

const PREFLIGHT=[
  'blofy_store_customers','blofy_store_customer_orders','blofy_store_geidea_orders',
  'blofy_xtream_gateway_duration_codes','blofy_store_cart_vouchers',
  'blofy_store_order_vouchers'
];
export function reminderConfig(env=process.env){
 const apiKey=String(env.BLOFY_CUSTOMER_RESEND_API_KEY||'');
 const from=String(env.BLOFY_CUSTOMER_MAIL_FROM||'');
 return {
  enabled:env.BLOFY_CUSTOMER_ACCOUNTS_ENABLED==='true' &&
    env.BLOFY_CUSTOMER_REMINDERS_ENABLED==='true'&&
    apiKey.startsWith('re_')&&from.includes('@'),
  apiKey,from
 };
}
function messageDetails(expiresAt){
 const date=new Date(expiresAt).toLocaleDateString('ar-SA',{
   timeZone:'Asia/Riyadh',year:'numeric',month:'long',day:'numeric'});
 return {
  subject:'تنبيه قرب انتهاء اشتراك BLOFY',
  text:'تنبيه من BLOFY: اشتراكك الحالي يقترب من الانتهاء بتاريخ '+date+
    '. للاطلاع على التفاصيل والتجديد افتح https://blofyplayer.com/store/account'+
    '\nلإيقاف رسائل انتهاء الاشتراك: افتح حسابك ثم ألغِ تفعيل التنبيهات.'+
    '\nلا تشارك أكوادك أو تفاصيل بطاقتك مع أي شخص.'
 };
}
export function createCustomerReminderEngine({pool,env=process.env,fetchImpl=globalThis.fetch,sendEmail}){
 const cfg=reminderConfig(env);
 let initialized=null;
 async function schema(){
  if(!initialized)initialized=(async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(718420713)');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_customer_reminders ('+
      'customer_id UUID NOT NULL REFERENCES blofy_store_customers(id) ON DELETE CASCADE,'+
      'voucher_id UUID NOT NULL,attempts SMALLINT NOT NULL DEFAULT 0,'+
      'lease_until TIMESTAMPTZ,last_attempt_at TIMESTAMPTZ,sent_at TIMESTAMPTZ,'+
      'PRIMARY KEY(customer_id,voucher_id))');
    await db.query('COMMIT');
   }catch(err){await db.query('ROLLBACK').catch(()=>{});throw err;}
   finally{db.release();}
  })().catch(err=>{initialized=null;throw err;});
  return initialized;
 }
 async function deliver(recipient,expiresAt,idempotencyKey){
  const message=messageDetails(expiresAt);
  if(sendEmail)return sendEmail(recipient,message,idempotencyKey);
  const response=await fetchImpl('https://api.resend.com/emails',{
   method:'POST',
   headers:{'content-type':'application/json',authorization:'Bearer '+cfg.apiKey,
     'Idempotency-Key':idempotencyKey},
   body:JSON.stringify({from:cfg.from,to:[recipient],...message}),
   signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw Error('customer_reminder_email_send_failed');
 }
 async function run(){
  if(!cfg.enabled)return {enabled:false,queued:0,sent:0};
  // Do not create an accidental second commerce data model on a new installation.
  const preflight=await pool.query('SELECT '+PREFLIGHT.map((_,i)=>
    'to_regclass($'+(i+1)+') AS t'+i).join(','),PREFLIGHT.map(t=>'public.'+t));
  if(PREFLIGHT.some((_,i)=>!preflight.rows[0]?.['t'+i]))
   return {enabled:true,ready:false,queued:0,sent:0};
  await schema();
  // Only active opt-in customers, purchased/linked vouchers and redeemed codes qualify.
  const candidates=await pool.query(
   'SELECT DISTINCT customer_id,voucher_id FROM ('+
   'SELECT m.customer_id,v.id AS voucher_id,v.expires_at,v.redeemed_at,v.revoked_at '+
   'FROM blofy_store_customer_orders m JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
   'JOIN blofy_xtream_gateway_duration_codes v ON v.id=o.voucher_id '+
   "WHERE o.status='paid' "+
   'UNION ALL SELECT m.customer_id,v.id,v.expires_at,v.redeemed_at,v.revoked_at '+
   'FROM blofy_store_customer_orders m JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
   'JOIN blofy_store_cart_vouchers vmap ON vmap.order_id=o.id '+
   'JOIN blofy_xtream_gateway_duration_codes v ON v.id=vmap.voucher_id '+
   "WHERE o.status='paid' "+
   'UNION ALL SELECT m.customer_id,v.id,v.expires_at,v.redeemed_at,v.revoked_at '+
   'FROM blofy_store_customer_orders m JOIN blofy_store_geidea_orders o ON o.id=m.order_id '+
   'JOIN blofy_store_order_vouchers vmap ON vmap.order_id=o.id '+
   'JOIN blofy_xtream_gateway_duration_codes v ON v.id=vmap.voucher_id '+
   "WHERE o.status='paid') eligible "+
   'JOIN blofy_store_customers c ON c.id=eligible.customer_id '+
   'WHERE c.alerts_opt_in=TRUE AND eligible.redeemed_at IS NOT NULL '+
   'AND eligible.revoked_at IS NULL AND eligible.expires_at>NOW() '+
   "AND eligible.expires_at<=NOW()+INTERVAL '7 days' LIMIT 300"
  );
  let queued=0;
  for(const v of candidates.rows){
   const r=await pool.query('INSERT INTO blofy_store_customer_reminders '+
     '(customer_id,voucher_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
     [v.customer_id,v.voucher_id]);
   queued+=r.rowCount||0;
  }
  // Atomic lease across both production replicas. One receipt email per voucher.
  // Retry after a lease expiry, using Resend's provider-side idempotency key.
  const db=await pool.connect();
  let jobs=[];
  try{
   await db.query('BEGIN');
   jobs=(await db.query('WITH todo AS ('+
     'SELECT r.customer_id,r.voucher_id FROM blofy_store_customer_reminders r '+
     'JOIN blofy_store_customers c ON c.id=r.customer_id '+
     'JOIN blofy_xtream_gateway_duration_codes v ON v.id=r.voucher_id '+
     'WHERE r.sent_at IS NULL AND r.attempts<3 AND c.alerts_opt_in=TRUE '+
     'AND (r.lease_until IS NULL OR r.lease_until<NOW()) '+
     'AND v.redeemed_at IS NOT NULL AND v.revoked_at IS NULL '+
     "AND v.expires_at>NOW() AND v.expires_at<=NOW()+INTERVAL '7 days' "+
     'ORDER BY r.customer_id,r.voucher_id LIMIT 10 FOR UPDATE OF r SKIP LOCKED) '+
     'UPDATE blofy_store_customer_reminders r SET attempts=r.attempts+1,'+
     "lease_until=NOW()+INTERVAL '5 minutes',last_attempt_at=NOW() "+
     'FROM todo t WHERE r.customer_id=t.customer_id AND r.voucher_id=t.voucher_id '+
     'RETURNING r.customer_id,r.voucher_id')).rows;
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
  let sent=0,failed=0;
  for(const job of jobs){
   // Re-check consent after leasing. Never expose raw codes or links with secrets.
   const eligible=(await pool.query('SELECT c.email,v.expires_at FROM blofy_store_customers c '+
     'JOIN blofy_xtream_gateway_duration_codes v ON v.id=$2 '+
     'WHERE c.id=$1 AND c.alerts_opt_in=TRUE AND v.revoked_at IS NULL '+
     "AND v.redeemed_at IS NOT NULL AND v.expires_at>NOW() AND v.expires_at<=NOW()+INTERVAL '7 days'",
     [job.customer_id,job.voucher_id])).rows[0];
   if(!eligible)continue;
   const key='blofy-expiry-v1-'+job.customer_id+'-'+job.voucher_id;
   try{
    await deliver(eligible.email,eligible.expires_at,key);
    await pool.query('UPDATE blofy_store_customer_reminders SET sent_at=NOW(),lease_until=NULL '+
      'WHERE customer_id=$1 AND voucher_id=$2',[job.customer_id,job.voucher_id]);
    sent++;
   }catch{failed++;}
  }
  return {enabled:true,ready:true,queued,claimed:jobs.length,sent,failed};
 }
 function start(){
  if(!cfg.enabled)return false;
  // No immediate burst during boot; do not hold the Node event loop open.
  const kickoff=setTimeout(()=>void run().catch(()=>{}),90000);
  kickoff.unref?.();
  const timer=setInterval(()=>void run().catch(()=>{}),15*60000);
  timer.unref?.();
  return true;
 }
 return {configured:cfg.enabled,run,start};
}

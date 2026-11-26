// Verified BLOFY STORE payment receipts, not tax invoices.
// Order lines and totals come from the persisted, already confirmed order.
// Transactional emails never include raw activation codes, card details or bearer links.
import {CART_CATALOG,publicOrderNumber} from './store-cart.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}$/;
const CHANNEL=Object.freeze({app:'BLOFY STREAM',xtream:'Xtream BLOFY'});
const safeMinor=x=>Number.isSafeInteger(Number(x))&&Number(x)>=0?Number(x):null;
const dateIso=value=>{
 if(value===null||value===undefined||value==='')return null;
 const valueMs=new Date(value).getTime();
 return Number.isFinite(valueMs)?new Date(valueMs).toISOString():null;
};

export function buildStorePaymentReceipt(order){
 if(!order||order.status!=='paid'||!UUID.test(order.id||'')||
   order.currency!=='SAR'||!dateIso(order.paid_at))return null;
 const total=safeMinor(order.amount_minor),discount=safeMinor(order.coupon_discount_minor||0);
 if(total===null||total<1||discount===null)return null;
 const gross=total+discount;
 if(!Number.isSafeInteger(gross))return null;
 let items=[];
 if(order.sku==='cart'){
  if(!Array.isArray(order.cart_items)||order.cart_items.length>5||
     !order.cart_items.length)return null;
  for(const item of order.cart_items){
   if(!item||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>3||
     typeof item.sku!=='string')return null;
   const catalog=CART_CATALOG[item.sku];
   if(!catalog&&item.sku!=='bundle-2y')return null;
   if(item.sku==='bundle-2y'&&(!Array.isArray(item.bundleSelection)||
     item.bundleSelection.length!==2||item.bundleSelection.some(x=>!CHANNEL[x])))return null;
   items.push({sku:item.sku,quantity:item.quantity,
    description:catalog?.name||'عرض اشتراكين سنويين'});
  }
 }else if(order.sku==='renewal'){
  if(![90,180,365].includes(Number(order.duration_days))||!CHANNEL[order.channel])
   return null;
  items=[{sku:'renewal',quantity:1,description:'تجديد نفس الكود · '+CHANNEL[order.channel],
    durationDays:Number(order.duration_days)}];
 }else if(order.sku==='bundle-2y'){
  if(!Array.isArray(order.bundle_selection)||order.bundle_selection.length!==2||
     order.bundle_selection.some(x=>!CHANNEL[x]))return null;
  items=[{sku:'bundle-2y',quantity:1,description:'عرض اشتراكين سنويين ('+
    order.bundle_selection.map(x=>CHANNEL[x]).join(' + ')+')'}];
 }else{
  const entry=CART_CATALOG[order.sku];
  if(!entry)return null;
  items=[{sku:order.sku,quantity:1,description:entry.name}];
 }
 const orderNumber=order.public_order_number||publicOrderNumber(order.id,order.created_at);
 return {ok:true,kind:'payment_receipt',isTaxInvoice:false,
  legalNotice:'هذا إيصال تأكيد دفع من BLOFY وليس فاتورة ضريبية.',
  issuer:'BLOFY',orderId:order.id,orderNumber,
  receiptNumber:'RCPT-'+orderNumber,provider:'Geidea',currency:'SAR',
  createdAt:dateIso(order.created_at),paidAt:dateIso(order.paid_at),
  items,subtotalMinor:gross,discountMinor:discount,totalMinor:total,
  status:'paid',sameCodeRenewal:order.sku==='renewal',
  codesAvailableAt:'/store/account',supportUrl:'/store/contact'};
}
export function receiptEmailMessage(receipt){
 if(receipt?.status!=='paid'||receipt.isTaxInvoice!==false)return null;
 const amount=(receipt.totalMinor/100).toFixed(2);
 const lines=receipt.items.map(x=>'- '+x.description+' × '+x.quantity).join('\n');
 return {subject:'BLOFY | تأكيد دفع الطلب '+receipt.orderNumber,
 text:'تم تأكيد دفع طلبك لدى BLOFY عبر Geidea.\n\nرقم الطلب: '+receipt.orderNumber+
   '\nالمشتريات:\n'+lines+'\nالإجمالي المدفوع: '+amount+' ريال سعودي'+
   '\nتاريخ تأكيد الدفع: '+receipt.paidAt+
   '\n\nللاطلاع على الإيصال والأكواد أو تفاصيل التجديد، سجّل الدخول بالبريد الذي اشتريت به:'+
   '\nhttps://blofyplayer.com/store/account'+
   '\n\nهذه رسالة تأكيد دفع وليست فاتورة ضريبية.'+
   '\nلا ترد على هذه الرسالة بمعلومات بطاقة أو كود اشتراك.\n'};
}
export function receiptEmailConfig(env=process.env){
 const key=String(env.BLOFY_CUSTOMER_RESEND_API_KEY||'').trim();
 const from=String(env.BLOFY_CUSTOMER_MAIL_FROM||'').trim();
 const since=String(env.BLOFY_CUSTOMER_RECEIPTS_SINCE||'').trim();
 const sinceMs=Date.parse(since);
 const validSince=Number.isFinite(sinceMs)&&since.includes('T')&&
   since.endsWith('Z')&&sinceMs>=Date.parse('2026-01-01T00:00:00Z');
 return {enabled:env.BLOFY_CUSTOMER_RECEIPTS_ENABLED==='true'&&
   env.BLOFY_CUSTOMER_ACCOUNTS_ENABLED==='true'&&
   key.startsWith('re_')&&EMAIL.test(from.split('<').pop().replace('>','').trim())&&
   validSince,apiKey:key,from,since:validSince?new Date(sinceMs).toISOString():null};
}
export function createStoreReceiptEmailEngine({pool,env=process.env,
 fetchImpl=globalThis.fetch,sendEmail}){
 const config=receiptEmailConfig(env);
 let initialized=null;
 async function schema(){
  if(!initialized)initialized=(async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(718420734)');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_store_payment_receipt_emails ('+
     'order_id UUID PRIMARY KEY REFERENCES blofy_store_geidea_orders(id),'+
     'attempts SMALLINT NOT NULL DEFAULT 0,lease_until TIMESTAMPTZ,'+
     'sent_at TIMESTAMPTZ,accepted_id TEXT,'+
     'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
  })().catch(e=>{initialized=null;throw e;});
  return initialized;
 }
 async function send(email,receipt){
  const msg=receiptEmailMessage(receipt);
  if(!msg)return false;
  const key='blofy-payment-receipt-v1-'+receipt.orderId;
  if(sendEmail)return sendEmail(email,msg,key);
  const r=await fetchImpl('https://api.resend.com/emails',{
   method:'POST',
   headers:{authorization:'Bearer '+config.apiKey,
    'content-type':'application/json','Idempotency-Key':key},
   body:JSON.stringify({from:config.from,to:[email],...msg}),
   signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('receipt_email_provider_rejected');
  const body=await r.json().catch(()=>({}));
  if(!body?.id)throw Error('receipt_email_acknowledgement_unavailable');
  return body.id;
 }
 async function run(){
  if(!config.enabled)return {enabled:false};
  const tables=['blofy_store_customers','blofy_store_customer_orders',
   'blofy_store_geidea_orders'];
  const preflight=(await pool.query('SELECT '+tables.map((_,i)=>
   'to_regclass($'+(i+1)+') AS t'+i).join(','),
   tables.map(t=>'public.'+t))).rows[0]||{};
  if(tables.some((_,i)=>!preflight['t'+i]))
   return {enabled:true,ready:false};
  await schema();
  // Import only payments confirmed AFTER feature launch; never mail historic
  // buyers in a burst. Paid state is produced by official Geidea reconciliation.
  await pool.query('INSERT INTO blofy_store_payment_receipt_emails(order_id) '+
   'SELECT o.id FROM blofy_store_geidea_orders o '+
   'JOIN blofy_store_customer_orders m ON m.order_id=o.id '+
   "WHERE o.status='paid' AND o.paid_at>=$1::timestamptz "+
   'AND o.paid_at<=NOW() ORDER BY o.paid_at DESC LIMIT 150 ON CONFLICT DO NOTHING',
   [config.since]);
  const db=await pool.connect();
  let jobs=[];
  try{
   await db.query('BEGIN');
   jobs=(await db.query('WITH todo AS ('+
    'SELECT e.order_id FROM blofy_store_payment_receipt_emails e '+
    'JOIN blofy_store_geidea_orders o ON o.id=e.order_id '+
    "WHERE o.status='paid' AND e.sent_at IS NULL AND e.attempts<3 "+
    'AND (e.lease_until IS NULL OR e.lease_until<NOW()) '+
    'ORDER BY e.created_at,e.order_id LIMIT 10 FOR UPDATE OF e SKIP LOCKED) '+
    'UPDATE blofy_store_payment_receipt_emails e SET attempts=e.attempts+1,'+
    "lease_until=NOW()+INTERVAL '5 minutes' "+
    'FROM todo t WHERE e.order_id=t.order_id RETURNING e.order_id')).rows;
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
  finally{db.release();}
  let accepted=0,failed=0;
  for(const job of jobs){
   const owner=(await pool.query(
    'SELECT o.*,c.email FROM blofy_store_geidea_orders o '+
    'JOIN blofy_store_customer_orders m ON m.order_id=o.id '+
    'JOIN blofy_store_customers c ON c.id=m.customer_id '+
    "WHERE o.id=$1 AND o.status='paid' AND o.paid_at>=$2::timestamptz",
    [job.order_id,config.since])).rows[0];
   if(!owner||!EMAIL.test(owner.email||''))continue;
   const receipt=buildStorePaymentReceipt(owner);
   if(!receipt)continue;
   try{
    const id=await send(owner.email,receipt);
    if(!id)throw Error('receipt_email_missing_ack');
    await pool.query('UPDATE blofy_store_payment_receipt_emails '+
     'SET sent_at=NOW(),accepted_id=$2,lease_until=NULL WHERE order_id=$1',
     [job.order_id,String(id).slice(0,150)]);
    accepted++;
   }catch(e){
    failed++;
    // Never log recipient, code or provider response with possible PII.
    console.warn('[store-payment-receipt]',JSON.stringify({type:'send_failed'}));
   }
  }
  return {enabled:true,ready:true,claimed:jobs.length,accepted,failed};
 }
 function start(){
  if(!config.enabled)return false;
  const first=setTimeout(()=>void run().catch(()=>{}),90000);
  first.unref?.();
  const repeat=setInterval(()=>void run().catch(()=>{}),5*60000);
  repeat.unref?.();
  return true;
 }
 return {configured:config.enabled,run,start};
}

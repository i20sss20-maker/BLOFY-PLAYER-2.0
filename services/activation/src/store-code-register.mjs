// Owner-only consolidated ledger across manual, paid, and 1-day trial vouchers.
// Never return plaintext codes, device proofs or Xtream passwords in bulk.
// Customers are identified solely through verified customer/order associations.
import {normalizeCustomerPhone} from './store-customer-account.mjs';
import {decryptStreamCode} from './xtream-code-vault.mjs';
import {streamCodeProof} from './xtream-duration-codes.mjs';
import {ensureStreamCommercialSchema} from './xtream-code-commercial.mjs';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';
import crypto from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KINDS=new Set(['all','trial','paid','manual']);
const STATES=new Set(['all','ready','delivered','active','expired','revoked']);
const NO_CACHE={'cache-control':'no-store, private','x-content-type-options':'nosniff'};
const PAGE=25;
const small=(s,n=200)=>String(s??'').slice(0,n);
const ms=v=>v?new Date(v).getTime():null;

export function safeCodeLedgerRow(row,now=Date.now()){
 const kind=row.trial_sku?'trial':row.paid_sku?'paid':'manual';
 const assigned=Boolean(row.claimed_at||row.stock_sold_at||row.sold_at||row.order_id);
 const expired=Boolean(row.expires_at&&new Date(row.expires_at).getTime()<=now);
 const state=row.revoked_at?'revoked':expired?'expired':
   row.redeemed_at?'active':assigned?'delivered':'ready';
 const customer=row.customer_id?{
   id:row.customer_id,email:small(row.email,254),name:small(row.full_name,100),
   phone:small(row.phone_e164,24),
   emailVerified:true,profileComplete:Boolean(row.full_name&&row.phone_e164)
 }:null;
 const manager={
   id:row.id,label:small(row.label,100),codeHint:small(row.code_hint,30),
   channel:row.code_channel,status:row.revoked_at?'revoked':row.redeemed_at?'redeemed':'unused',
   durationDays:Number(row.duration_days)||0,maxConnections:Number(row.max_connections)||1,
   dualAccessEnabled:row.dual_access_enabled===true,accountId:row.account_id||null,
   deviceTransferPending:(row.code_channel==='app'||row.dual_access_enabled===true)&&
     Boolean(row.redeemed_at)&&!row.redeemed_device_hash,
   redeemedAt:ms(row.redeemed_at),expiresAt:ms(row.expires_at),
   soldAt:ms(row.sold_at),salePriceHalalas:row.sale_price_halalas==null?null:Number(row.sale_price_halalas),
   transferCount:Number(row.transfer_count||0),adminReloginCount:Number(row.admin_relogin_count||0),
   adminReloginUntil:ms(row.admin_relogin_until),buyerName:small(row.buyer_name,80),
   buyerPhone:small(row.buyer_phone,22)
 };
 const canRelogin=state==='active'&&
   (manager.channel==='app'||manager.dualAccessEnabled)&&Boolean(manager.accountId)&&
   manager.deviceTransferPending===false&&manager.expiresAt>now;
 return {
   voucherId:row.id,kind,sku:row.trial_sku||row.paid_sku||null,
   channel:row.code_channel,codeHint:small(row.code_hint,30),label:small(row.label,100),
   status:state,assigned,canReveal:Boolean(row.code_recoverable)&&!row.revoked_at,canRelogin,
   createdAt:row.created_at,deliveredAt:row.claimed_at||row.stock_sold_at||row.sold_at||null,
   activatedAt:row.redeemed_at||null,expiresAt:row.expires_at||null,
   durationDays:Number(row.duration_days)||0,maxConnections:Number(row.max_connections)||1,
   customer,manualCustomer:customer?null:{
     name:small(row.buyer_name,80),phone:small(row.buyer_phone,22)
   },
   order:row.order_id?{id:row.order_id,number:small(row.public_order_number,50),
     status:small(row.order_status,20)}:null,
   manager
 };
}

export function createStoreCodeRegister({pool,json,readJson,keyHex,
  authorizeAdmin=()=>false,ensureSchema=async()=>{}}={}){
 if(!pool||!json||!readJson||!/^[a-f0-9]{64}$/i.test(String(keyHex||'')))
   throw Error('store_code_register_dependencies_invalid');
 const revealLimit=createFixedWindowLimiter({limit:15,windowMs:5*60_000});
 let setup=null;
 async function schema(){
   if(!setup)setup=(async()=>{
     await ensureSchema();
     await ensureStreamCommercialSchema(pool);
   })().catch(e=>{setup=null;throw e;});
   return setup;
 }
 const runQuery=async({q,kind,state,offset})=>{
   const phone=normalizeCustomerPhone(q)||'';
   const proof=streamCodeProof(q,keyHex)||'';
   // Each voucher appears exactly once. LATERAL order lookups accept only
   // prior confirmed order-voucher links and are never allowed to assign a
   // customer from an unrelated order or code hint.
   const query=`
     WITH enriched AS (
       SELECT v.id,v.label,v.code_hint,v.code_channel,v.dual_access_enabled,
        v.duration_days,v.max_connections,v.created_at,v.redeemed_at,
        v.redeemed_device_hash,v.expires_at,v.revoked_at,v.account_id,v.code_hash,
        v.code_vault IS NOT NULL AS code_recoverable,v.sold_at,
        v.sale_price_halalas,v.transfer_count,v.admin_relogin_count,
        v.admin_relogin_until,v.buyer_name,v.buyer_phone,
        ti.sku AS trial_sku,ti.claimed_at,pi.sku AS paid_sku,
        pi.sold_at AS stock_sold_at,
        ord.id AS order_id,ord.public_order_number,ord.status AS order_status,
        customer.id AS customer_id,customer.email,customer.full_name,customer.phone_e164
       FROM blofy_xtream_gateway_duration_codes v
       LEFT JOIN blofy_store_trial_inventory ti ON ti.voucher_id=v.id
       LEFT JOIN blofy_store_inventory pi ON pi.voucher_id=v.id
       LEFT JOIN LATERAL (
         SELECT o.id,o.public_order_number,o.status,co.customer_id
         FROM blofy_store_geidea_orders o
         JOIN blofy_store_customer_orders co ON co.order_id=o.id
         WHERE o.voucher_id=v.id OR o.id=pi.sold_order_id
           OR EXISTS(SELECT 1 FROM blofy_store_cart_vouchers cv
             WHERE cv.voucher_id=v.id AND cv.order_id=o.id)
           OR EXISTS(SELECT 1 FROM blofy_store_order_vouchers ov
             WHERE ov.voucher_id=v.id AND ov.order_id=o.id)
         ORDER BY o.created_at DESC LIMIT 1
       ) ord ON TRUE
       LEFT JOIN blofy_store_customers customer
          ON customer.id=COALESCE(ti.customer_id,ord.customer_id)
     )
     SELECT *,COUNT(*) OVER() AS matched FROM enriched
     WHERE ($1::text='' OR id::text=$1 OR code_hash=$2
       OR strpos(lower(COALESCE(label,'')),lower($1))>0
       OR strpos(lower(COALESCE(code_hint,'')),lower($1))>0
       OR strpos(lower(COALESCE(email,'')),lower($1))>0
       OR strpos(lower(COALESCE(full_name,'')),lower($1))>0
       OR strpos(COALESCE(phone_e164,''),$3)>0 AND $3<>''
       OR strpos(COALESCE(phone_e164,''),$1)>0
       OR strpos(lower(COALESCE(buyer_name,'')),lower($1))>0
       OR strpos(COALESCE(buyer_phone,''),$1)>0
       OR strpos(lower(COALESCE(public_order_number,'')),lower($1))>0
     )
     AND ($4='all' OR ($4='trial' AND trial_sku IS NOT NULL)
       OR ($4='paid' AND paid_sku IS NOT NULL)
       OR ($4='manual' AND paid_sku IS NULL AND trial_sku IS NULL))
     AND ($5='all' OR
       ($5='revoked' AND revoked_at IS NOT NULL) OR
       ($5='expired' AND revoked_at IS NULL AND expires_at<=NOW()) OR
       ($5='active' AND revoked_at IS NULL AND redeemed_at IS NOT NULL
         AND expires_at>NOW()) OR
       ($5='delivered' AND revoked_at IS NULL AND redeemed_at IS NULL
         AND (claimed_at IS NOT NULL OR stock_sold_at IS NOT NULL OR sold_at IS NOT NULL OR order_id IS NOT NULL)) OR
       ($5='ready' AND revoked_at IS NULL AND redeemed_at IS NULL
         AND claimed_at IS NULL AND stock_sold_at IS NULL AND sold_at IS NULL
         AND order_id IS NULL))
     ORDER BY created_at DESC,id DESC LIMIT $6 OFFSET $7`;
   return pool.query(query,[q,proof,phone,kind,state,PAGE,offset]);
 };
 async function list(req,res,url){
   if(!authorizeAdmin(req,res))return;
   const q=small(url.searchParams.get('q')||'',90).trim();
   const kind=String(url.searchParams.get('kind')||'all');
   const state=String(url.searchParams.get('state')||'all');
   const offset=Number(url.searchParams.get('offset')||'0');
   if(!KINDS.has(kind)||!STATES.has(state)||
      !Number.isSafeInteger(offset)||offset<0||offset>100000||
      q.length===1||/[\x00-\x1f\x7f]/.test(q)){
     return json(res,400,{error:'code_register_filters_invalid'},NO_CACHE);
   }
   await schema();
   const data=await runQuery({q,kind,state,offset});
   const items=data.rows.map(row=>safeCodeLedgerRow(row));
   const matched=Number(data.rows[0]?.matched||0);
   return json(res,200,{ok:true,items,pageSize:PAGE,offset,
     matched,nextOffset:offset+items.length<matched?offset+items.length:null,
     includes:'paid_trial_manual',readOnly:true},NO_CACHE);
 }
 async function reveal(req,res){
   if(!authorizeAdmin(req,res))return;
   if(!revealLimit.consume(requestClientKey(req)).allowed)
     return json(res,429,{error:'code_reveal_rate_limited'},NO_CACHE);
   const body=await readJson(req);
   const id=String(body?.voucherId||'');
   if(!UUID.test(id)||body?.purpose!=='customer_support')
     return json(res,400,{error:'code_reveal_request_invalid'},NO_CACHE);
   await schema();
   const db=await pool.connect();
   try{
     await db.query('BEGIN');
     const row=(await db.query('SELECT id,code_hash,code_vault,revoked_at FROM '+
       'blofy_xtream_gateway_duration_codes WHERE id=$1 FOR UPDATE',[id])).rows[0];
     if(!row||row.revoked_at||!row.code_vault){
       await db.query('ROLLBACK');
       return json(res,404,{error:'code_reveal_unavailable'},NO_CACHE);
     }
     const code=decryptStreamCode(row.id,row.code_vault,keyHex);
     if(!code||streamCodeProof(code,keyHex)!==row.code_hash){
       await db.query('ROLLBACK');
       return json(res,503,{error:'code_reveal_integrity_failed'},NO_CACHE);
     }
     await db.query('INSERT INTO blofy_xtream_gateway_code_events '+
       '(id,code_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)',[
        crypto.randomUUID(),id,'owner_code_revealed_for_support',
        JSON.stringify({purpose:'customer_support',codeNotLogged:true})
       ]);
     await db.query('COMMIT');
     return json(res,200,{ok:true,voucherId:id,code},NO_CACHE);
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}
   finally{db.release();}
 }
 return async function handle(req,res,url){
   if(url.pathname==='/api/v1/admin/store/codes/register'&&req.method==='GET'){
     await list(req,res,url);return true;
   }
   if(url.pathname==='/api/v1/admin/store/codes/reveal'&&req.method==='POST'){
     await reveal(req,res);return true;
   }
   return false;
 };
}

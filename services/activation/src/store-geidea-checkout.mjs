// New-code storefront: separate from registered-device renewals.
// Uses the existing live Geidea credentials, with no unverified payment fulfillment.
import crypto from 'node:crypto';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';
import {createSignature,verifyGeideaCallback,verifiedPayment,CARD_ONLY_WALLETS} from './geidea-live.mjs';
import {ensureStreamCodeTable,streamNumericCodeLength,randomNumericStreamCode,streamCodeProof,normalizeStreamCode} from './xtream-duration-codes.mjs';
import {encryptStreamCode,decryptStreamCode} from './xtream-code-vault.mjs';
import {CART_SKU,parseStoreCart,cartVouchers,publicOrderNumber} from './store-cart.mjs';
import {auditPaidFulfillment} from './store-fulfillment-audit.mjs';
import {createStoreRenewalFlow,RENEWAL_SKU} from './store-renewal-checkout.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API='https://api.ksamerchant.geidea.net';
const ALLOWED_ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const P=[
 ['stream-3m','كود BLOFY STREAM — 3 أشهر','app',90,4000],
 ['stream-6m','كود BLOFY STREAM — 6 أشهر','app',180,7000],
 ['stream-1y','كود BLOFY STREAM — سنة','app',365,12000],
 ['xtream-3m','Xtream BLOFY — 3 أشهر','xtream',90,4000],
 ['xtream-6m','Xtream BLOFY — 6 أشهر','xtream',180,7000],
 ['xtream-1y','Xtream BLOFY — سنة','xtream',365,12000]
];
const err=(code,status=400)=>Object.assign(Error(code),{status});
const tokenHash=s=>crypto.createHash('sha256').update(s).digest('hex');
const rateCheckout=createFixedWindowLimiter({limit:8,windowMs:600000});
const rateStatus=createFixedWindowLimiter({limit:45,windowMs:600000});
export function publicStorePlans(){return P.map(([sku,name,channel,durationDays,priceMinor])=>({sku,name,channel,durationDays,priceMinor,currency:'SAR'}));}
const BUNDLE_SKU='bundle-2y';
const BUNDLE_PRICE=20000;
export function publicStoreOffers(){return [{sku:BUNDLE_SKU,name:'عرض اشتراكين لمدة سنة',quantity:2,durationDays:365,priceMinor:BUNDLE_PRICE,regularPriceMinor:24000,currency:'SAR',allowedChannels:['app','xtream']}];}
export function validBundleChannels(v){return Array.isArray(v)&&v.length===2&&v.every(x=>x==='app'||x==='xtream');}
const COUPON_RE=/^[A-Z0-9][A-Z0-9_-]{3,19}$/;
function discountAmount(amount,percent){return Math.round(amount*percent/100);}

export function createStoreGeideaHandlers({pool,json,readJson,keyHex,authorizeAdmin=()=>false,
   onCheckoutOrder=async()=>false,requireCheckoutCustomer=async()=>({ok:true}),
   env=process.env,fetchImpl=globalThis.fetch}){
 const publicKey=String(env.GEIDEA_LIVE_MERCHANT_PUBLIC_KEY||'').trim();
 const password=String(env.GEIDEA_LIVE_API_PASSWORD||'');
 const selected=env.BLOFY_PAYMENT_PROVIDER==='geidea'&&env.BLOFY_GEIDEA_CHECKOUT_ENABLED==='true';
 const loginRequired=env.BLOFY_STORE_REQUIRE_CUSTOMER_LOGIN==='true';
 const renewalsEnabled=env.BLOFY_STORE_SAME_CODE_RENEWAL_ENABLED==='true'&&loginRequired;
 // Independent opt-in avoids changing live player renewal checkout until store fulfillment is validated.
 const enabled=selected&&env.BLOFY_STORE_GEIDEA_ENABLED==='true'&&UUID.test(publicKey)&&
   password.length>=16&&/^[a-f0-9]{64}$/i.test(String(keyHex||''));
 const base=String(env.BLOFY_PAYMENT_BASE_URL||'https://api.blofyplayer.com').trim().replace(/\/+$/,'');
 if(enabled&&!/^https:\/\/(?:api\.)?blofyplayer\.com$/.test(base))throw err('store_invalid_origin',503);
 const config={publicKey,password};
 let ready=null;
 async function schema(){
  if(!ready)ready=(async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(718420697)');
    await ensureStreamCodeTable(db);
    for(const statement of [
     'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS sale_price_halalas INTEGER',
     'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ',
     'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS sales_channel TEXT',
     'CREATE TABLE IF NOT EXISTS blofy_store_geidea_orders ('+
      'id UUID PRIMARY KEY,sku TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN (\'app\',\'xtream\')),'+
      'duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 730),'+
      'amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),'+
      'currency TEXT NOT NULL DEFAULT \'SAR\' CHECK(currency=\'SAR\'),'+
      'access_hash TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT \'pending\' '+ 
      'CHECK(status IN (\'pending\',\'paid\',\'failed\',\'cancelled\')),'+
      'session_id UUID,provider_reference UUID,voucher_id UUID UNIQUE,paid_at TIMESTAMPTZ,'+
      'last_checked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),'+
      'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
     'CREATE INDEX IF NOT EXISTS idx_blofy_store_orders_created ON blofy_store_geidea_orders(created_at DESC)',
     'CREATE TABLE IF NOT EXISTS blofy_store_inventory ('+
      'voucher_id UUID PRIMARY KEY REFERENCES blofy_xtream_gateway_duration_codes(id),'+
      'sku TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),'+
      'sold_order_id UUID UNIQUE REFERENCES blofy_store_geidea_orders(id),'+
      'sold_at TIMESTAMPTZ)',
     'CREATE INDEX IF NOT EXISTS idx_blofy_store_inventory_available ON blofy_store_inventory(sku) WHERE sold_at IS NULL',
     'ALTER TABLE blofy_store_geidea_orders ADD COLUMN IF NOT EXISTS bundle_selection JSONB',
     'ALTER TABLE blofy_store_geidea_orders ADD COLUMN IF NOT EXISTS coupon_code TEXT',
     'ALTER TABLE blofy_store_geidea_orders ADD COLUMN IF NOT EXISTS coupon_discount_minor INTEGER NOT NULL DEFAULT 0',
     'CREATE TABLE IF NOT EXISTS blofy_store_order_vouchers ('+
        'order_id UUID NOT NULL REFERENCES blofy_store_geidea_orders(id),'+
        'position SMALLINT NOT NULL CHECK(position BETWEEN 1 AND 2),'+
        'voucher_id UUID NOT NULL UNIQUE REFERENCES blofy_xtream_gateway_duration_codes(id),'+
        'channel TEXT NOT NULL CHECK(channel IN (\'app\',\'xtream\')),'+
        'duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 730),'+
        'PRIMARY KEY(order_id,position))',
     'CREATE TABLE IF NOT EXISTS blofy_store_coupons ('+
        'id UUID PRIMARY KEY,code TEXT NOT NULL UNIQUE,percent SMALLINT NOT NULL CHECK(percent BETWEEN 1 AND 30),'+
        'max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 100000),'+
        'active BOOLEAN NOT NULL DEFAULT TRUE,'+
        'expires_at TIMESTAMPTZ NOT NULL,'+
        'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
     'CREATE INDEX IF NOT EXISTS idx_blofy_store_orders_coupon ON blofy_store_geidea_orders(coupon_code) WHERE coupon_code IS NOT NULL',
     'ALTER TABLE blofy_store_geidea_orders ADD COLUMN IF NOT EXISTS cart_items JSONB',
     'ALTER TABLE blofy_store_geidea_orders ADD COLUMN IF NOT EXISTS cart_gross_minor INTEGER',
     'ALTER TABLE blofy_store_geidea_orders ADD COLUMN IF NOT EXISTS public_order_number TEXT',
     'ALTER TABLE blofy_store_geidea_orders ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ',
     'CREATE UNIQUE INDEX IF NOT EXISTS idx_blofy_store_order_number ON blofy_store_geidea_orders(public_order_number) WHERE public_order_number IS NOT NULL',
     'CREATE TABLE IF NOT EXISTS blofy_store_cart_vouchers ('+
       'order_id UUID NOT NULL REFERENCES blofy_store_geidea_orders(id),'+
       'position SMALLINT NOT NULL CHECK(position BETWEEN 1 AND 6),'+
       'voucher_id UUID NOT NULL UNIQUE REFERENCES blofy_xtream_gateway_duration_codes(id),'+
       'channel TEXT NOT NULL CHECK(channel IN (\'app\',\'xtream\')),'+
       'duration_days INTEGER NOT NULL CHECK(duration_days BETWEEN 1 AND 730),'+
       'sku TEXT NOT NULL,'+
       'PRIMARY KEY(order_id,position))',
     'CREATE INDEX IF NOT EXISTS idx_blofy_store_cart_items_order ON blofy_store_cart_vouchers(order_id)',
     'ALTER TABLE blofy_xtream_gateway_duration_codes ADD COLUMN IF NOT EXISTS extended_days INTEGER NOT NULL DEFAULT 0',
     'CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_code_events ('+
       'id UUID PRIMARY KEY,code_id UUID NOT NULL REFERENCES blofy_xtream_gateway_duration_codes(id),'+
       "event_type TEXT NOT NULL,occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"+
       "details JSONB NOT NULL DEFAULT '{}'::jsonb)",
     'CREATE TABLE IF NOT EXISTS blofy_store_renewal_orders ('+
       'order_id UUID PRIMARY KEY REFERENCES blofy_store_geidea_orders(id),'+
       'voucher_id UUID NOT NULL REFERENCES blofy_xtream_gateway_duration_codes(id),'+
       'plan_sku TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
     'CREATE INDEX IF NOT EXISTS idx_blofy_store_renewal_voucher ON blofy_store_renewal_orders(voucher_id)'

    ])await db.query(statement);
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
  })().catch(e=>{ready=null;throw e;});
  return ready;
 }
 async function source(db=pool){
   const exists=await db.query("SELECT to_regclass('public.blofy_xtream_servers') AS n");
   if(!exists.rows[0]?.n)throw err('store_source_unavailable',503);
   const x=await db.query("SELECT id FROM blofy_xtream_servers WHERE lower(btrim(name))='saleh' AND enabled=TRUE AND publish_catalog=TRUE AND deletion_requested_at IS NULL LIMIT 2");
   if(x.rows.length!==1)throw err('store_source_unavailable',503);
   return x.rows[0].id;
 }
 async function availableInventory(db,sku){
   return (await db.query('SELECT i.voucher_id FROM blofy_store_inventory i '+
      'JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id '+
      'WHERE i.sku=$1 AND i.sold_at IS NULL AND i.sold_order_id IS NULL '+
      'AND v.redeemed_at IS NULL AND v.revoked_at IS NULL AND v.account_id IS NULL '+
      'AND v.sold_at IS NULL AND v.code_vault IS NOT NULL '+
      'ORDER BY i.created_at,i.voucher_id FOR UPDATE OF i SKIP LOCKED LIMIT 1',[sku])).rows[0]?.voucher_id||null;
 }
 async function inventorySummary(req,res){
   if(!authorizeAdmin(req,res))return;
   await schema();
   const totals=(await pool.query('SELECT sku,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE sold_at IS NULL)::int AS available,'+
      'COUNT(*) FILTER (WHERE sold_at IS NOT NULL)::int AS sold FROM blofy_store_inventory GROUP BY sku ORDER BY sku')).rows;
   return json(res,200,{ok:true,products:publicStorePlans(),counts:totals});
 }
 async function importInventory(req,res){
   if(!authorizeAdmin(req,res))return;
   const body=await readJson(req);
   const plan=P.find(p=>p[0]===body.sku);
   if(!plan)return json(res,400,{error:'store_invalid_sku'});
   const codes=body.codes;
   if(!Array.isArray(codes)||codes.length<1||codes.length>100)
     return json(res,400,{error:'store_inventory_batch_invalid'});
   if(codes.some(x=>typeof x!=='string'||!normalizeStreamCode(x)) ||
      new Set(codes.map(normalizeStreamCode)).size!==codes.length)
     return json(res,400,{error:'store_inventory_code_invalid'});
   await schema();
   const sourceId=await source();
   const db=await pool.connect();
   try{
     await db.query('BEGIN');
     let inserted=0;
     for(const entered of codes){
       const normalized=normalizeStreamCode(entered),proof=streamCodeProof(normalized,keyHex);
       const row=(await db.query('SELECT * FROM blofy_xtream_gateway_duration_codes WHERE code_hash=$1 FOR UPDATE',[proof])).rows[0];
       if(!row||row.source_id!==sourceId||row.duration_days!==plan[3]||row.code_channel!==plan[2]||
          row.redeemed_at||row.revoked_at||row.account_id||row.expires_at||row.sold_at||row.buyer_phone||
          !row.code_vault||decryptStreamCode(row.id,row.code_vault,keyHex)!==normalized)
          throw err('store_inventory_code_ineligible',409);
       const existing=(await db.query('SELECT voucher_id FROM blofy_store_inventory WHERE voucher_id=$1',[row.id])).rows[0];
       if(existing)throw err('store_inventory_code_duplicate',409);
       await db.query('UPDATE blofy_xtream_gateway_duration_codes SET dual_access_enabled=TRUE WHERE id=$1',[row.id]);
       await db.query('INSERT INTO blofy_store_inventory(voucher_id,sku) VALUES($1,$2)',[row.id,plan[0]]);
       inserted++;
     }
     await db.query('COMMIT');
     return json(res,200,{ok:true,sku:plan[0],added:inserted});
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
 }
 async function generateInventory(req,res){
   if(!authorizeAdmin(req,res))return;
   const body=await readJson(req),plan=P.find(p=>p[0]===body.sku);
   const quantity=Number(body.quantity);
   if(!plan||!Number.isSafeInteger(quantity)||quantity<1||quantity>100)
     return json(res,400,{error:'store_inventory_request_invalid'});
   await schema();
   const db=await pool.connect();
   try{
     await db.query('BEGIN');
     const sourceId=await source(db);
     // One atomic transaction per batch. No half-created inventory after failures.
     // This is the same advisory lock as normal BLOFY code issuance.
     await db.query('SELECT pg_advisory_xact_lock(718420682)');
     const result=await db.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes');
     let count=Number(result.rows[0]?.n)||0;
     for(let i=0;i<quantity;i++){
       let inserted=false;
       for(let attempt=0;attempt<12;attempt++){
         const code=randomNumericStreamCode(streamNumericCodeLength(count));
         const newId=crypto.randomUUID(),proof=streamCodeProof(code,keyHex);
         const saved=await db.query('INSERT INTO blofy_xtream_gateway_duration_codes '+
           '(id,code_hash,code_hint,label,source_id,duration_days,max_connections,code_channel,'+
           'code_vault,dual_access_enabled) VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,TRUE) '+
           'ON CONFLICT(code_hash) DO NOTHING RETURNING id',[
              newId,proof,code.slice(0,2)+'••••'+code.slice(-2),plan[1],sourceId,
              plan[3],plan[2],encryptStreamCode(newId,code,keyHex)
           ]);
         if(saved.rows[0]){
           await db.query('INSERT INTO blofy_store_inventory(voucher_id,sku) VALUES($1,$2)',
             [newId,plan[0]]);
           count++;
           inserted=true;
           break;
         }
       }
       if(!inserted)throw err('store_inventory_generation_unavailable',503);
     }
     await db.query('COMMIT');
     return json(res,200,{ok:true,sku:plan[0],generated:quantity});
   }catch(e){
     await db.query('ROLLBACK').catch(()=>{});
     throw e;
   }finally{db.release();}
 }
 async function salesSummary(req,res){
   if(!authorizeAdmin(req,res))return;
   await schema();
   const [sales,coupons]=await Promise.all([
     pool.query("SELECT sku,status,COUNT(*)::int AS orders,COALESCE(SUM(amount_minor),0)::bigint AS amount_minor FROM blofy_store_geidea_orders WHERE created_at >= NOW()-INTERVAL '90 days' GROUP BY sku,status ORDER BY sku,status"),
     pool.query("SELECT c.code,c.percent,c.max_uses,c.active,c.expires_at,COUNT(o.id) FILTER (WHERE o.status='paid')::int AS paid_uses FROM blofy_store_coupons c LEFT JOIN blofy_store_geidea_orders o ON o.coupon_code=c.code GROUP BY c.id,c.code,c.percent,c.max_uses,c.active,c.expires_at ORDER BY c.expires_at DESC LIMIT 100")
   ]);
   const failures=(await pool.query(
     "SELECT COUNT(*)::int AS count FROM blofy_store_geidea_orders o "+
     "WHERE o.status='paid' AND ("+
     "(o.sku NOT IN ('bundle-2y','cart') AND o.voucher_id IS NULL) OR "+
     "(o.sku='bundle-2y' AND (SELECT COUNT(*) FROM blofy_store_order_vouchers v WHERE v.order_id=o.id)<>2) OR "+
     "(o.sku='cart' AND NOT EXISTS (SELECT 1 FROM blofy_store_cart_vouchers v WHERE v.order_id=o.id)))"
   )).rows[0]?.count||0;
   return json(res,200,{ok:true,periodDays:90,sales:sales.rows,coupons:coupons.rows,
     fulfillmentIssues:Number(failures)});
 }
 async function adminFulfillmentAudit(req,res){
   if(!authorizeAdmin(req,res))return;
   await schema();
   return json(res,200,await auditPaidFulfillment({pool,keyHex}));
 }
 async function newCoupon(req,res){
   if(!authorizeAdmin(req,res))return;
   const body=await readJson(req);
   const code=String(body?.code||'').trim().toUpperCase();
   const percent=Number(body?.percent),maxUses=Number(body?.maxUses),days=Number(body?.validDays);
   if(!COUPON_RE.test(code)||!Number.isInteger(percent)||percent<1||percent>30||
      !Number.isInteger(maxUses)||maxUses<1||maxUses>100000||
      !Number.isInteger(days)||days<1||days>365)
      return json(res,400,{error:'store_invalid_coupon'});
   await schema();
   const expiry=new Date(Date.now()+days*86400000).toISOString();
   try{
     await pool.query('INSERT INTO blofy_store_coupons(id,code,percent,max_uses,expires_at) VALUES($1,$2,$3,$4,$5)',
       [crypto.randomUUID(),code,percent,maxUses,expiry]);
   }catch(e){if(e.code==='23505')return json(res,409,{error:'store_coupon_exists'});throw e;}
   return json(res,201,{ok:true,code,percent,maxUses,expiresAt:expiry});
 }
 async function disableCoupon(req,res){
   if(!authorizeAdmin(req,res))return;
   const body=await readJson(req),code=String(body?.code||'').trim().toUpperCase();
   if(!COUPON_RE.test(code))return json(res,400,{error:'store_invalid_coupon'});
   await schema();
   const changed=await pool.query('UPDATE blofy_store_coupons SET active=FALSE WHERE code=$1 AND active=TRUE RETURNING code',[code]);
   return json(res,200,{ok:true,disabled:changed.rowCount>0});
 }
 async function prepareCouponAndOrder({id,sku,channel,durationDays,priceMinor,secret,bundleSelection,couponCode}){
   const db=await pool.connect();
   try{
     await db.query('BEGIN');
     let discount=0,applied=null;
     if(couponCode){
       const c=(await db.query("SELECT code,percent,max_uses FROM blofy_store_coupons WHERE code=$1 AND active=TRUE AND expires_at>NOW() FOR UPDATE",[couponCode])).rows[0];
       if(!c)throw err('store_coupon_unavailable',409);
       const count=(await db.query("SELECT COUNT(*)::int AS n FROM blofy_store_geidea_orders WHERE coupon_code=$1 AND (status='paid' OR (status='pending' AND created_at>NOW()-INTERVAL '45 minutes'))",[c.code])).rows[0]?.n||0;
       if(Number(count)>=Number(c.max_uses))throw err('store_coupon_limit_reached',409);
       discount=discountAmount(priceMinor,Number(c.percent));
       applied=c.code;
     }
     const due=priceMinor-discount;
     if(due<=0)throw err('store_invalid_discount',409);
     await db.query('INSERT INTO blofy_store_geidea_orders (id,sku,channel,duration_days,amount_minor,access_hash,bundle_selection,coupon_code,coupon_discount_minor) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)',
       [id,sku,channel,durationDays,due,tokenHash(secret),bundleSelection?JSON.stringify(bundleSelection):null,applied,discount]);
     await db.query('COMMIT');
     return {priceMinor:due,couponCode:applied,discountMinor:discount};
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
 }
 // Two annual vouchers (any combination) are reserved or generated in the SAME DB
 // transaction as the order settlement. A failure rolls back both, never one.
 async function fulfillBundle(db,order,settled){
   const channels=order.bundle_selection;
   if(!validBundleChannels(channels)||Number(order.duration_days)!==365)
      throw err('store_invalid_bundle',409);
   await db.query('SELECT pg_advisory_xact_lock(718420682)');
   const src=await source(db);
   const rows=[];
   for(let position=1;position<=2;position++){
     const channel=channels[position-1],sku=channel==='app'?'stream-1y':'xtream-1y';
     const sourcePlan=P.find(p=>p[0]===sku);
     let voucherId=await availableInventory(db,sku);
     if(voucherId){
       const stock=await db.query('UPDATE blofy_store_inventory SET sold_at=NOW() WHERE voucher_id=$1 AND sold_at IS NULL AND sold_order_id IS NULL RETURNING voucher_id',[voucherId]);
       if(stock.rowCount!==1)throw err('store_bundle_stock_unavailable',409);
       const record=await db.query("UPDATE blofy_xtream_gateway_duration_codes SET sold_at=NOW(),sales_channel='geidea-bundle',sale_price_halalas=$2 WHERE id=$1 AND sold_at IS NULL AND redeemed_at IS NULL AND revoked_at IS NULL RETURNING id",
         [voucherId,Math.floor(Number(order.amount_minor)/2)]);
       if(record.rowCount!==1)throw err('store_bundle_stock_unavailable',409);
     }else{
       const total=(await db.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes')).rows[0]?.n||0;
       const digits=streamNumericCodeLength(Number(total));
       for(let attempt=0;attempt<12;attempt++){
         const code=randomNumericStreamCode(digits),candidate=crypto.randomUUID();
         const saved=await db.query('INSERT INTO blofy_xtream_gateway_duration_codes '+
           '(id,code_hash,code_hint,label,source_id,duration_days,max_connections,code_channel,'+
           'code_vault,dual_access_enabled,sale_price_halalas,sold_at,sales_channel) '+
           "VALUES($1,$2,$3,$4,$5,365,1,$6,$7,TRUE,$8,NOW(),'geidea-bundle') ON CONFLICT(code_hash) DO NOTHING RETURNING id",[
             candidate,streamCodeProof(code,keyHex),code.slice(0,2)+'••••'+code.slice(-2),
             'BLOFY عرض اشتراكين سنوي',src,channel,encryptStreamCode(candidate,code,keyHex),
             Math.floor(Number(order.amount_minor)/2)
           ]);
         if(saved.rowCount){voucherId=candidate;break;}
       }
       if(!voucherId)throw err('store_bundle_voucher_unavailable',503);
     }
     await db.query('INSERT INTO blofy_store_order_vouchers(order_id,position,voucher_id,channel,duration_days) VALUES($1,$2,$3,$4,365)',
       [order.id,position,voucherId,channel]);
     rows.push(voucherId);
   }
   if(rows.length!==2||rows[0]===rows[1])throw err('store_bundle_invalid_delivery',409);
   await db.query("UPDATE blofy_store_geidea_orders SET status='paid',provider_reference=$2,paid_at=NOW(),updated_at=NOW() WHERE id=$1",
     [order.id,settled.orderId]);
 }
 // Every line in the guest basket is priced by the trusted server catalog.
 // A single verified Geidea payment atomically fulfills every item.
 async function fulfillCart(db,order,settled){
   const parsed=parseStoreCart(order.cart_items);
   // The trusted saved quote must remain redeemable even after future
   // product price changes. Only the server writes line prices into cart_items.
   const historicGross=Array.isArray(order.cart_items)?
     order.cart_items.reduce((n,line)=>n+
       (Number(line.unitPriceMinor||0)*Number(line.quantity||0)),0):0;
   if(!parsed||!Array.isArray(order.cart_items)||
      !Number.isSafeInteger(historicGross)||historicGross<=0||
      order.cart_items.some(line=>!Number.isSafeInteger(line.unitPriceMinor)||
        !Number.isSafeInteger(line.lineTotalMinor)||
        line.lineTotalMinor!==line.unitPriceMinor*line.quantity)||
      historicGross!==Number(order.cart_gross_minor)||
      Number(order.amount_minor)+Number(order.coupon_discount_minor||0)!==historicGross)
      throw err('store_cart_quote_integrity_failed',409);
   const vouchers=cartVouchers(order.cart_items);
   if(!vouchers||vouchers.length!==parsed.codeCount)throw err('store_cart_invalid_vouchers',409);
   await db.query('SELECT pg_advisory_xact_lock(718420682)');
   const src=await source(db);
   for(let index=0;index<vouchers.length;index++){
     const item=vouchers[index],plan=P.find(p=>p[0]===item.sku);
     if(!plan||plan[2]!==item.channel||plan[3]!==item.durationDays)
       throw err('store_cart_invalid_plan',409);
     let voucherId=await availableInventory(db,item.sku);
     const attribution=Math.max(1,Math.floor(Number(order.amount_minor)/vouchers.length));
     if(voucherId){
       // Inventory row is permanently sold, and the per-voucher link lives in
       // blofy_store_cart_vouchers. Existing UNIQUE sold_order_id stays untouched.
       const stock=await db.query('UPDATE blofy_store_inventory SET sold_at=NOW() '+
         'WHERE voucher_id=$1 AND sold_at IS NULL AND sold_order_id IS NULL RETURNING voucher_id',
         [voucherId]);
       if(stock.rowCount!==1)throw err('store_cart_inventory_unavailable',409);
       const sold=await db.query("UPDATE blofy_xtream_gateway_duration_codes SET sold_at=NOW(),"+
         "sale_price_halalas=$2,sales_channel='geidea-cart' "+
         'WHERE id=$1 AND sold_at IS NULL AND redeemed_at IS NULL AND revoked_at IS NULL RETURNING id',
         [voucherId,attribution]);
       if(sold.rowCount!==1)throw err('store_cart_stock_unavailable',409);
     }else{
       const total=(await db.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes')).rows[0]?.n||0;
       const digits=streamNumericCodeLength(Number(total));
       for(let attempts=0;attempts<15;attempts++){
         const code=randomNumericStreamCode(digits),candidate=crypto.randomUUID();
         const proof=streamCodeProof(code,keyHex);
         const created=await db.query('INSERT INTO blofy_xtream_gateway_duration_codes '+
           '(id,code_hash,code_hint,label,source_id,duration_days,max_connections,code_channel,'+
           'code_vault,dual_access_enabled,sale_price_halalas,sold_at,sales_channel) '+
           "VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,TRUE,$9,NOW(),'geidea-cart') "+
           'ON CONFLICT(code_hash) DO NOTHING RETURNING id',[
             candidate,proof,code.slice(0,2)+'••••'+code.slice(-2),
             'BLOFY سلة المتجر — '+plan[1],src,item.durationDays,item.channel,
             encryptStreamCode(candidate,code,keyHex),attribution
           ]);
         if(created.rowCount){voucherId=candidate;break;}
       }
       if(!voucherId)throw err('store_cart_voucher_unavailable',503);
     }
     const pos=index+1;
     await db.query('INSERT INTO blofy_store_cart_vouchers(order_id,position,voucher_id,channel,duration_days,sku) '+
       'VALUES($1,$2,$3,$4,$5,$6)',[order.id,pos,voucherId,item.channel,item.durationDays,item.sku]);
   }
   await db.query("UPDATE blofy_store_geidea_orders SET status='paid',provider_reference=$2,"+
     'paid_at=NOW(),updated_at=NOW() WHERE id=$1',[order.id,settled.orderId]);
 }
 async function cartQuote(req,res){
   if(!enabled)return json(res,503,{error:'store_checkout_disabled'});
   if(!browser(req,res))return;
   if(!rateCheckout.consume(requestClientKey(req)).allowed)
     return json(res,429,{error:'rate_limited'});
   const body=await readJson(req),cart=parseStoreCart(body?.items);
   if(!cart)return json(res,400,{error:'store_invalid_cart'});
   const code=body?.couponCode?String(body.couponCode).trim().toUpperCase():null;
   if(code&&!COUPON_RE.test(code))return json(res,400,{error:'store_invalid_coupon'});
   let discountMinor=0;
   if(code){
     await schema();
     const coupon=(await pool.query('SELECT percent,max_uses FROM blofy_store_coupons '+
       'WHERE code=$1 AND active=TRUE AND expires_at>NOW()',[code])).rows[0];
     if(!coupon)return json(res,409,{error:'store_coupon_unavailable'});
     const used=(await pool.query("SELECT COUNT(*)::int AS n FROM blofy_store_geidea_orders "+
       "WHERE coupon_code=$1 AND (status='paid' OR (status='pending' AND created_at>NOW()-INTERVAL '45 minutes'))",
       [code])).rows[0]?.n||0;
     if(Number(used)>=Number(coupon.max_uses))
       return json(res,409,{error:'store_coupon_limit_reached'});
     discountMinor=discountAmount(cart.totalMinor,Number(coupon.percent));
   }
   return json(res,200,{ok:true,items:cart.items,codeCount:cart.codeCount,
     subtotalMinor:cart.totalMinor,discountMinor,totalMinor:cart.totalMinor-discountMinor,currency:'SAR'});
 }
 // Reclaim an existing unpaid Geidea session from another tab or device.
 // Return only session metadata to the verified order owner, never a code or bearer secret.
 async function cartPending(req,res){
   if(!enabled||!loginRequired)return json(res,503,{error:'store_checkout_disabled'});
   if(!browser(req,res))return;
   const customer=await requireCheckoutCustomer(req);
   if(!customer?.ok)return json(res,customer?.status||401,{error:customer?.error||'customer_login_required'});
   const data=await readJson(req),cart=parseStoreCart(data?.items);
   if(!cart)return json(res,400,{error:'store_invalid_cart'});
   const coupon=data?.couponCode?String(data.couponCode).trim().toUpperCase():null;
   if(coupon&&!COUPON_RE.test(coupon))return json(res,400,{error:'store_invalid_coupon'});
   await schema();
   const row=(await pool.query(
     'SELECT o.id,o.public_order_number,o.session_id,o.session_expires_at,o.created_at '+
     'FROM blofy_store_customer_orders co '+
     'JOIN blofy_store_geidea_orders o ON o.id=co.order_id '+
     "WHERE co.customer_id=$1 AND o.sku=$2 AND o.status='pending' "+
     "AND o.created_at>NOW()-INTERVAL '20 minutes' "+
     "AND o.cart_items=$3::jsonb AND COALESCE(o.coupon_code,'')=COALESCE($4,'') "+
     'ORDER BY o.created_at DESC LIMIT 1',
     [customer.customerId,CART_SKU,JSON.stringify(cart.items),coupon])).rows[0];
   if(!row)return json(res,200,{ok:true,pending:false});
   const until=row.session_expires_at?new Date(row.session_expires_at).getTime():
     new Date(row.created_at).getTime()+12*60000;
   const active=UUID.test(row.session_id||'')&&Number.isFinite(until)&&until>Date.now()+15000;
   return json(res,200,{ok:true,pending:true,orderId:row.id,
     orderNumber:row.public_order_number||publicOrderNumber(row.id,row.created_at),
     sessionId:active?row.session_id:null,sessionExpiresAt:active?new Date(until).toISOString():null,
     status:'pending'});
 }
 async function cartCheckout(req,res){
   if(!enabled)return json(res,503,{error:'store_checkout_disabled'});
   if(!browser(req,res))return;
   // The server, not the disabled/enabled state of a browser button, enforces login.
   const customer=await requireCheckoutCustomer(req);
   if(!customer?.ok)return json(res,customer?.status||401,{error:customer?.error||'customer_login_required'});
   if(!rateCheckout.consume(requestClientKey(req)).allowed)
     return json(res,429,{error:'rate_limited'});
   const body=await readJson(req),cart=parseStoreCart(body?.items);
   if(!cart)return json(res,400,{error:'store_invalid_cart'});
   const couponCode=body?.couponCode?String(body.couponCode).trim().toUpperCase():null;
   if(couponCode&&!COUPON_RE.test(couponCode))
     return json(res,400,{error:'store_invalid_coupon'});
   await source();await schema();
   const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url');
   const number=publicOrderNumber(id);
   const db=await pool.connect();
   let amountMinor=cart.totalMinor,discountMinor=0;
   try{
     await db.query('BEGIN');
     if(loginRequired){
       if(!UUID.test(customer.customerId||'')){
         await db.query('ROLLBACK');
         return json(res,503,{error:'store_customer_identity_unavailable'});
       }
       // Serialize concurrent checkout requests across every production replica.
       await db.query('SELECT pg_advisory_xact_lock(718420812,hashtext($1))',[customer.customerId]);
       const pending=(await db.query(
         "SELECT o.id FROM blofy_store_customer_orders co "+
         "JOIN blofy_store_geidea_orders o ON o.id=co.order_id "+
         "WHERE co.customer_id=$1 AND o.sku=$2 AND o.status='pending' "+
         "AND o.created_at>NOW()-INTERVAL '20 minutes' "+
         "AND o.cart_items=$3::jsonb "+
         "AND COALESCE(o.coupon_code,'')=COALESCE($4,'') "+
         "ORDER BY o.created_at DESC LIMIT 1",
         [customer.customerId,CART_SKU,JSON.stringify(cart.items),couponCode])).rows[0];
       if(pending){
         await db.query('ROLLBACK');
         return json(res,409,{error:'store_pending_checkout_exists'});
       }
     }
     if(couponCode){
       const coupon=(await db.query('SELECT percent,max_uses FROM blofy_store_coupons '+
         'WHERE code=$1 AND active=TRUE AND expires_at>NOW() FOR UPDATE',[couponCode])).rows[0];
       if(!coupon)throw err('store_coupon_unavailable',409);
       const used=(await db.query("SELECT COUNT(*)::int AS n FROM blofy_store_geidea_orders "+
         "WHERE coupon_code=$1 AND (status='paid' OR (status='pending' AND created_at>NOW()-INTERVAL '45 minutes'))",
         [couponCode])).rows[0]?.n||0;
       if(Number(used)>=Number(coupon.max_uses))
         throw err('store_coupon_limit_reached',409);
       discountMinor=discountAmount(cart.totalMinor,Number(coupon.percent));
       amountMinor=cart.totalMinor-discountMinor;
     }
     await db.query('INSERT INTO blofy_store_geidea_orders '+
       '(id,sku,channel,duration_days,amount_minor,access_hash,cart_items,cart_gross_minor,'+
       'public_order_number,coupon_code,coupon_discount_minor) '+
       'VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)',[
         id,CART_SKU,'app',365,amountMinor,tokenHash(secret),
         JSON.stringify(cart.items),cart.totalMinor,number,couponCode,discountMinor
       ]);
     if(loginRequired){
       // Commit order and owner together to close the previous duplicate-order window.
       const ownership=await db.query(
         'INSERT INTO blofy_store_customer_orders(order_id,customer_id) VALUES($1,$2) RETURNING order_id',
         [id,customer.customerId]);
       if(ownership.rowCount!==1){
         await db.query('ROLLBACK');
         return json(res,503,{error:'store_order_link_failed'});
       }
     }
     await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
   const timestamp=new Date().toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
   const request={
     amount:(amountMinor/100).toFixed(2),currency:'SAR',timestamp,merchantReferenceId:id,
     signature:createSignature({publicKey,password,amountMinor,reference:id,timestamp}),
     paymentOperation:'Pay',language:'ar',hideWallets:[...CARD_ONLY_WALLETS],
     expressCheckouts:[],acceptTabbyPaymentMethod:false,acceptTamaraPaymentMethod:false,
     appearance:{uiMode:'modal'},
     callbackUrl:base+'/api/v1/store/geidea/webhook',
     returnUrl:base+'/api/v1/store/geidea/return?reference='+id+'&site='+encodeURIComponent(String(req.headers.origin||''))
   };
   let created;
   try{created=await provider('/payment-intent/api/v2/direct/session','POST',request);}
   catch{
     await pool.query("UPDATE blofy_store_geidea_orders SET status='cancelled' "+
       "WHERE id=$1 AND status='pending' AND session_id IS NULL",[id]).catch(()=>{});
     return json(res,503,{error:'store_geidea_session_unavailable',orderNumber:number});
   }
   if(!UUID.test(created?.session?.id||'')||
      Date.parse(created?.session?.expiryDate||'')<=Date.now()){
     await pool.query("UPDATE blofy_store_geidea_orders SET status='cancelled' "+
       "WHERE id=$1 AND status='pending' AND session_id IS NULL",[id]).catch(()=>{});
     return json(res,502,{error:'store_geidea_session_invalid',orderNumber:number});
   }
   await pool.query('UPDATE blofy_store_geidea_orders SET session_id=$2,session_expires_at=$3 WHERE id=$1',
     [id,created.session.id,created.session.expiryDate]);
   // Legacy mode preserves optional linking; verified account ownership was committed atomically.
   if(!loginRequired)try{await onCheckoutOrder(req,id,secret);}catch{}
   return json(res,201,{
     provider:'geidea',checkoutMode:'redirect',sku:CART_SKU,
     orderId:id,orderNumber:number,accessToken:secret,sessionId:created.session.id,
     sessionExpiresAt:created.session.expiryDate,
     subtotalMinor:cart.totalMinor,discountMinor,priceMinor:amountMinor,
     itemCount:cart.items.reduce((n,x)=>n+x.quantity,0),codeCount:cart.codeCount,currency:'SAR'
   });
 }
 async function adminOrders(req,res,url){
   if(!authorizeAdmin(req,res))return;
   await schema();
   const status=url.searchParams.get('status')||'all';
   if(!new Set(['all','paid','pending','failed','cancelled']).has(status))
     return json(res,400,{error:'invalid_order_filter'});
   const limit=50;
   const query="SELECT id,COALESCE(public_order_number,'BF-'||to_char(created_at AT TIME ZONE 'Asia/Riyadh','YYMMDD')||'-'||upper(substr(id::text,1,8))) AS order_number,"+
     "sku,status,amount_minor,currency,cart_gross_minor,cart_items,provider_reference,"+
     "coupon_code,created_at,paid_at,updated_at FROM blofy_store_geidea_orders "+
     (status==='all'?'':'WHERE status=$1 ')+
     'ORDER BY created_at DESC LIMIT '+limit;
   const rows=(await pool.query(query,status==='all'?[]:[status])).rows;
   return json(res,200,{ok:true,orders:rows,pageSize:limit});
 }
 async function provider(path,method='GET',body){
   const headers={authorization:'Basic '+Buffer.from(publicKey+':'+password).toString('base64'),accept:'application/json'};
   if(body)headers['content-type']='application/json';
   let res;
   try{res=await fetchImpl(API+path,{method,headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});}
   catch{throw err('store_geidea_unavailable',503);}
   if(!res.ok)throw err('store_geidea_provider_failed',503);
   let value;try{value=await res.json();}catch{throw err('store_geidea_invalid_response',502);}
   if(value?.responseCode!=='000'||value?.detailedResponseCode!=='000')throw err('store_geidea_rejected',503);
   return value;
 }
 async function official(order){
   const path=order.provider_reference?'/pgw/api/v1/direct/order/'+encodeURIComponent(order.provider_reference):
     '/pgw/api/v1/direct/order?MerchantReferenceId='+encodeURIComponent(order.id);
   const r=await provider(path),items=r.order?[r.order]:r.orders;
   if(!Array.isArray(items)||items.length!==1||items[0].merchantReferenceId!==order.id)
     throw err('store_geidea_reference_mismatch',409);
   return items[0];
 }
 const renewalFlow=createStoreRenewalFlow({pool,json,readJson,keyHex,
  enabled:enabled&&renewalsEnabled,requireCheckoutCustomer,browser,
  rateCheckout,requestClientKey,schema,provider,plans:publicStorePlans,
  publicKey,password,base});
 async function reconcile(id,expectedProviderId){
   if(!enabled)throw err('store_checkout_disabled',503);
   await schema();
   const original=(await pool.query('SELECT * FROM blofy_store_geidea_orders WHERE id=$1',[id])).rows[0];
   if(!original)throw err('store_order_not_found',404);
   if(original.status==='paid')return true;
   if(expectedProviderId&&original.provider_reference&&original.provider_reference!==expectedProviderId)
     throw err('store_provider_mismatch',409);
   const settled=await official(original);
   if(expectedProviderId&&settled.orderId!==expectedProviderId)throw err('store_provider_mismatch',409);
   const status=verifiedPayment(settled,original,config);
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    const order=(await db.query('SELECT * FROM blofy_store_geidea_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!order)throw err('store_order_not_found',404);
    if(order.status==='paid'){await db.query('COMMIT');return true;}
    if(status==='paid'){
      const isBundle=order.sku===BUNDLE_SKU;
      const isCart=order.sku===CART_SKU;
      const isRenewal=order.sku===RENEWAL_SKU;
      const plan=P.find(p=>p[0]===order.sku);
      const renewalPlan=isRenewal?P.find(p=>p[2]===order.channel&&p[3]===Number(order.duration_days)):null;
      const basePrice=isRenewal?renewalPlan?.[4]:isCart?Number(order.cart_gross_minor):isBundle?BUNDLE_PRICE:plan?.[4];
      const previous={'stream-6m':6000,'stream-1y':10000,'xtream-6m':6000,'xtream-1y':10000};
      const formerPrices={'stream-3m':3000,'stream-6m':5000,'stream-1y':7000,
        'xtream-3m':3000,'xtream-6m':5000,'xtream-1y':7000};
      // Immutable payment quotes from previous deployments remain deliverable.
      const createdMs=new Date(order.created_at).getTime();
      const legacyGross=createdMs<Date.parse('2026-11-19T00:00:00Z')&&previous[order.sku];
      const olderGross=createdMs<Date.parse('2026-11-18T16:00:00Z')&&formerPrices[order.sku];
      const gross=[basePrice,legacyGross,olderGross].filter(x=>Number.isInteger(x)&&x>0);
      if((!plan&&!isBundle&&!isCart&&!isRenewal)||
         (isRenewal&&!renewalPlan)||
         (isCart&&(!parseStoreCart(order.cart_items)||order.channel!=='app'))||
         (!isBundle&&!isCart&&!isRenewal&&(plan[2]!==order.channel||plan[3]!==order.duration_days))||
         (isBundle&&(!validBundleChannels(order.bundle_selection)||order.channel!=='app'||Number(order.duration_days)!==365)))
        throw err('store_catalog_mismatch',409);
      const discount=Number(order.coupon_discount_minor||0);
      if(!Number.isSafeInteger(discount)||discount<0||discount>Math.floor((basePrice||0)*0.3)+1)
        throw err('store_invalid_coupon_amount',409);
      if(discount){
        if(typeof order.coupon_code!=='string')throw err('store_invalid_coupon_order',409);
        const coupon=(await db.query('SELECT percent FROM blofy_store_coupons WHERE code=$1',[order.coupon_code])).rows[0];
        if(!coupon||discount!==discountAmount(basePrice,Number(coupon.percent)))
          throw err('store_coupon_order_mismatch',409);
      }else if(order.coupon_code)throw err('store_coupon_order_mismatch',409);
      if(!gross.some(x=>Number(order.amount_minor)===x-discount))
        throw err('store_catalog_price_mismatch',409);
      if(isRenewal){
        await renewalFlow.fulfill(db,order,settled);
      }else if(isCart){
        await fulfillCart(db,order,settled);
      }else if(isBundle){
        await fulfillBundle(db,order,settled);
      }else{

      const sourceId=await source(db);
      const fromStock=await availableInventory(db,order.sku);
      let voucherId=fromStock;
      if(fromStock){
        const marked=await db.query("UPDATE blofy_store_inventory SET sold_order_id=$2,sold_at=NOW() WHERE voucher_id=$1 AND sold_order_id IS NULL AND sold_at IS NULL RETURNING voucher_id",[fromStock,id]);
        if(marked.rowCount!==1)throw err('store_inventory_claim_failed',409);
        const recorded=await db.query("UPDATE blofy_xtream_gateway_duration_codes SET sold_at=NOW(),sale_price_halalas=$2,sales_channel='geidea-store' WHERE id=$1 AND sold_at IS NULL AND redeemed_at IS NULL AND revoked_at IS NULL RETURNING id",[fromStock,order.amount_minor]);
        if(recorded.rowCount!==1)throw err('store_inventory_voucher_unavailable',409);
      }
      if(!voucherId){
      await db.query('SELECT pg_advisory_xact_lock(718420682)');
      const count=(await db.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes')).rows[0]?.n||0;
      const digits=streamNumericCodeLength(Number(count));
      for(let n=0;n<12;n++){
       const code=randomNumericStreamCode(digits),newId=crypto.randomUUID();
       const p=streamCodeProof(code,keyHex);
       const saved=await db.query('INSERT INTO blofy_xtream_gateway_duration_codes '+
        '(id,code_hash,code_hint,label,source_id,duration_days,max_connections,code_channel,'+
        'code_vault,dual_access_enabled,sale_price_halalas,sold_at,sales_channel) '+
        "VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,TRUE,$9,NOW(),'geidea-store') "+
        'ON CONFLICT(code_hash) DO NOTHING RETURNING id',[
          newId,p,code.slice(0,2)+'••••'+code.slice(-2),plan[1],sourceId,plan[3],plan[2],
          encryptStreamCode(newId,code,keyHex),order.amount_minor
        ]);
       if(saved.rows[0]){voucherId=newId;break;}
      }
      if(!voucherId)throw err('store_voucher_issue_failed',503);
      } // batch generation is the safe fallback when uploaded stock is empty
      await db.query("UPDATE blofy_store_geidea_orders SET status='paid',provider_reference=$2,"+
       'voucher_id=$3,paid_at=NOW(),updated_at=NOW() WHERE id=$1',[id,settled.orderId,voucherId]);
      } // single voucher settlement
    }else{
      await db.query('UPDATE blofy_store_geidea_orders SET status=$2,'+
       "provider_reference=COALESCE(provider_reference,$3),updated_at=NOW() WHERE id=$1 AND status<>'paid'",
       [id,status,settled.orderId]);
    }
    await db.query('COMMIT');
    return status==='paid';
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e;}
   finally{db.release();}
 }
 function browser(req,res){
   if(!ALLOWED_ORIGINS.has(String(req.headers.origin||''))||req.headers['sec-fetch-site']==='cross-site'){
    json(res,403,{error:'invalid_origin'});return false;
   }
   return true;
 }
 async function catalog(req,res){
   let checkoutAvailable=false;
   if(enabled)try{await source();checkoutAvailable=true;}catch{}
   let popularSku=null;
   if(checkoutAvailable)try{
     const top=(await pool.query("SELECT sku,COUNT(*)::int AS n FROM blofy_store_geidea_orders WHERE status='paid' AND sku<>'bundle-2y' AND created_at>NOW()-INTERVAL '90 days' GROUP BY sku ORDER BY n DESC,sku LIMIT 1")).rows[0];
     if(top&&Number(top.n)>=10)popularSku=top.sku;
   }catch{}
   return json(res,200,{provider:'geidea',checkoutAvailable,products:publicStorePlans(),offers:publicStoreOffers(),popularSku});
 }
 async function couponQuote(req,res){
   if(!enabled)return json(res,503,{error:'store_checkout_disabled'});
   if(!browser(req,res))return;
   if(!rateCheckout.consume(requestClientKey(req)).allowed)return json(res,429,{error:'rate_limited'});
   const body=await readJson(req);
   const plan=P.find(p=>p[0]===body?.sku);
   const listPrice=body?.sku===BUNDLE_SKU?BUNDLE_PRICE:plan?.[4];
   const code=String(body?.couponCode||'').trim().toUpperCase();
   if(!listPrice||!COUPON_RE.test(code))return json(res,400,{error:'store_invalid_coupon'});
   await schema();
   const cp=(await pool.query('SELECT percent,max_uses FROM blofy_store_coupons WHERE code=$1 AND active=TRUE AND expires_at>NOW()',[code])).rows[0];
   if(!cp)return json(res,404,{error:'store_coupon_unavailable'});
   const cnt=(await pool.query("SELECT COUNT(*)::int AS n FROM blofy_store_geidea_orders WHERE coupon_code=$1 AND (status='paid' OR (status='pending' AND created_at>NOW()-INTERVAL '45 minutes'))",[code])).rows[0]?.n||0;
   if(Number(cnt)>=Number(cp.max_uses))return json(res,409,{error:'store_coupon_limit_reached'});
   const discountMinor=discountAmount(listPrice,Number(cp.percent));
   return json(res,200,{ok:true,sku:body.sku,currency:'SAR',
     originalPriceMinor:listPrice,discountMinor,priceMinor:listPrice-discountMinor});
 }
 async function checkout(req,res){
   if(!enabled)return json(res,503,{error:'store_checkout_disabled'});
   if(!browser(req,res))return;
   const customer=await requireCheckoutCustomer(req);
   if(!customer?.ok)return json(res,customer?.status||401,{error:customer?.error||'customer_login_required'});
   if(!rateCheckout.consume(requestClientKey(req)).allowed)return json(res,429,{error:'rate_limited'});
   const body=await readJson(req);
   const isBundle=body?.sku===BUNDLE_SKU;
   const plan=P.find(p=>p[0]===body?.sku);
   const channels=isBundle?body?.bundleSelection:null;
   if((!isBundle&&!plan)||(isBundle&&!validBundleChannels(channels)))
     return json(res,400,{error:'store_invalid_sku_or_bundle'});
   const sku=isBundle?BUNDLE_SKU:plan[0],
     channel=isBundle?'app':plan[2],days=isBundle?365:plan[3],listPrice=isBundle?BUNDLE_PRICE:plan[4];
   const couponCode=body?.couponCode?String(body.couponCode).trim().toUpperCase():null;
   if(couponCode&&!COUPON_RE.test(couponCode))return json(res,400,{error:'store_invalid_coupon'});
   await source();await schema();
   const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url');
   const quote=await prepareCouponAndOrder({id,sku,channel,durationDays:days,priceMinor:listPrice,
     secret,bundleSelection:channels,couponCode});
   if(loginRequired){
     let linked=false;
     try{linked=(await onCheckoutOrder(req,id,secret))===true;}catch{}
     if(!linked){
       await pool.query("UPDATE blofy_store_geidea_orders SET status='cancelled' "+
         "WHERE id=$1 AND status='pending' AND session_id IS NULL",[id]).catch(()=>{});
       return json(res,503,{error:'store_order_link_failed'});
     }
   }
   const timestamp=new Date().toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
   const request={
    amount:(quote.priceMinor/100).toFixed(2),currency:'SAR',timestamp,merchantReferenceId:id,
    signature:createSignature({publicKey,password,amountMinor:quote.priceMinor,reference:id,timestamp}),
    paymentOperation:'Pay',language:'ar',hideWallets:[...CARD_ONLY_WALLETS],expressCheckouts:[],
    acceptTabbyPaymentMethod:false,acceptTamaraPaymentMethod:false,appearance:{uiMode:'modal'},
    callbackUrl:base+'/api/v1/store/geidea/webhook',
    returnUrl:base+'/api/v1/store/geidea/return?reference='+id
   };
   let created;try{created=await provider('/payment-intent/api/v2/direct/session','POST',request);}
   catch{return json(res,503,{error:'store_geidea_session_unavailable'});}
   if(!UUID.test(created?.session?.id||'')||Date.parse(created?.session?.expiryDate||'')<=Date.now())
    return json(res,502,{error:'store_geidea_session_invalid'});
   await pool.query('UPDATE blofy_store_geidea_orders SET session_id=$2,session_expires_at=$3 WHERE id=$1',
     [id,created.session.id,created.session.expiryDate]);
   if(!loginRequired)try{await onCheckoutOrder(req,id,secret);}catch{}
   return json(res,201,{provider:'geidea',checkoutMode:'modal',orderId:id,accessToken:secret,
    sessionId:created.session.id,sku,priceMinor:quote.priceMinor,discountMinor:quote.discountMinor,couponCode:quote.couponCode,currency:'SAR'});
 }
 async function webhook(req,res){
   if(!enabled)return json(res,503,{error:'store_checkout_disabled'});
   const body=await readJson(req),id=body?.order?.merchantReferenceId;
   if(!UUID.test(id||''))return json(res,400,{error:'store_invalid_reference'});
   await schema();
   const order=(await pool.query('SELECT * FROM blofy_store_geidea_orders WHERE id=$1',[id])).rows[0];
   if(!order)return json(res,404,{error:'store_order_not_found'});
   const providerId=verifyGeideaCallback(body,order,config);
   await reconcile(id,providerId);
   return json(res,200,{received:true});
 }
 async function status(req,res){
   // Paid orders remain retrievable even when new checkout is temporarily disabled.
   if(!/^[a-f0-9]{64}$/i.test(String(keyHex||'')))return json(res,503,{error:'store_codes_unavailable'});
   if(!browser(req,res))return;
   if(!rateStatus.consume(requestClientKey(req)).allowed)return json(res,429,{error:'rate_limited'});
   const body=await readJson(req);
   if(!UUID.test(body?.orderId||'')||!/^[-_a-zA-Z0-9]{42,44}$/.test(body?.accessToken||''))
     return json(res,400,{error:'store_invalid_access'});
   await schema();
   let order=(await pool.query('SELECT * FROM blofy_store_geidea_orders WHERE id=$1',[body.orderId])).rows[0];
   const h=tokenHash(body.accessToken);
   if(!order||!crypto.timingSafeEqual(Buffer.from(order.access_hash,'hex'),Buffer.from(h,'hex')))
     return json(res,404,{error:'store_order_not_found'});
   if(enabled&&order.status==='pending'&&order.session_id&&
      (!order.last_checked_at||Date.now()-new Date(order.last_checked_at).getTime()>12000)){
     const claim=await pool.query('UPDATE blofy_store_geidea_orders SET last_checked_at=NOW() '+
      "WHERE id=$1 AND status='pending' AND (last_checked_at IS NULL OR last_checked_at<NOW()-INTERVAL '12 seconds') RETURNING id",
      [order.id]);
     if(claim.rowCount)try{await reconcile(order.id);}catch{}
     order=(await pool.query('SELECT * FROM blofy_store_geidea_orders WHERE id=$1',[order.id])).rows[0];
   }
   const orderNumber=order.public_order_number||publicOrderNumber(order.id,order.created_at);
   if(order.status!=='paid')return json(res,200,{orderId:order.id,orderNumber,sku:order.sku,
     status:order.status,fulfilled:false,amountMinor:order.amount_minor,currency:'SAR',
     createdAt:order.created_at});
   if(order.sku===CART_SKU){
     const parsed=parseStoreCart(order.cart_items),expected=cartVouchers(order.cart_items);
     if(!parsed||!expected)return json(res,503,{error:'store_cart_delivery_unavailable'});
     const rows=(await pool.query('SELECT c.position,c.channel,c.duration_days,c.sku,v.id,v.code_hash,v.code_vault,v.revoked_at '+
       'FROM blofy_store_cart_vouchers c JOIN blofy_xtream_gateway_duration_codes v ON v.id=c.voucher_id '+
       'WHERE c.order_id=$1 ORDER BY c.position',[order.id])).rows;
     if(rows.length!==expected.length||rows.some((item,i)=>!item.code_vault||item.revoked_at||
       item.sku!==expected[i].sku||item.channel!==expected[i].channel||
       Number(item.duration_days)!==expected[i].durationDays))
       return json(res,503,{error:'store_paid_delivery_unavailable'});
     const codes=rows.map(item=>{
       const code=decryptStreamCode(item.id,item.code_vault,keyHex);
       if(!code||streamCodeProof(code,keyHex)!==item.code_hash)
         throw err('store_code_integrity_unavailable',503);
       return {position:item.position,sku:item.sku,channel:item.channel,
         durationDays:Number(item.duration_days),code};
     });
     return json(res,200,{orderId:order.id,orderNumber,status:'paid',fulfilled:true,
       sku:CART_SKU,amountMinor:order.amount_minor,currency:'SAR',
       createdAt:order.created_at,paidAt:order.paid_at,
       items:parsed.items,discountMinor:order.coupon_discount_minor||0,codes});
   }
   if(order.sku===BUNDLE_SKU){
     const items=(await pool.query('SELECT ov.position,ov.channel,v.id,v.code_hash,v.code_vault,v.revoked_at FROM blofy_store_order_vouchers ov JOIN blofy_xtream_gateway_duration_codes v ON v.id=ov.voucher_id WHERE ov.order_id=$1 ORDER BY ov.position',[order.id])).rows;
     if(items.length!==2||items.some(x=>x.revoked_at||!x.code_vault))
       return json(res,503,{error:'store_paid_delivery_unavailable'});
     const codes=items.map(x=>{
       const code=decryptStreamCode(x.id,x.code_vault,keyHex);
       if(!code||streamCodeProof(code,keyHex)!==x.code_hash)throw err('store_code_integrity_unavailable',503);
       return {position:x.position,channel:x.channel,code,durationDays:365};
     });
     return json(res,200,{orderId:order.id,orderNumber,status:'paid',fulfilled:true,sku:order.sku,amountMinor:order.amount_minor,currency:'SAR',createdAt:order.created_at,paidAt:order.paid_at,codes});
   }
   if(order.sku===RENEWAL_SKU){
     const renewed=(await pool.query(
       'SELECT v.id,v.code_hash,v.code_vault,v.revoked_at,v.expires_at '+
       'FROM blofy_store_renewal_orders r JOIN blofy_xtream_gateway_duration_codes v '+
       'ON v.id=r.voucher_id WHERE r.order_id=$1',[order.id])).rows[0];
     if(!renewed||renewed.revoked_at||!renewed.code_vault)
       return json(res,503,{error:'store_paid_delivery_unavailable'});
     const sameCode=decryptStreamCode(renewed.id,renewed.code_vault,keyHex);
     if(!sameCode||streamCodeProof(sameCode,keyHex)!==renewed.code_hash)
       return json(res,503,{error:'store_code_integrity_unavailable'});
     return json(res,200,{orderId:order.id,orderNumber,status:'paid',fulfilled:true,
       sameCodeRenewal:true,sku:RENEWAL_SKU,channel:order.channel,
       amountMinor:order.amount_minor,currency:'SAR',createdAt:order.created_at,
       paidAt:order.paid_at,renewalDays:Number(order.duration_days),
       expiresAt:renewed.expires_at,code:sameCode});
   }
   if(!order.voucher_id)return json(res,503,{error:'store_paid_delivery_unavailable'});
   const voucher=(await pool.query('SELECT id,code_hash,code_vault,revoked_at FROM blofy_xtream_gateway_duration_codes WHERE id=$1',
    [order.voucher_id])).rows[0];
   if(!voucher||voucher.revoked_at||!voucher.code_vault)return json(res,503,{error:'store_paid_delivery_unavailable'});
   const code=decryptStreamCode(voucher.id,voucher.code_vault,keyHex);
   if(!code||streamCodeProof(code,keyHex)!==voucher.code_hash)return json(res,503,{error:'store_code_integrity_unavailable'});
   return json(res,200,{orderId:order.id,orderNumber,status:'paid',fulfilled:true,sku:order.sku,channel:order.channel,
      amountMinor:order.amount_minor,currency:'SAR',createdAt:order.created_at,paidAt:order.paid_at,
      durationDays:order.duration_days,code,redeemUrl:'https://blofyplayer.com/stream/activate'});
 }
 async function returned(req,res,url){
   const id=url.searchParams.get('reference')||'';
   let path='/#products';
   if(UUID.test(id))try{
     const row=(await pool.query('SELECT sku FROM blofy_store_geidea_orders WHERE id=$1',[id])).rows[0];
     path=row?.sku===RENEWAL_SKU?'/store/account?renewal_order_id='+encodeURIComponent(id):
       row?.sku===CART_SKU?'/store/orders#order='+encodeURIComponent(id):
       '/#store_order='+encodeURIComponent(id);
   }catch{
     path='/#store_order='+encodeURIComponent(id);
   }
   const site=url.searchParams.get('site');
   const host=site==='https://www.blofyplayer.com'||site==='https://blofyplayer.com'?
     site:'https://blofyplayer.com';
   res.writeHead(303,{location:host+path,
      'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
   res.end();
 }
 const handler=async function handler(req,res,url){
   const p=url.pathname;
   if(p==='/api/v1/admin/store/orders'&&req.method==='GET'){await adminOrders(req,res,url);return true;}
   if(p==='/api/v1/admin/store/fulfillment-audit'&&req.method==='GET'){await adminFulfillmentAudit(req,res);return true;}
   if(p==='/api/v1/store/cart/quote'&&req.method==='POST'){await cartQuote(req,res);return true;}
   if(p==='/api/v1/store/cart/checkout'&&req.method==='POST'){await cartCheckout(req,res);return true;}
   if(p==='/api/v1/store/cart/pending'&&req.method==='POST'){await cartPending(req,res);return true;}
   if(p==='/api/v1/store/renewals/checkout'&&req.method==='POST'){await renewalFlow.checkout(req,res);return true;}
   if(p==='/api/v1/store/renewals/pending'&&req.method==='POST'){await renewalFlow.getPending(req,res);return true;}
   if(p==='/api/v1/admin/store/sales'&&req.method==='GET'){await salesSummary(req,res);return true;}
   if(p==='/api/v1/admin/store/coupons/create'&&req.method==='POST'){await newCoupon(req,res);return true;}
   if(p==='/api/v1/admin/store/coupons/deactivate'&&req.method==='POST'){await disableCoupon(req,res);return true;}
   if(p==='/api/v1/admin/store/inventory'&&req.method==='GET'){await inventorySummary(req,res);return true;}
   if(p==='/api/v1/admin/store/inventory/import'&&req.method==='POST'){await importInventory(req,res);return true;}
   if(p==='/api/v1/admin/store/inventory/generate'&&req.method==='POST'){await generateInventory(req,res);return true;}
   if(p==='/api/v1/store/coupon/quote'&&req.method==='POST'){await couponQuote(req,res);return true;}
   if(p==='/api/v1/store/products'&&req.method==='GET'){await catalog(req,res);return true;}
   if(p==='/api/v1/store/checkout'&&req.method==='POST'){await checkout(req,res);return true;}
   if(p==='/api/v1/store/orders/status'&&req.method==='POST'){await status(req,res);return true;}
   if(p==='/api/v1/store/geidea/webhook'&&req.method==='POST'){await webhook(req,res);return true;}
   if(p==='/api/v1/store/geidea/return'&&req.method==='GET'){await returned(req,res,url);return true;}
   return false;
 };
 // Only call this from the verified customer portal AFTER owner authorization
 // and server-side rate limiting. Never expose an unauthenticated public endpoint.
 handler.reconcileCustomerOrder=async id=>{
   if(!UUID.test(id||''))throw err('store_invalid_order_id',400);
   return reconcile(id);
 };
 return handler;
}

// New-code storefront: separate from registered-device renewals.
// Uses the existing live Geidea credentials, with no unverified payment fulfillment.
import crypto from 'node:crypto';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';
import {createSignature,verifyGeideaCallback,verifiedPayment,CARD_ONLY_WALLETS} from './geidea-live.mjs';
import {ensureStreamCodeTable,streamNumericCodeLength,randomNumericStreamCode,streamCodeProof,normalizeStreamCode} from './xtream-duration-codes.mjs';
import {encryptStreamCode,decryptStreamCode} from './xtream-code-vault.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const API='https://api.ksamerchant.geidea.net';
const ALLOWED_ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const P=[
 ['stream-3m','كود BLOFY STREAM — 3 أشهر','app',90,4000],
 ['stream-6m','كود BLOFY STREAM — 6 أشهر','app',180,6000],
 ['stream-1y','كود BLOFY STREAM — سنة','app',365,10000],
 ['xtream-3m','Xtream BLOFY — 3 أشهر','xtream',90,4000],
 ['xtream-6m','Xtream BLOFY — 6 أشهر','xtream',180,6000],
 ['xtream-1y','Xtream BLOFY — سنة','xtream',365,10000]
];
const err=(code,status=400)=>Object.assign(Error(code),{status});
const tokenHash=s=>crypto.createHash('sha256').update(s).digest('hex');
const rateCheckout=createFixedWindowLimiter({limit:8,windowMs:600000});
const rateStatus=createFixedWindowLimiter({limit:45,windowMs:600000});
export function publicStorePlans(){return P.map(([sku,name,channel,durationDays,priceMinor])=>({sku,name,channel,durationDays,priceMinor,currency:'SAR'}));}

export function createStoreGeideaHandlers({pool,json,readJson,keyHex,authorizeAdmin=()=>false,env=process.env,fetchImpl=globalThis.fetch}){
 const publicKey=String(env.GEIDEA_LIVE_MERCHANT_PUBLIC_KEY||'').trim();
 const password=String(env.GEIDEA_LIVE_API_PASSWORD||'');
 const selected=env.BLOFY_PAYMENT_PROVIDER==='geidea'&&env.BLOFY_GEIDEA_CHECKOUT_ENABLED==='true';
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
     'CREATE INDEX IF NOT EXISTS idx_blofy_store_inventory_available ON blofy_store_inventory(sku) WHERE sold_at IS NULL'
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
      const plan=P.find(p=>p[0]===order.sku);
      // Pending orders created before the price change must remain fulfillable at
      // their original immutable captured price. New sessions use only today's catalog.
      const formerPrices={'stream-3m':3000,'stream-6m':5000,'stream-1y':7000,
        'xtream-3m':3000,'xtream-6m':5000,'xtream-1y':7000};
      const historical=formerPrices[order.sku]===Number(order.amount_minor) &&
        new Date(order.created_at).getTime()<Date.parse('2026-11-18T16:00:00Z');
      if(!plan||plan[2]!==order.channel||plan[3]!==order.duration_days||
        (plan[4]!==Number(order.amount_minor)&&!historical))
        throw err('store_catalog_price_mismatch',409);
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
   return json(res,200,{provider:'geidea',checkoutAvailable,products:publicStorePlans()});
 }
 async function checkout(req,res){
   if(!enabled)return json(res,503,{error:'store_checkout_disabled'});
   if(!browser(req,res))return;
   if(!rateCheckout.consume(requestClientKey(req)).allowed)return json(res,429,{error:'rate_limited'});
   const body=await readJson(req);
   const plan=P.find(p=>p[0]===body?.sku);
   if(!plan)return json(res,400,{error:'store_invalid_sku'});
   await source();await schema();
   const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url');
   await pool.query('INSERT INTO blofy_store_geidea_orders '+
     '(id,sku,channel,duration_days,amount_minor,access_hash) VALUES($1,$2,$3,$4,$5,$6)',
     [id,plan[0],plan[2],plan[3],plan[4],tokenHash(secret)]);
   const timestamp=new Date().toISOString().slice(0,19).replaceAll('-','/').replace('T',' ');
   const request={
    amount:(plan[4]/100).toFixed(2),currency:'SAR',timestamp,merchantReferenceId:id,
    signature:createSignature({publicKey,password,amountMinor:plan[4],reference:id,timestamp}),
    paymentOperation:'Pay',language:'ar',hideWallets:[...CARD_ONLY_WALLETS],expressCheckouts:[],
    acceptTabbyPaymentMethod:false,acceptTamaraPaymentMethod:false,appearance:{uiMode:'modal'},
    callbackUrl:base+'/api/v1/store/geidea/webhook',
    returnUrl:base+'/api/v1/store/geidea/return?reference='+id
   };
   let created;try{created=await provider('/payment-intent/api/v2/direct/session','POST',request);}
   catch{return json(res,503,{error:'store_geidea_session_unavailable'});}
   if(!UUID.test(created?.session?.id||'')||Date.parse(created?.session?.expiryDate||'')<=Date.now())
    return json(res,502,{error:'store_geidea_session_invalid'});
   await pool.query('UPDATE blofy_store_geidea_orders SET session_id=$2 WHERE id=$1',[id,created.session.id]);
   return json(res,201,{provider:'geidea',checkoutMode:'modal',orderId:id,accessToken:secret,
    sessionId:created.session.id,sku:plan[0],priceMinor:plan[4],currency:'SAR'});
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
   if(!enabled)return json(res,503,{error:'store_checkout_disabled'});
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
   if(order.status==='pending'&&order.session_id&&
      (!order.last_checked_at||Date.now()-new Date(order.last_checked_at).getTime()>12000)){
     const claim=await pool.query('UPDATE blofy_store_geidea_orders SET last_checked_at=NOW() '+
      "WHERE id=$1 AND status='pending' AND (last_checked_at IS NULL OR last_checked_at<NOW()-INTERVAL '12 seconds') RETURNING id",
      [order.id]);
     if(claim.rowCount)try{await reconcile(order.id);}catch{}
     order=(await pool.query('SELECT * FROM blofy_store_geidea_orders WHERE id=$1',[order.id])).rows[0];
   }
   if(order.status!=='paid'||!order.voucher_id)return json(res,200,{status:order.status,fulfilled:false});
   const voucher=(await pool.query('SELECT id,code_hash,code_vault,revoked_at FROM blofy_xtream_gateway_duration_codes WHERE id=$1',
    [order.voucher_id])).rows[0];
   if(!voucher||voucher.revoked_at||!voucher.code_vault)return json(res,503,{error:'store_paid_delivery_unavailable'});
   const code=decryptStreamCode(voucher.id,voucher.code_vault,keyHex);
   if(!code||streamCodeProof(code,keyHex)!==voucher.code_hash)return json(res,503,{error:'store_code_integrity_unavailable'});
   return json(res,200,{status:'paid',fulfilled:true,sku:order.sku,channel:order.channel,
      durationDays:order.duration_days,code,redeemUrl:'https://blofyplayer.com/stream/activate'});
 }
 async function returned(req,res,url){
   const id=url.searchParams.get('reference')||'';
   res.writeHead(303,{location:'https://blofyplayer.com/'+
      (UUID.test(id)?'#store_order='+encodeURIComponent(id):'#products'),
      'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
   res.end();
 }
 return async function handler(req,res,url){
   const p=url.pathname;
   if(p==='/api/v1/admin/store/inventory'&&req.method==='GET'){await inventorySummary(req,res);return true;}
   if(p==='/api/v1/admin/store/inventory/import'&&req.method==='POST'){await importInventory(req,res);return true;}
   if(p==='/api/v1/admin/store/inventory/generate'&&req.method==='POST'){await generateInventory(req,res);return true;}
   if(p==='/api/v1/store/products'&&req.method==='GET'){await catalog(req,res);return true;}
   if(p==='/api/v1/store/checkout'&&req.method==='POST'){await checkout(req,res);return true;}
   if(p==='/api/v1/store/orders/status'&&req.method==='POST'){await status(req,res);return true;}
   if(p==='/api/v1/store/geidea/webhook'&&req.method==='POST'){await webhook(req,res);return true;}
   if(p==='/api/v1/store/geidea/return'&&req.method==='GET'){await returned(req,res,url);return true;}
   return false;
 };
}

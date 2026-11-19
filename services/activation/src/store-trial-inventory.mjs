// BLOFY STORE PRO: isolated one-day, never-for-sale STREAM/Xtream trial stock.
// All vouchers use the existing encrypted source-locked code system.
// A verified account can claim ONE trial total across both channels.
// This module never creates, modifies or fulfills a Geidea paid order.
import crypto from 'node:crypto';
import {ensureStreamCodeTable,streamNumericCodeLength,randomNumericStreamCode,streamCodeProof} from './xtream-duration-codes.mjs';
import {encryptStreamCode,decryptStreamCode} from './xtream-code-vault.mjs';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';

export const TRIAL_PLANS=Object.freeze([
 {sku:'trial-stream-1d',channel:'app',name:'تجربة BLOFY STREAM',days:1},
 {sku:'trial-xtream-1d',channel:'xtream',name:'تجربة Xtream',days:1}
]);
const publicPlans=()=>TRIAL_PLANS.map(({sku,channel,name,days})=>({sku,channel,name,durationDays:days,priceMinor:0,currency:'SAR'}));
const ALLOWED_ORIGINS=new Set([
 'https://blofyplayer.com','https://www.blofyplayer.com',
 'https://api.blofyplayer.com'
]);
const NO_CACHE={'cache-control':'no-store, private','x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer','pragma':'no-cache'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const fail=(code,status=400)=>Object.assign(Error(code),{status});
const ROUTE='/api/v1/store/trials';
const ADMIN='/api/v1/admin/store/trials';

export function trialStockRequest(body){
 const sku=String(body?.sku||'');
 return TRIAL_PLANS.find(plan=>plan.sku===sku)||null;
}
export function publicTrialCode(row,keyHex){
 const voucher=row?.voucher_id?row:row?.voucher;
 if(!voucher?.id||!voucher?.code_vault||!voucher?.code_hash)throw fail('trial_code_unavailable',503);
 const code=decryptStreamCode(voucher.id,voucher.code_vault,keyHex);
 if(!code||streamCodeProof(code,keyHex)!==voucher.code_hash)
  throw fail('trial_code_integrity_unavailable',503);
 return code;
}
export function createStoreTrialInventory({
 pool,json,readJson,keyHex,authorizeAdmin=()=>false,
 getAuthenticatedCustomer=async()=>null,env=process.env,clock=Date.now
}={}){
 if(!pool||typeof json!=='function'||typeof readJson!=='function'||
    typeof getAuthenticatedCustomer!=='function'||!/^[0-9a-f]{64}$/i.test(String(keyHex||'')))
  throw Error('trial_inventory_dependencies_invalid');
 const enabled=env.BLOFY_STORE_TRIALS_ENABLED==='true'&&
  env.BLOFY_CUSTOMER_ACCOUNTS_ENABLED==='true'&&
  String(env.BLOFY_CUSTOMER_RESEND_API_KEY||'').startsWith('re_')&&
  String(env.BLOFY_CUSTOMER_MAIL_FROM||'').includes('@');
 const claimsLimiter=createFixedWindowLimiter({limit:6,windowMs:10*60_000,maxEntries:12000});
 let migration=null;
 async function schema(){
  if(!migration)migration=(async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(718420697)');
    await ensureStreamCodeTable(db);
    await db.query(`CREATE TABLE IF NOT EXISTS blofy_store_trial_inventory(
     voucher_id UUID PRIMARY KEY REFERENCES blofy_xtream_gateway_duration_codes(id),
     sku TEXT NOT NULL CHECK(sku IN ('trial-stream-1d','trial-xtream-1d')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     claimed_at TIMESTAMPTZ,
     customer_id UUID,
     CONSTRAINT store_trial_claim_consistent CHECK (
       (claimed_at IS NULL AND customer_id IS NULL) OR
       (claimed_at IS NOT NULL AND customer_id IS NOT NULL)
     )
    )`);
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_blofy_store_trial_customer_once ON blofy_store_trial_inventory(customer_id) WHERE customer_id IS NOT NULL');
    await db.query('CREATE INDEX IF NOT EXISTS idx_blofy_store_trial_ready ON blofy_store_trial_inventory(sku,created_at) WHERE claimed_at IS NULL');
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}
   finally{db.release()}
  })().catch(e=>{migration=null;throw e});
  return migration;
 }
 async function chosenSource(db){
  const result=await db.query(`SELECT id FROM blofy_xtream_servers
    WHERE lower(btrim(name))='saleh' AND enabled=TRUE AND publish_catalog=TRUE
    AND deletion_requested_at IS NULL LIMIT 2`);
  if(result.rows.length!==1)throw fail('trial_source_unavailable',503);
  return result.rows[0].id;
 }
 function renderClaim(row,alreadyClaimed){
  if(!row)return null;
  const code=publicTrialCode(row,keyHex);
  const plan=TRIAL_PLANS.find(x=>x.sku===row.sku);
  if(!plan||Number(row.duration_days)!==1||row.code_channel!==plan.channel)
   throw fail('trial_code_channel_mismatch',503);
  return {ok:true,sku:row.sku,channel:plan.channel,durationDays:1,code,
   alreadyClaimed:Boolean(alreadyClaimed),claimedAt:row.claimed_at,
   activatedAt:row.redeemed_at||null,expiresAt:row.expires_at||null,
   message:'تبدأ مدة اليوم الواحد عند أول تفعيل ناجح للكود، وليس عند تخزينه أو طلبه.',
   redeemUrl:plan.channel==='xtream'?'https://blofyplayer.com/stream/activate':null};
 }
 async function findClaim(db,customerId){
  return (await db.query(`SELECT i.sku,i.claimed_at,v.id,v.code_vault,v.code_hash,
      v.duration_days,v.code_channel,v.redeemed_at,v.expires_at,
      v.id AS voucher_id
    FROM blofy_store_trial_inventory i
    JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id
    WHERE i.customer_id=$1 LIMIT 1`,[customerId])).rows[0]||null;
 }
 async function publicAvailability(req,res){
  if(!enabled)return json(res,200,{ok:true,enabled:false,loginRequired:true,
   products:publicPlans().map(p=>({...p,available:0})),
   message:'التجارب المباشرة غير مفعلة حاليًا؛ تواصل مع الدعم لمعرفة التوفر.'},NO_CACHE);
  await schema();
  const rows=(await pool.query(`SELECT i.sku,
   COUNT(*) FILTER (WHERE i.claimed_at IS NULL AND v.redeemed_at IS NULL
     AND v.revoked_at IS NULL AND v.account_id IS NULL AND v.code_vault IS NOT NULL)::int AS available
   FROM blofy_store_trial_inventory i
   JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id
   GROUP BY i.sku`)).rows;
  const quantities=new Map(rows.map(row=>[row.sku,Number(row.available)||0]));
  return json(res,200,{ok:true,enabled:true,loginRequired:true,
   products:publicPlans().map(p=>({...p,available:quantities.get(p.sku)||0})),
   maxClaimsPerAccount:1,trialBegins:'first_successful_activation'},NO_CACHE);
 }
 async function mine(req,res){
  if(!enabled)return json(res,503,{error:'trials_unavailable'},NO_CACHE);
  const customer=await getAuthenticatedCustomer(req);
  if(!customer?.id||!UUID.test(customer.id))
   return json(res,401,{error:'trial_login_required'},NO_CACHE);
  await schema();
  const row=await findClaim(pool,customer.id);
  return json(res,200,{ok:true,claimed:Boolean(row),trial:row?renderClaim(row,true):null},NO_CACHE);
 }
 async function generate(req,res){
  if(!authorizeAdmin(req,res))return;
  const body=await readJson(req);
  const plan=trialStockRequest(body),quantity=Number(body?.quantity);
  if(!plan||!Number.isSafeInteger(quantity)||quantity<1||quantity>30)
   return json(res,400,{error:'trial_batch_invalid'},NO_CACHE);
  await schema();
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const sourceId=await chosenSource(db);
   // Share the existing issuance lock so voucher length and HMAC proofs
   // cannot conflict with normal paid stock issuance across workers.
   await db.query('SELECT pg_advisory_xact_lock(718420682)');
   const countRow=await db.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes');
   let count=Number(countRow.rows[0]?.n)||0;
   for(let i=0;i<quantity;i++){
    let saved=false;
    for(let attempt=0;attempt<12;attempt++){
     const code=randomNumericStreamCode(streamNumericCodeLength(count));
     const voucherId=crypto.randomUUID();
     const row=await db.query(`INSERT INTO blofy_xtream_gateway_duration_codes
      (id,code_hash,code_hint,label,source_id,duration_days,max_connections,
       code_channel,code_vault,dual_access_enabled)
      VALUES($1,$2,$3,$4,$5,1,1,$6,$7,FALSE)
      ON CONFLICT(code_hash) DO NOTHING RETURNING id`,[
       voucherId,streamCodeProof(code,keyHex),code.slice(0,2)+'••••'+code.slice(-2),
       plan.name+' — يوم واحد',sourceId,plan.channel,
       encryptStreamCode(voucherId,code,keyHex)
      ]);
     if(!row.rows.length)continue;
     await db.query('INSERT INTO blofy_store_trial_inventory(voucher_id,sku) VALUES($1,$2)',
      [voucherId,plan.sku]);
     count++;saved=true;break;
    }
    if(!saved)throw fail('trial_generation_unavailable',503);
   }
   await db.query('COMMIT');
   return json(res,200,{ok:true,sku:plan.sku,generated:quantity,
    durationDays:1,activated:false},NO_CACHE);
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}
  finally{db.release()}
 }

 // Internal-only refill. Automatically seeds 30+30 on first deployment and
 // subsequently restores one SKU to 30 only once its available stock is <10.
 // No public route and no raw customer codes in logs or API responses.
 async function autoRefillTrials({target=30,threshold=10}={}){
  if(!enabled||env.BLOFY_STORE_TRIAL_AUTO_REFILL_ENABLED!=='true')
   return {ok:false,reason:'disabled'};
  if(target!==30||threshold!==10)throw fail('trial_refill_config_invalid',400);
  await schema();
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   await db.query('SELECT pg_advisory_xact_lock(718420682)');
   const amounts=(await db.query(`SELECT i.sku,
      COUNT(*) FILTER (WHERE i.claimed_at IS NULL AND v.redeemed_at IS NULL
        AND v.revoked_at IS NULL AND v.account_id IS NULL
        AND v.code_vault IS NOT NULL)::int AS available
      FROM blofy_store_trial_inventory i
      JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id
      GROUP BY i.sku`)).rows;
   const available=new Map(amounts.map(row=>[row.sku,Number(row.available)||0]));
   const targetRows=TRIAL_PLANS.map(p=>({
     ...p,before:available.get(p.sku)||0,
     added:0
   }));
   if(!targetRows.some(row=>row.before<threshold)){
     await db.query('COMMIT');
     return {ok:true,generated:0,available:targetRows.map(p=>({sku:p.sku,available:p.before}))};
   }
   const selected=targetRows.filter(row=>row.before<threshold);
   const sourceId=await chosenSource(db);
   const count=(await db.query('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes')).rows[0];
   let issued=Number(count?.n)||0;
   for(const row of selected){
     const missing=Math.max(0,target-row.before);
     for(let i=0;i<missing;i++){
       let inserted=false;
       for(let attempt=0;attempt<12;attempt++){
         const code=randomNumericStreamCode(streamNumericCodeLength(issued));
         const voucherId=crypto.randomUUID();
         const save=await db.query(`INSERT INTO blofy_xtream_gateway_duration_codes
          (id,code_hash,code_hint,label,source_id,duration_days,max_connections,
           code_channel,code_vault,dual_access_enabled)
          VALUES($1,$2,$3,$4,$5,1,1,$6,$7,FALSE)
          ON CONFLICT(code_hash) DO NOTHING RETURNING id`,[
           voucherId,streamCodeProof(code,keyHex),code.slice(0,2)+'••••'+code.slice(-2),
           row.name+' — يوم واحد',sourceId,row.channel,
           encryptStreamCode(voucherId,code,keyHex)
         ]);
         if(!save.rows.length)continue;
         await db.query('INSERT INTO blofy_store_trial_inventory(voucher_id,sku) VALUES($1,$2)',
           [voucherId,row.sku]);
         issued++;row.added++;inserted=true;break;
       }
       if(!inserted)throw fail('trial_refill_generation_unavailable',503);
     }
   }
   await db.query('COMMIT');
   return {ok:true,generated:targetRows.reduce((n,x)=>n+x.added,0),
    available:targetRows.map(row=>({sku:row.sku,available:row.before+row.added}))};
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}
  finally{db.release()}
 }
 async function adminSummary(req,res){
  if(!authorizeAdmin(req,res))return;
  await schema();
  const [rows,recent]=await Promise.all([
   pool.query(`SELECT i.sku,COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE i.claimed_at IS NULL AND v.redeemed_at IS NULL
      AND v.revoked_at IS NULL AND v.account_id IS NULL AND v.code_vault IS NOT NULL)::int AS available,
    COUNT(*) FILTER (WHERE i.claimed_at IS NOT NULL)::int AS claimed
    FROM blofy_store_trial_inventory i
    JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id
    GROUP BY i.sku`),
   pool.query(`SELECT i.sku,i.claimed_at,v.code_hint,
    v.redeemed_at,v.expires_at
    FROM blofy_store_trial_inventory i
    JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id
    WHERE i.claimed_at IS NOT NULL ORDER BY i.claimed_at DESC LIMIT 20`)
  ]);
  return json(res,200,{ok:true,publicEnabled:enabled,
   products:publicPlans().map(p=>({...p,...(rows.rows.find(r=>r.sku===p.sku)||
     {total:0,available:0,claimed:0})})),
   recent:recent.rows.map(row=>({sku:row.sku,codeHint:row.code_hint,
    claimedAt:row.claimed_at,activatedAt:row.redeemed_at,expiresAt:row.expires_at}))},NO_CACHE);
 }
 async function claim(req,res){
  if(!enabled)return json(res,503,{error:'trials_unavailable'},NO_CACHE);
  if(!ALLOWED_ORIGINS.has(String(req.headers?.origin||''))||
     req.headers?.['x-blofy-trial']!=='1')
   return json(res,403,{error:'trial_origin_invalid'},NO_CACHE);
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
    String(req.headers?.['content-type']||'')))
   return json(res,415,{error:'trial_content_type_invalid'},NO_CACHE);
  if(Number(req.headers?.['content-length']||0)>1000)
   return json(res,413,{error:'trial_body_too_large'},NO_CACHE);
  const visitor=requestClientKey(req);
  if(!claimsLimiter.consume(visitor,clock()).allowed)
   return json(res,429,{error:'trial_rate_limited'},NO_CACHE);
  const customer=await getAuthenticatedCustomer(req);
  if(!customer?.id||!UUID.test(customer.id))
   return json(res,401,{error:'trial_login_required'},NO_CACHE);
  if(env.BLOFY_CUSTOMER_PROFILE_REQUIRED==='true'&&
     (!customer.full_name||!customer.phone_e164))
   return json(res,403,{error:'trial_profile_required'},NO_CACHE);
  const plan=trialStockRequest(await readJson(req));
  if(!plan)return json(res,400,{error:'trial_product_invalid'},NO_CACHE);
  await schema();
  const db=await pool.connect();
  let issued;
  try{
   await db.query('BEGIN');
   // Global reservation mutex + per-customer uniqueness make concurrent
   // cross-channel requests unable to take two separate free codes.
   await db.query('SELECT pg_advisory_xact_lock(718420698)');
   const existing=await findClaim(db,customer.id);
   if(existing){
    issued=renderClaim(existing,true);
   }else{
    const claimedCount=(await db.query(`SELECT COUNT(*)::int AS n
     FROM blofy_store_trial_inventory
     WHERE claimed_at > NOW()-INTERVAL '24 hours'`)).rows[0];
    const dailyCap=Math.max(1,Math.min(100,Number(env.BLOFY_STORE_TRIALS_DAILY_LIMIT)||25));
    if(Number(claimedCount?.n)>=dailyCap)throw fail('trial_daily_quota_reached',429);
    const next=(await db.query(`SELECT i.voucher_id
     FROM blofy_store_trial_inventory i
     JOIN blofy_xtream_gateway_duration_codes v ON v.id=i.voucher_id
     WHERE i.sku=$1 AND i.claimed_at IS NULL AND v.redeemed_at IS NULL
       AND v.revoked_at IS NULL AND v.account_id IS NULL
       AND v.code_vault IS NOT NULL
     ORDER BY i.created_at,i.voucher_id FOR UPDATE OF i SKIP LOCKED LIMIT 1`,
     [plan.sku])).rows[0];
    if(!next)throw fail('trial_out_of_stock',409);
    await db.query(`UPDATE blofy_store_trial_inventory
      SET customer_id=$2,claimed_at=NOW()
      WHERE voucher_id=$1 AND customer_id IS NULL`,
      [next.voucher_id,customer.id]);
    const row=await findClaim(db,customer.id);
    issued=renderClaim(row,false);
   }
   await db.query('COMMIT');
  }catch(e){
   await db.query('ROLLBACK').catch(()=>{});
   if(e.status)return json(res,e.status,{error:e.message},NO_CACHE);
   // Conflict on the UNIQUE customer claim index: another request won.
   if(e.code==='23505')return json(res,409,{error:'trial_already_claimed'},NO_CACHE);
   throw e;
  }finally{db.release()}
  return json(res,200,issued,NO_CACHE);
 }
 const handler=async function handle(req,res,url){
  const path=url.pathname;
  if(![ROUTE+'/availability',ROUTE+'/mine',ROUTE+'/claim',
        ADMIN+'/summary',ADMIN+'/generate'].includes(path))return false;
  if(path===ROUTE+'/availability'&&req.method==='GET')await publicAvailability(req,res);
  else if(path===ROUTE+'/mine'&&req.method==='GET')await mine(req,res);
  else if(path===ROUTE+'/claim'&&req.method==='POST')await claim(req,res);
  else if(path===ADMIN+'/summary'&&req.method==='GET')await adminSummary(req,res);
  else if(path===ADMIN+'/generate'&&req.method==='POST')await generate(req,res);
  else json(res,405,{error:'method_not_allowed'},{...NO_CACHE,allow:path.endsWith('claim')||path.endsWith('generate')?'POST':'GET'});
  return true;
 };
 handler.autoRefillTrials=autoRefillTrials;
 return handler;
}

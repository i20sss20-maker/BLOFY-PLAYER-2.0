// Verified, opt-in customer feedback and factual storefront metrics.
// Never synthesize testimonials, inflate paid-order totals or publish private customer records.
import crypto from 'node:crypto';
import {createFixedWindowLimiter,requestClientKey} from './auth-protection.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORIGINS=new Set(['https://blofyplayer.com','https://www.blofyplayer.com','https://api.blofyplayer.com']);
const NO_STORE={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const PUBLIC_CACHE={'cache-control':'public, max-age=30','x-content-type-options':'nosniff'};
const bad=(code,status=400)=>Object.assign(Error(code),{status});

export function normalizeReview(input={}){
  const rating=Number(input.rating);
  const body=typeof input.body==='string'?input.body.trim().replace(/\s+/g,' '):'';
  if(!Number.isInteger(rating)||rating<1||rating>5)throw bad('review_rating_invalid');
  if(body.length<15||body.length>600||/[\x00-\x08\x0b\x0c\x0e-\x1f<>]/.test(body))
    throw bad('review_text_invalid');
  // Protect reviewers from accidentally publishing contact info or links.
  if(/https?:\/\/|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?966|0)5\d{8}/i.test(body))
    throw bad('review_personal_info_disallowed');
  if(typeof input.showFirstName!=='boolean')throw bad('review_consent_required');
  return {rating,body,showFirstName:input.showFirstName};
}
function sameOrigin(req){
 const o=String(req.headers?.origin||'');
 if(o&&!ORIGINS.has(o))return false;
 const site=String(req.headers?.['sec-fetch-site']||'');
 return !site||['same-origin','same-site','none'].includes(site);
}
const safePublicRow=x=>({
 id:x.id,rating:Number(x.rating),text:String(x.body).slice(0,600),
 displayName:String(x.display_name||'عميل BLOFY').slice(0,35),
 date:x.approved_at||x.created_at
});

export function createStoreSocialProof({pool,json,readJson,authorizeAdmin=()=>false,
 getAuthenticatedCustomer=async()=>null,ensureCustomerSchema=async()=>{},
 ensureStoreSchema=async()=>{},ensureTrialSchema=async()=>{}}={}){
 if(!pool||!json||!readJson)throw Error('store_social_proof_dependencies_invalid');
 const limiter=createFixedWindowLimiter({limit:12,windowMs:60*60*1000});
 let ready=null;
 async function schema(){
  if(!ready)ready=(async()=>{
   await ensureCustomerSchema();
   await ensureTrialSchema();
   await ensureStoreSchema();
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(718420982)');
    await db.query(`CREATE TABLE IF NOT EXISTS blofy_store_reviews(
      id UUID PRIMARY KEY,
      customer_id UUID NOT NULL UNIQUE REFERENCES blofy_store_customers(id) ON DELETE CASCADE,
      rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      body TEXT NOT NULL,
      display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      moderated_at TIMESTAMPTZ
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS idx_blofy_store_reviews_public ON blofy_store_reviews(approved_at DESC) WHERE status=\'approved\'');
    await db.query(`CREATE TABLE IF NOT EXISTS blofy_store_review_events(
      id UUID PRIMARY KEY,review_id UUID NOT NULL REFERENCES blofy_store_reviews(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('approved','rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await db.query('COMMIT');
   }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
   finally{db.release();}
  })().catch(error=>{ready=null;throw error});
  return ready;
 }
 async function counts(){
  const found=(await pool.query(`SELECT
    to_regclass('public.blofy_store_geidea_orders') AS orders,
    to_regclass('public.blofy_store_trial_inventory') AS trials`)).rows[0]||{};
  const [paid,trials]=await Promise.all([
    found.orders?pool.query(`SELECT COUNT(*)::int AS n FROM blofy_store_geidea_orders o
      WHERE o.status='paid' AND
        (o.voucher_id IS NOT NULL OR
         EXISTS(SELECT 1 FROM blofy_store_cart_vouchers c WHERE c.order_id=o.id) OR
         EXISTS(SELECT 1 FROM blofy_store_order_vouchers c WHERE c.order_id=o.id))`):{rows:[{n:0}]},
    found.trials?pool.query(`SELECT COUNT(*)::int AS n FROM blofy_store_trial_inventory
      WHERE claimed_at IS NOT NULL`):{rows:[{n:0}]}
  ]);
  return {fulfilledPaidOrders:Number(paid.rows[0]?.n||0),deliveredTrials:Number(trials.rows[0]?.n||0)};
 }
 async function publicSummary(req,res){
  await schema();
  const [numbers,listed,total]=await Promise.all([
    counts(),
    pool.query(`SELECT id,rating,body,display_name,approved_at,created_at
      FROM blofy_store_reviews WHERE status='approved'
      ORDER BY approved_at DESC,id DESC LIMIT 6`),
    pool.query(`SELECT COUNT(*)::int AS n,
      COALESCE(ROUND(AVG(rating)::numeric,1),0) AS average
      FROM blofy_store_reviews WHERE status='approved'`)
  ]);
  const count=Number(total.rows[0]?.n||0);
  return json(res,200,{ok:true,metrics:{...numbers,source:'confirmed_store_records'},
    reviews:{total:count,average:count?Number(total.rows[0].average):null,
      items:listed.rows.map(safePublicRow)},syntheticReviews:false},PUBLIC_CACHE);
 }
 async function submit(req,res){
  if(!sameOrigin(req))throw bad('review_origin_invalid',403);
  if(!limiter.consume(requestClientKey(req)).allowed)throw bad('review_rate_limited',429);
  const customer=await getAuthenticatedCustomer(req);
  if(!customer?.id||!UUID.test(customer.id))throw bad('review_login_required',401);
  await schema();await ensureStoreSchema();
  const form=normalizeReview(await readJson(req));
  const eligible=(await pool.query(`SELECT
    EXISTS(SELECT 1 FROM blofy_store_trial_inventory t
      WHERE t.customer_id=$1 AND t.claimed_at IS NOT NULL) AS trial,
    EXISTS(SELECT 1 FROM blofy_store_customer_orders co
      JOIN blofy_store_geidea_orders o ON o.id=co.order_id
      WHERE co.customer_id=$1 AND o.status='paid') AS paid`,
    [customer.id])).rows[0];
  if(!eligible?.trial&&!eligible?.paid)throw bad('review_verified_order_required',403);
  const firstName=String(customer.full_name||'').trim().split(/\s+/)[0].slice(0,35);
  const displayName=form.showFirstName&&firstName?firstName:'عميل BLOFY';
  const row=(await pool.query(`
    INSERT INTO blofy_store_reviews(id,customer_id,rating,body,display_name)
      VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(customer_id) DO UPDATE SET
      rating=EXCLUDED.rating,body=EXCLUDED.body,display_name=EXCLUDED.display_name,
      status='pending',approved_at=NULL,moderated_at=NULL,updated_at=NOW()
    WHERE blofy_store_reviews.updated_at<NOW()-INTERVAL '1 minute'
    RETURNING id,status`,[crypto.randomUUID(),customer.id,form.rating,form.body,displayName])).rows[0];
  if(!row)throw bad('review_update_cooldown',429);
  return json(res,201,{ok:true,status:'pending',message:'تم استلام تقييمك للمراجعة؛ نشكرك على مشاركة تجربتك.'},NO_STORE);
 }
 async function adminList(req,res,url){
  if(!authorizeAdmin(req,res))return;
  await schema();
  const state=String(url.searchParams.get('status')||'pending');
  if(!['pending','approved','rejected'].includes(state))throw bad('review_status_invalid');
  const rows=(await pool.query(`SELECT r.id,r.rating,r.body,r.display_name,r.status,
    r.created_at,r.approved_at,c.email,c.full_name
    FROM blofy_store_reviews r
    JOIN blofy_store_customers c ON c.id=r.customer_id
    WHERE r.status=$1 ORDER BY r.updated_at DESC LIMIT 60`,[state])).rows;
  return json(res,200,{ok:true,items:rows.map(x=>({
    id:x.id,rating:Number(x.rating),text:x.body,displayName:x.display_name,
    email:x.email,fullName:x.full_name||'',status:x.status,
    createdAt:x.created_at,approvedAt:x.approved_at
  })),status:state},NO_STORE);
 }
 async function moderate(req,res,id){
  if(!authorizeAdmin(req,res))return;
  if(!sameOrigin(req))throw bad('review_origin_invalid',403);
  if(!UUID.test(id))throw bad('review_id_invalid');
  const data=await readJson(req);
  if(!['approved','rejected'].includes(data?.decision))throw bad('review_decision_invalid');
  await schema();
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const result=(await db.query(`UPDATE blofy_store_reviews
     SET status=$2,moderated_at=NOW(),approved_at=CASE WHEN $2='approved' THEN NOW() ELSE NULL END
     WHERE id=$1 AND status='pending' RETURNING id,status`,[id,data.decision])).rows[0];
   if(!result)throw bad('review_already_moderated',409);
   await db.query('INSERT INTO blofy_store_review_events(id,review_id,action) VALUES($1,$2,$3)',
    [crypto.randomUUID(),id,data.decision]);
   await db.query('COMMIT');
   return json(res,200,{ok:true,id,status:result.status},NO_STORE);
  }catch(error){await db.query('ROLLBACK').catch(()=>{});throw error}
  finally{db.release();}
 }
 return async(req,res,url)=>{
  const path=url.pathname;
  if(path==='/api/v1/store/social-proof'&&req.method==='GET'){
   await publicSummary(req,res);return true;
  }
  if(path==='/api/v1/store/reviews'&&req.method==='POST'){
   try{await submit(req,res);}catch(e){if(e.status)json(res,e.status,{error:e.message},NO_STORE);else throw e;}
   return true;
  }
  if(path==='/api/v1/admin/store/reviews'&&req.method==='GET'){
   try{await adminList(req,res,url);}catch(e){if(e.status)json(res,e.status,{error:e.message},NO_STORE);else throw e;}
   return true;
  }
  const moderation=path.match(/^\/api\/v1\/admin\/store\/reviews\/([0-9a-f-]{36})\/decision$/i);
  if(moderation&&req.method==='POST'){
   try{await moderate(req,res,moderation[1]);}catch(e){if(e.status)json(res,e.status,{error:e.message},NO_STORE);else throw e;}
   return true;
  }
  return false;
 };
}

// BLOFY STREAM scoped distributor accounts. They can ONLY issue/apply limited
// credits to app codes or Xtream accounts. No access to source, media, admin,
// subscriber or arbitrary gateway routes. All rows persist in primary Postgres.
import crypto from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(crypto.scrypt);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const USER=/^[a-z][a-z0-9_.-]{3,31}$/;
const DAY=86400000;
const SESSION_MS=12*60*60*1000;
// Distributor panel offers up to one year. Existing historic 2-year subscriptions stay valid.
const PLANS=new Map([[1,0],[30,1],[90,3],[180,6],[365,12]]);
const TRIALS_PER_24H=5;
export function distributorPlanCost(durationDays){
 const plan=Number(durationDays);
 if(!Number.isSafeInteger(plan)||!PLANS.has(plan))throw Object.assign(
  Error('distributor_plan_invalid'),{status:400});
 return PLANS.get(plan);
}
const fail=(code,status=400)=>Object.assign(Error(code),{status});
const number=(value,min,max,code)=>{
  const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw fail(code);return n;
};
const digest=token=>crypto.createHash('sha256').update(token).digest('hex');
const clean=(v,n=80)=>String(v||'').trim().replace(/[\x00-\x1f\x7f]/g,' ').slice(0,n);
async function passwordDigest(password){
  const salt=crypto.randomBytes(16).toString('hex');
  const hash=await scrypt(password,salt,64);
  return 's1:'+salt+':'+hash.toString('hex');
}
async function passwordMatches(password,record){
  const match=/^s1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(String(record||''));
  if(!match){await scrypt(String(password||''),'0'.repeat(32),64);return false;}
  const guess=await scrypt(String(password||''),match[1],64);
  return crypto.timingSafeEqual(Buffer.from(match[2],'hex'),guess);
}
const publicDistributor=row=>({
 id:row.id,name:row.display_name,username:row.username,
 enabled:row.enabled,credits:Number(row.credits||0),
 used:Number(row.issued_count||0),dailyLimit:Number(row.daily_issue_limit||100),
 createdAt:new Date(row.created_at).getTime()
});
const publicIssue=row=>{
 const expiry=row.subscription_expires_at?new Date(row.subscription_expires_at).getTime():null;
 const activated=row.code_activated_at?new Date(row.code_activated_at).getTime():null;
 const now=Date.now();
 const status=row.status!=='done'?row.status:
   row.kind==='app'&&!activated?'unused':
   row.code_revoked_at||row.account_enabled===false?'disabled':
   expiry!==null&&expiry<=now?'expired':
   expiry!==null&&expiry<=now+7*DAY?'expiring':'active';
 return {
 id:row.id,type:row.kind,label:row.label,days:Number(row.duration_days),
 converted:Number(row.duration_days)===1&&row.has_renewal===true,
 chargedCredits:Number(row.credit_cost??(Number(row.duration_days)===730?24:distributorPlanCost(row.duration_days))),
 maxConnections:Number(row.max_connections),
 status:row.status,subscriptionStatus:status,
 activatedAt:activated,expiresAt:expiry,
 canRelogin:status==='active'||status==='expiring'?row.kind==='app'&&row.code_bound===true:false,
 reloginCount:Number(row.admin_relogin_count||0),
 lastReloginAt:row.last_relogin_at?new Date(row.last_relogin_at).getTime():null,
 reloginUntil:row.admin_relogin_until?new Date(row.admin_relogin_until).getTime():null,
 codeHint:String(row.code_hint||'').slice(0,25),
  accountUsername:String(row.account_username||'').slice(0,48),
 customerName:String(row.customer_name||'').slice(0,80),
 customerPhone:String(row.customer_phone||'').slice(0,22),
 createdAt:new Date(row.created_at).getTime(),
 accountId:row.status==='done'?row.subject_id:null
 };
};
export function createStreamDistributors({pool,issueCode,issueXtream,revealCode,revealXtream,
  rotateXtream=null,listCatalog,trialKeyHex,clock=Date.now}={}){
 if(typeof listCatalog!=='function'||!/^[0-9a-f]{64}$/i.test(String(trialKeyHex||'')))
   throw Error('stream_distributor_catalog_or_key_unconfigured');
 if(!pool||![issueCode,issueXtream,revealCode,revealXtream].every(x=>typeof x==='function'))
   throw Error('stream_distributor_unconfigured');
 let schemaPromise;
 async function ensureSchema(){
  if(!schemaPromise)schemaPromise=(async()=>{
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_stream_distributors(
     id UUID PRIMARY KEY, display_name TEXT NOT NULL,
     username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
     enabled BOOLEAN NOT NULL DEFAULT TRUE,
     credits INTEGER NOT NULL DEFAULT 0 CHECK(credits>=0 AND credits<=100000),
     issued_count INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_stream_distributor_sessions(
     session_hash TEXT PRIMARY KEY, distributor_id UUID NOT NULL
       REFERENCES blofy_stream_distributors(id) ON DELETE CASCADE,
     expires_at TIMESTAMPTZ NOT NULL)`);
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_stream_distributor_issues(
     id UUID PRIMARY KEY, distributor_id UUID NOT NULL
       REFERENCES blofy_stream_distributors(id),
     request_id UUID NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('app','xtream')),
     label TEXT NOT NULL, duration_days INTEGER NOT NULL,
     max_connections INTEGER NOT NULL,
     subject_id UUID, status TEXT NOT NULL DEFAULT 'pending'
       CHECK(status IN ('pending','done','failed','review')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE(distributor_id,request_id))`);
   await pool.query(`ALTER TABLE blofy_stream_distributors ADD COLUMN IF NOT EXISTS
     daily_issue_limit INTEGER NOT NULL DEFAULT 100 CHECK(daily_issue_limit BETWEEN 1 AND 10000)`);
   await pool.query('ALTER TABLE blofy_stream_distributor_issues ADD COLUMN IF NOT EXISTS credit_cost INTEGER NOT NULL DEFAULT 1');
   await pool.query('ALTER TABLE blofy_stream_distributor_issues ADD COLUMN IF NOT EXISTS trial_customer_hash TEXT');
   await pool.query('ALTER TABLE blofy_stream_distributor_issues ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT \'\'');
   await pool.query('ALTER TABLE blofy_stream_distributor_issues ADD COLUMN IF NOT EXISTS customer_phone TEXT NOT NULL DEFAULT \'\'');
   await pool.query('ALTER TABLE blofy_stream_distributor_issues ADD COLUMN IF NOT EXISTS last_credential_rotation_at TIMESTAMPTZ');
   await pool.query('ALTER TABLE blofy_stream_distributor_issues ADD COLUMN IF NOT EXISTS credential_rotation_request_id UUID');
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_stream_distributor_actions(
     id UUID PRIMARY KEY,
     distributor_id UUID NOT NULL REFERENCES blofy_stream_distributors(id),
     issue_id UUID NOT NULL REFERENCES blofy_stream_distributor_issues(id),
     request_id UUID NOT NULL,
     action TEXT NOT NULL CHECK(action IN ('renew','relogin')),
     credit_cost INTEGER NOT NULL DEFAULT 0,
     result JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE(distributor_id,request_id))`);
   await pool.query(`CREATE INDEX IF NOT EXISTS idx_blofy_dist_issue_customers
     ON blofy_stream_distributor_issues(distributor_id,customer_phone,created_at DESC)`);
   await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_blofy_stream_trial_once
     ON blofy_stream_distributor_issues(trial_customer_hash)
     WHERE duration_days=1 AND trial_customer_hash IS NOT NULL
       AND status IN ('pending','done','review')`);
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_stream_distributor_credit_events(
     id UUID PRIMARY KEY,
     distributor_id UUID NOT NULL REFERENCES blofy_stream_distributors(id),
     issue_id UUID REFERENCES blofy_stream_distributor_issues(id),
     type TEXT NOT NULL CHECK(type IN ('opening','adjustment','issue','refund','renew')),
     delta INTEGER NOT NULL, balance_after INTEGER NOT NULL CHECK(balance_after>=0),
     details JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
   await pool.query(`CREATE INDEX IF NOT EXISTS idx_blofy_dist_credit_recent
     ON blofy_stream_distributor_credit_events(distributor_id,created_at DESC)`);
   await pool.query(`CREATE TABLE IF NOT EXISTS blofy_stream_distributor_library(
     distributor_id UUID NOT NULL REFERENCES blofy_stream_distributors(id),
     media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
     source_item_id TEXT NOT NULL,
     custom_group TEXT NOT NULL DEFAULT '',
     custom_title TEXT NOT NULL DEFAULT '',
     sort_order INTEGER NOT NULL DEFAULT 0,
     hidden BOOLEAN NOT NULL DEFAULT FALSE,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY(distributor_id,media_type,source_item_id))`);
   await pool.query(`CREATE INDEX IF NOT EXISTS blofy_stream_distributor_issue_recent
     ON blofy_stream_distributor_issues(distributor_id,created_at DESC)`);
  })().catch(e=>{schemaPromise=null;throw e});
  return schemaPromise;
 }
 async function transaction(task){
  const db=await pool.connect();
  try{await db.query('BEGIN');const result=await task(db);await db.query('COMMIT');return result;}
  catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}
  finally{db.release()}
 }
 async function listAdmin(){
  await ensureSchema();
  const rows=(await pool.query(`SELECT * FROM blofy_stream_distributors
    ORDER BY created_at DESC LIMIT 150`)).rows;
  return {ok:true,items:rows.map(publicDistributor)};
 }
 async function createAdmin({name,username,credits=0}={}){
  await ensureSchema();
  const cleanName=clean(name),login=String(username||'').trim().toLowerCase();
  if(cleanName.length<2||!USER.test(login))throw fail('distributor_invalid_name_or_username');
  const initial=number(credits,0,10000,'distributor_credits_invalid');
  const password=crypto.randomBytes(18).toString('base64url');
  const hash=await passwordDigest(password);
  try{
   return await transaction(async db=>{
    const row=(await db.query(`INSERT INTO blofy_stream_distributors
      (id,display_name,username,password_hash,credits)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,
      [crypto.randomUUID(),cleanName,login,hash,initial])).rows[0];
    await db.query(`INSERT INTO blofy_stream_distributor_credit_events
      (id,distributor_id,type,delta,balance_after)
      VALUES($1,$2,'opening',$3,$3)`,[crypto.randomUUID(),row.id,initial]);
    return {ok:true,item:publicDistributor(row),password};
   });
  }catch(e){if(e.code==='23505')throw fail('distributor_username_taken',409);throw e}
 }
 async function setAdmin(id,{credits,enabled,resetPassword,dailyLimit}={}){
  await ensureSchema();if(!UUID.test(String(id||'')))throw fail('distributor_invalid_id');
  if(credits!==undefined){
   const increment=number(credits,-10000,10000,'distributor_credits_invalid');
   if(increment===0)throw fail('distributor_credits_invalid');
   return transaction(async db=>{
    const row=(await db.query(`UPDATE blofy_stream_distributors SET credits=credits+$2
      WHERE id=$1 AND credits+$2 BETWEEN 0 AND 100000 RETURNING *`,[id,increment])).rows[0];
    if(!row)throw fail('distributor_missing_or_insufficient_credits',409);
    await db.query(`INSERT INTO blofy_stream_distributor_credit_events
      (id,distributor_id,type,delta,balance_after)
      VALUES($1,$2,'adjustment',$3,$4)`,
      [crypto.randomUUID(),id,increment,Number(row.credits)]);
    return {ok:true,item:publicDistributor(row)};
   });
  }
  if(dailyLimit!==undefined){
   const limit=number(dailyLimit,1,10000,'distributor_limit_invalid');
   const row=(await pool.query(`UPDATE blofy_stream_distributors
     SET daily_issue_limit=$2 WHERE id=$1 RETURNING *`,[id,limit])).rows[0];
   if(!row)throw fail('distributor_missing',404);
   return {ok:true,item:publicDistributor(row)};
  }
  if(typeof enabled==='boolean'){
   return transaction(async db=>{
    const row=(await db.query(`UPDATE blofy_stream_distributors SET enabled=$2
      WHERE id=$1 RETURNING *`,[id,enabled])).rows[0];
    if(!row)throw fail('distributor_missing',404);
    if(!enabled)await db.query(
      'DELETE FROM blofy_stream_distributor_sessions WHERE distributor_id=$1',[id]);
    return {ok:true,item:publicDistributor(row)};
   });
  }
  if(resetPassword===true){
   const password=crypto.randomBytes(18).toString('base64url');
   const hash=await passwordDigest(password);
   return transaction(async db=>{
    const row=(await db.query(`UPDATE blofy_stream_distributors
      SET password_hash=$2 WHERE id=$1 RETURNING *`,[id,hash])).rows[0];
    if(!row)throw fail('distributor_missing',404);
    await db.query('DELETE FROM blofy_stream_distributor_sessions WHERE distributor_id=$1',[id]);
    return {ok:true,item:publicDistributor(row),password};
   });
  }
  throw fail('distributor_action_invalid');
 }
 async function login({username,password}={}){
  await ensureSchema();
  const login=String(username||'').trim().toLowerCase();
  const supplied=String(password||'');
  if(!USER.test(login)||supplied.length<12||supplied.length>200)
   throw fail('distributor_login_failed',401);
  const row=(await pool.query('SELECT * FROM blofy_stream_distributors WHERE username=$1',[login])).rows[0];
  // Expensive verification even for absent/disabled accounts limits enumeration.
  const good=await passwordMatches(supplied,row?.password_hash);
  if(!row||!row.enabled||!good)throw fail('distributor_login_failed',401);
  const token=crypto.randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO blofy_stream_distributor_sessions
    (session_hash,distributor_id,expires_at) VALUES($1,$2,$3)`,
    [digest(token),row.id,new Date(clock()+SESSION_MS)]);
  return {ok:true,token,expiresIn:SESSION_MS/1000,item:publicDistributor(row)};
 }
 async function session(token){
  await ensureSchema();
  if(!TOKEN.test(String(token||'')))throw fail('distributor_unauthorized',401);
  const row=(await pool.query(`SELECT d.* FROM blofy_stream_distributor_sessions s
    JOIN blofy_stream_distributors d ON d.id=s.distributor_id
    WHERE s.session_hash=$1 AND s.expires_at>NOW() AND d.enabled=TRUE`,
    [digest(token)])).rows[0];
  if(!row)throw fail('distributor_session_expired',401);
  return row;
 }
 async function me(token){
  const row=await session(token);
  return {ok:true,item:publicDistributor(row)};
 }
 async function logout(token){
  if(TOKEN.test(String(token||'')))
   await pool.query('DELETE FROM blofy_stream_distributor_sessions WHERE session_hash=$1',[digest(token)]);
  return {ok:true};
 }


 // Merchant login passwords are salted scrypt hashes; never recoverable.
 // A change revokes OTHER active sessions, not the current verified session.
 async function changePassword(token,{currentPassword,newPassword}={}){
  const actor=await session(token);
  const current=String(currentPassword||''),next=String(newPassword||'');
  if(next.length<14||next.length>128||
    !/^[!-~]+$/.test(next)||
    !/[a-z]/.test(next)||!/[A-Z]/.test(next)||!/[0-9]/.test(next))
    throw fail('distributor_password_strength_invalid',400);
  if(current===next)throw fail('distributor_password_reused',400);
  return transaction(async db=>{
    const row=(await db.query('SELECT * FROM blofy_stream_distributors WHERE id=$1 FOR UPDATE',
      [actor.id])).rows?.[0];
    if(!row||row.enabled!==true||
       !await passwordMatches(current,row.password_hash))
      throw fail('distributor_password_current_invalid',403);
    const hash=await passwordDigest(next);
    await db.query('UPDATE blofy_stream_distributors SET password_hash=$2 WHERE id=$1',
      [actor.id,hash]);
    await db.query('DELETE FROM blofy_stream_distributor_sessions WHERE distributor_id=$1 AND session_hash<>$2',
      [actor.id,digest(token)]);
    return {ok:true,changed:true,otherSessionsRevoked:true};
  });
 }
 // Generates fresh secure Xtream username/password for a purchased OWNED
 // account only, never the upstream provider credentials. Existing expiry,
 // account ID and channel rights remain untouched; old login becomes invalid.
 async function rotateOwnedXtream(token,{issueId,requestId,acknowledgeDisconnect}={}){
  const actor=await session(token);
  if(!UUID.test(String(issueId||''))||!UUID.test(String(requestId||'')))
    throw fail('distributor_rotation_id_invalid',400);
  if(acknowledgeDisconnect!==true)
    throw fail('distributor_rotation_requires_confirmation',400);
  if(typeof rotateXtream!=='function')throw fail('distributor_rotation_unavailable',503);
  return transaction(async db=>{
    const row=(await db.query(`SELECT * FROM blofy_stream_distributor_issues
      WHERE id=$1 AND distributor_id=$2 FOR UPDATE`,[issueId,actor.id])).rows?.[0];
    if(!row)throw fail('distributor_issue_missing',404);
    if(row.kind!=='xtream'||row.status!=='done'||!UUID.test(String(row.subject_id||'')))
      throw fail('distributor_rotation_not_eligible',409);
    if(String(row.credential_rotation_request_id||'')===requestId){
      const existing=await revealXtream(row.subject_id);
      if(existing.status!==200||!existing.body?.credentials)
        throw fail('distributor_reveal_unavailable',503);
      return {ok:true,credentials:existing.body.credentials,
        repeated:true,subscriptionUnchanged:true,oldCredentialsDisabled:true};
    }
    if(row.last_credential_rotation_at&&
      clock()-new Date(row.last_credential_rotation_at).getTime()<15*60*1000)
      throw fail('distributor_rotation_cooldown',429);
    const rotated=await rotateXtream(row.subject_id);
    if(rotated.status!==200||!rotated.body?.credentials)
      throw fail('distributor_rotation_unavailable',503);
    await db.query(`UPDATE blofy_stream_distributor_issues
      SET last_credential_rotation_at=NOW(),credential_rotation_request_id=$3
      WHERE id=$1 AND distributor_id=$2`,[row.id,actor.id,requestId]);
    return {ok:true,credentials:rotated.body.credentials,
      subscriptionUnchanged:true,oldCredentialsDisabled:true,repeated:false};
  });
 }
 const issueProjection=`SELECT i.*,
   EXISTS(SELECT 1 FROM blofy_stream_distributor_actions da
     WHERE da.distributor_id=i.distributor_id AND da.issue_id=i.id
     AND da.action='renew') AS has_renewal,
   c.code_hint,
   (SELECT MAX(da.created_at) FROM blofy_stream_distributor_actions da
     WHERE da.issue_id=i.id AND da.distributor_id=i.distributor_id
       AND da.action='relogin') AS last_relogin_at,
   c.redeemed_at AS code_activated_at,
   c.revoked_at AS code_revoked_at,
   (c.redeemed_device_hash IS NOT NULL) AS code_bound,
   c.admin_relogin_count,
   c.admin_relogin_until,
   a.enabled AS account_enabled,
   a.username AS account_username,
   COALESCE(c.expires_at,a.expires_at) AS subscription_expires_at
   FROM blofy_stream_distributor_issues i
   LEFT JOIN blofy_xtream_gateway_duration_codes c
     ON i.kind='app' AND c.id=i.subject_id
   LEFT JOIN blofy_xtream_gateway_accounts a
     ON a.id=CASE WHEN i.kind='app' THEN c.account_id ELSE i.subject_id END`;
 async function issued(token,{q='',offset=0,status='all'}={}){
  const actor=await session(token);
  const term=clean(q,80).toLowerCase();
  const page=number(offset,0,10000,'distributor_offset_invalid');
  const filter=['all','active','expiring','expired','unused','disabled'].includes(status)
    ?status:'all';
  const rows=(await pool.query(issueProjection+`
   WHERE i.distributor_id=$1 AND (
     $2::text='' OR i.label ILIKE '%'||$2||'%' OR
     i.customer_name ILIKE '%'||$2||'%' OR
     i.customer_phone ILIKE '%'||$2||'%' OR
     c.code_hint ILIKE '%'||$2||'%' OR
     a.username ILIKE '%'||$2||'%')
   AND (
     $4::text='all' OR
     ($4='active' AND i.status='done' AND a.enabled=TRUE
       AND (i.kind='xtream' OR c.redeemed_at IS NOT NULL)
       AND a.expires_at>NOW()+INTERVAL '7 days'
       AND c.revoked_at IS NULL) OR
     ($4='expiring' AND i.status='done' AND a.enabled=TRUE
       AND (i.kind='xtream' OR c.redeemed_at IS NOT NULL)
       AND a.expires_at>NOW() AND a.expires_at<=NOW()+INTERVAL '7 days'
       AND c.revoked_at IS NULL) OR
     ($4='expired' AND i.status='done' AND a.expires_at<=NOW()) OR
     ($4='unused' AND i.status='done' AND i.kind='app'
       AND c.redeemed_at IS NULL AND c.revoked_at IS NULL) OR
     ($4='disabled' AND i.status='done'
       AND (a.enabled=FALSE OR c.revoked_at IS NOT NULL))
   )
   ORDER BY i.created_at DESC LIMIT 101 OFFSET $3`,
   [actor.id,term,page,filter])).rows;
  const stats=(await pool.query(`
   SELECT COUNT(*) FILTER (WHERE i.status='done')::int AS total,
    COUNT(*) FILTER (WHERE i.status='done'
      AND a.enabled=TRUE AND
      (i.kind='xtream' OR c.redeemed_at IS NOT NULL)
      AND a.expires_at>NOW() AND
      (c.revoked_at IS NULL))::int AS active,
    COUNT(*) FILTER (WHERE i.status='done'
      AND a.enabled=TRUE AND a.expires_at>NOW() AND
      a.expires_at<=NOW()+INTERVAL '7 days'
      AND (i.kind='xtream' OR c.redeemed_at IS NOT NULL))::int AS expiring,
    COUNT(*) FILTER (WHERE i.status='done'
      AND a.expires_at<=NOW())::int AS expired,
    COUNT(DISTINCT NULLIF(i.customer_phone,''))::int AS customers
   FROM blofy_stream_distributor_issues i
   LEFT JOIN blofy_xtream_gateway_duration_codes c
     ON i.kind='app' AND c.id=i.subject_id
   LEFT JOIN blofy_xtream_gateway_accounts a
     ON a.id=CASE WHEN i.kind='app' THEN c.account_id ELSE i.subject_id END
   WHERE i.distributor_id=$1`,[actor.id])).rows[0]||{};
  return {ok:true,items:rows.slice(0,100).map(publicIssue),
    nextOffset:rows.length>100?page+100:null,
    stats:{total:Number(stats.total||0),active:Number(stats.active||0),
      expiring:Number(stats.expiring||0),expired:Number(stats.expired||0),
      customers:Number(stats.customers||0)}};
 }


 async function activity(token,{offset=0}={}){
  const actor=await session(token);
  const page=number(offset,0,10000,'distributor_offset_invalid');
  const rows=(await pool.query(`SELECT id,issue_id,type,delta,balance_after,details,created_at
    FROM blofy_stream_distributor_credit_events WHERE distributor_id=$1
    UNION ALL
    SELECT id,issue_id,'relogin'::text AS type,0::integer AS delta,
      NULL::integer AS balance_after,result AS details,created_at
    FROM blofy_stream_distributor_actions
    WHERE distributor_id=$1 AND action='relogin'
    ORDER BY created_at DESC,id DESC LIMIT 101 OFFSET $2`,
    [actor.id,page])).rows;
  return {ok:true,items:rows.slice(0,100).map(x=>({
    id:x.id,issueId:x.issue_id,type:x.type,delta:Number(x.delta),
    balanceAfter:x.balance_after==null?null:Number(x.balance_after),
    details:x.details||{},
    date:new Date(x.created_at).getTime()
  })),nextOffset:rows.length>100?page+100:null};
 }
 async function analytics(token){
  const actor=await session(token);
  const row=(await pool.query(`SELECT
    COUNT(*) FILTER (WHERE status='done' AND created_at>=((NOW() AT TIME ZONE 'Asia/Riyadh')::date AT TIME ZONE 'Asia/Riyadh'))::int AS today,
    COUNT(*) FILTER (WHERE status='done' AND created_at>=DATE_TRUNC('month',NOW()))::int AS month,
    COUNT(*) FILTER (WHERE duration_days=1 AND status='done'
      AND created_at>=((NOW() AT TIME ZONE 'Asia/Riyadh')::date AT TIME ZONE 'Asia/Riyadh'))::int AS trials_today,
    COUNT(*) FILTER (WHERE duration_days=1 AND status='done')::int AS trials_total,
    COUNT(*) FILTER (WHERE duration_days>1 AND status='done')::int AS paid_total,
    COALESCE(SUM(credit_cost) FILTER (WHERE status='done'
      AND created_at>=DATE_TRUNC('month',NOW())),0)::int AS spent_month,
    COUNT(*) FILTER (WHERE status IN ('pending','review'))::int AS under_review
    FROM blofy_stream_distributor_issues WHERE distributor_id=$1`,
    [actor.id])).rows[0]||{};
  const extended=(await pool.query(`SELECT COUNT(*)::int AS renewals,
    COALESCE(SUM(credit_cost),0)::int AS credits
    FROM blofy_stream_distributor_actions
    WHERE distributor_id=$1 AND action='renew'
      AND created_at>=DATE_TRUNC('month',NOW())`,
    [actor.id])).rows[0]||{};
  const converted=(await pool.query(`SELECT COUNT(DISTINCT i.id)::int AS converted
    FROM blofy_stream_distributor_issues i
    JOIN blofy_stream_distributor_actions a
      ON a.issue_id=i.id AND a.distributor_id=i.distributor_id AND a.action='renew'
    WHERE i.distributor_id=$1 AND i.duration_days=1`,[actor.id])).rows[0]||{};
  const topPlan=(await pool.query(`SELECT duration_days,COUNT(*)::int AS sold_count
    FROM blofy_stream_distributor_issues
    WHERE distributor_id=$1 AND status='done'
    GROUP BY duration_days ORDER BY sold_count DESC,duration_days ASC LIMIT 1`,
    [actor.id])).rows[0]||{};
  const issued24h=(await pool.query(`SELECT COUNT(*)::int AS count
    FROM blofy_stream_distributor_issues WHERE distributor_id=$1
      AND created_at>NOW()-INTERVAL '24 hours'
      AND status IN ('pending','done','review')`,[actor.id])).rows[0]||{};
  return {ok:true,stats:{
    today:Number(row.today||0),month:Number(row.month||0),
    trialsToday:Number(row.trials_today||0),trialsTotal:Number(row.trials_total||0),
    paidTotal:Number(row.paid_total||0),spentMonth:Number(row.spent_month||0),
    pendingReview:Number(row.under_review||0),
    renewalsMonth:Number(extended.renewals||0),
    renewedCreditsMonth:Number(extended.credits||0),
    convertedTrials:Number(converted.converted||0),
    issued24h:Number(issued24h.count||0),
    dailyLimit:Number(actor.daily_issue_limit||100),
    topPlanDays:topPlan.duration_days==null?null:Number(topPlan.duration_days)
  }};
 }
 async function exportIssues(token,{offset=0}={}){
  const actor=await session(token);
  const page=number(offset,0,1900,'distributor_offset_invalid');
  const records=(await pool.query(issueProjection+`
    WHERE i.distributor_id=$1 ORDER BY i.created_at DESC LIMIT 101 OFFSET $2`,
    [actor.id,page])).rows;
  return {ok:true,items:records.slice(0,100).map(publicIssue),
    nextOffset:records.length>100&&page+100<2000?page+100:null,
    capped:records.length>100&&page+100>=2000};
 }
 async function clients(token,{q=''}={}){
  const actor=await session(token),term=clean(q,80);
  const rows=(await pool.query(`SELECT (ARRAY_AGG(customer_phone ORDER BY created_at DESC))[1] AS customer_phone,
    (ARRAY_AGG(customer_name ORDER BY created_at DESC))[1] AS customer_name,
    COUNT(*)::int AS subscriptions,
    MAX(created_at) AS latest
    FROM blofy_stream_distributor_issues
    WHERE distributor_id=$1 AND status='done'
      AND (customer_phone<>'' OR customer_name<>'')
      AND ($2::text='' OR customer_phone ILIKE '%'||$2||'%'
        OR customer_name ILIKE '%'||$2||'%')
    GROUP BY COALESCE(NULLIF(customer_phone,''),'name:'||lower(customer_name))
    ORDER BY MAX(created_at) DESC LIMIT 100`,[actor.id,term])).rows;
  return {ok:true,items:rows.map(x=>({
    name:String(x.customer_name||'').slice(0,80),
    phone:String(x.customer_phone||'').slice(0,22),
    subscriptions:Number(x.subscriptions||0),
    latest:new Date(x.latest).getTime()
  }))};
 }
 async function showOwned(distributorId,issueId){
  if(!UUID.test(String(issueId||'')))throw fail('distributor_issue_id_invalid');
  const row=(await pool.query(`SELECT * FROM blofy_stream_distributor_issues
    WHERE id=$1 AND distributor_id=$2`,[issueId,distributorId])).rows[0];
  if(!row)throw fail('distributor_issue_missing',404);
  return row;
 }
 async function reveal(token,issueId){
  const row=await session(token),item=await showOwned(row.id,issueId);
  if(item.status!=='done'||!item.subject_id)
   throw fail('distributor_issue_not_ready',409);
  const result=item.kind==='app'?await revealCode(item.subject_id):
    await revealXtream(item.subject_id);
  if(result.status!==200||result.body?.ok===false)
   throw fail('distributor_reveal_unavailable',result.status===404?404:503);
  return {ok:true,issue:publicIssue(item),
    ...(item.kind==='app'?{code:result.body.code}:{credentials:result.body.credentials})};
 }
 async function issue(token,{kind,label,durationDays,requestId,trialPhone,customerName,customerPhone}={}){
  const actor=await session(token);
  const type=String(kind||'');
  if(!['app','xtream'].includes(type))throw fail('distributor_type_invalid');
  const days=number(durationDays,1,365,'distributor_days_invalid');
  const cost=distributorPlanCost(days);
  // One free trial per customer across resellers; no raw customer phone stored.
  // Normalize Saudi local/international forms to the same anonymous proof.
  // Otherwise 05... and +9665... would bypass one-trial-per-customer.
  let phone=String(trialPhone||'').replace(/[^0-9]/g,'');
  if(phone.startsWith('00'))phone=phone.slice(2);
  if(/^05[0-9]{8}$/.test(phone))phone='966'+phone.slice(1);
  else if(/^5[0-9]{8}$/.test(phone))phone='966'+phone;
  if(cost===0&&!/^[0-9]{8,15}$/.test(phone))throw fail('distributor_trial_phone_required');
  const trialHash=cost===0?crypto.createHmac('sha256',Buffer.from(trialKeyHex,'hex'))
    .update('blofy-stream-distributor-trial-phone:v1:'+phone).digest('hex'):null;
  // Distributors always issue one connection. A stale/forged client cannot override it.
  const connections=1;
  const request=String(requestId||'').toLowerCase();
  if(!UUID.test(request))throw fail('distributor_request_id_invalid');
  const safeLabel=clean(label,80)||'BLOFY STREAM';
  const contactName=clean(customerName,80);
  const contactPhone=normalizedPhone(customerPhone|| (cost===0?phone:''));
  if(cost===0&&contactPhone!==phone)throw fail('distributor_trial_phone_locked',409);
  // Resolve by exact name at issuance; never silently switch to XTREAM 2.
  const saleh=await salehSource();
  const reservation=await transaction(async db=>{
   const current=(await db.query(
     'SELECT * FROM blofy_stream_distributors WHERE id=$1 FOR UPDATE',[actor.id])).rows[0];
   if(!current?.enabled)throw fail('distributor_disabled',403);
   const existing=(await db.query(`SELECT * FROM blofy_stream_distributor_issues
     WHERE distributor_id=$1 AND request_id=$2`,[actor.id,request])).rows[0];
   if(existing)return {existing};
   if(Number(current.credits)<cost)throw fail('distributor_no_credits',409);
   if(cost===0){
    const previous=(await db.query(`SELECT id FROM blofy_stream_distributor_issues
      WHERE trial_customer_hash=$1 AND status IN ('pending','done','review') LIMIT 1`,
      [trialHash])).rows;
    if(previous.length)throw fail('distributor_trial_already_used',409);
    const daily=(await db.query(`SELECT COUNT(*)::int AS count
      FROM blofy_stream_distributor_issues WHERE distributor_id=$1
        AND duration_days=1 AND status IN ('pending','done','review')
        AND created_at > NOW()-INTERVAL '24 hours'`,[actor.id])).rows[0];
    if(Number(daily?.count||0)>=TRIALS_PER_24H)
      throw fail('distributor_trial_daily_limit',429);
   }
   const quota=(await db.query(`SELECT COUNT(*)::int AS count
     FROM blofy_stream_distributor_issues WHERE distributor_id=$1
     AND created_at>NOW()-INTERVAL '24 hours'
     AND status IN ('pending','done','review')`,[actor.id])).rows[0];
   if(Number(quota?.count||0)>=Number(current.daily_issue_limit||100))
     throw fail('distributor_issue_daily_limit',429);
   if(cost>0)await db.query(
     'UPDATE blofy_stream_distributors SET credits=credits-$2 WHERE id=$1',[actor.id,cost]);
   const created=(await db.query(`INSERT INTO blofy_stream_distributor_issues
     (id,distributor_id,request_id,kind,label,duration_days,max_connections,
       credit_cost,trial_customer_hash,customer_name,customer_phone)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
     [crypto.randomUUID(),actor.id,request,type,safeLabel,days,connections,cost,
       trialHash,contactName,contactPhone])).rows[0];
   if(cost>0)await db.query(`INSERT INTO blofy_stream_distributor_credit_events
     (id,distributor_id,issue_id,type,delta,balance_after,details)
     VALUES($1,$2,$3,'issue',$4,$5,$6::jsonb)`,
     [crypto.randomUUID(),actor.id,created.id,-cost,Number(current.credits)-cost,
       JSON.stringify({kind:type,days})]);
   return {created};
  });
  if(reservation.existing){
   if(reservation.existing.status==='done')return reveal(token,reservation.existing.id);
   throw fail('distributor_request_already_processing',409);
  }
  const record=reservation.created;
  let result;
  try{
   result=type==='app'?await issueCode({
     channel:'app',label:safeLabel,durationDays:days,
     quantity:1,maxConnections:connections,sourceId:saleh.id
   }):await issueXtream({
     label:safeLabel,maxConnections:connections,
     sourceId:saleh.id,expiresAt:new Date(clock()+days*DAY).toISOString()
   });
  }catch{result={status:503,body:{ok:false}}}
  const subject=type==='app'?result.body?.items?.[0]:result.body?.item;
  if(result.status===201&&subject?.id){
   await transaction(async db=>{
    await db.query(`UPDATE blofy_stream_distributor_issues
      SET status='done',subject_id=$2 WHERE id=$1`,[record.id,subject.id]);
    await db.query(`UPDATE blofy_stream_distributors
      SET issued_count=issued_count+1 WHERE id=$1`,[actor.id]);
   });
   return {ok:true,issue:{...publicIssue(record),status:'done',accountId:subject.id},
     ...(type==='app'?{code:subject.code}:{credentials:result.body.credentials})};
  }
  const definite=result.status>=400&&result.status<500;
  await transaction(async db=>{
   await db.query('UPDATE blofy_stream_distributor_issues SET status=$2 WHERE id=$1',
     [record.id,definite?'failed':'review']);
   if(definite&&cost>0){
    const row=(await db.query(`UPDATE blofy_stream_distributors
     SET credits=credits+$2 WHERE id=$1 RETURNING credits`,[actor.id,cost])).rows[0];
    await db.query(`INSERT INTO blofy_stream_distributor_credit_events
      (id,distributor_id,issue_id,type,delta,balance_after)
      VALUES($1,$2,$3,'refund',$4,$5)`,
      [crypto.randomUUID(),actor.id,record.id,cost,Number(row.credits)]);
   }
  });
  // When an upstream result is ambiguous, do NOT retry or refund automatically:
  // the account might have been created. The owner can reconcile manually.
  throw fail(definite?'distributor_issuance_rejected':'distributor_issuance_needs_review',
    definite?409:503);
 }


 function normalizedPhone(value){
  let s=String(value||'').replace(/[^0-9]/g,'');
  if(s.startsWith('00'))s=s.slice(2);
  if(/^05[0-9]{8}$/.test(s))s='966'+s.slice(1);
  else if(/^5[0-9]{8}$/.test(s))s='966'+s;
  if(s&&!/^[0-9]{8,15}$/.test(s))throw fail('distributor_customer_phone_invalid');
  return s;
 }
 // Update contacts only for an issuance owned by the logged-in distributor.
 // Trial fingerprint remains fixed so editing clients cannot bypass limits.
 async function customer(token,{issueId,name='',phone=''}={}){
  const actor=await session(token);
  if(!UUID.test(String(issueId||'')))throw fail('distributor_issue_id_invalid');
  const newName=clean(name,80),newPhone=normalizedPhone(phone);
  return transaction(async db=>{
   const issue=(await db.query(`SELECT * FROM blofy_stream_distributor_issues
     WHERE id=$1 AND distributor_id=$2 FOR UPDATE`,[issueId,actor.id])).rows[0];
   if(!issue)throw fail('distributor_issue_missing',404);
   if(issue.duration_days===1&&issue.trial_customer_hash){
    const hash=crypto.createHmac('sha256',Buffer.from(trialKeyHex,'hex'))
      .update('blofy-stream-distributor-trial-phone:v1:'+newPhone).digest('hex');
    if(hash!==issue.trial_customer_hash)throw fail('distributor_trial_phone_locked',409);
   }
   const updated=(await db.query(`UPDATE blofy_stream_distributor_issues
     SET customer_name=$3,customer_phone=$4 WHERE id=$1 AND distributor_id=$2
     RETURNING *`,[issueId,actor.id,newName,newPhone])).rows[0];
   return {ok:true,issueId:updated.id,customerName:updated.customer_name,
     customerPhone:updated.customer_phone};
  });
 }
 // Renew a redeemed code or direct Xtream account, debiting months atomically
 // with the expiry update. Ownership and the original saleh binding are checked
 // on the server, never trusted from the browser.
 async function renew(token,{issueId,days,requestId}={}){
  const actor=await session(token),cost=distributorPlanCost(days);
  if(cost<=0)throw fail('distributor_renew_trial_denied',400);
  if(!UUID.test(String(issueId||''))||!UUID.test(String(requestId||'')))
    throw fail('distributor_request_id_invalid');
  const saleh=await salehSource();
  return transaction(async db=>{
   const distributor=(await db.query(`SELECT * FROM blofy_stream_distributors
     WHERE id=$1 FOR UPDATE`,[actor.id])).rows[0];
   if(!distributor?.enabled)throw fail('distributor_disabled',403);
   const existing=(await db.query(`SELECT * FROM blofy_stream_distributor_actions
     WHERE distributor_id=$1 AND request_id=$2`,[actor.id,requestId])).rows[0];
   if(existing){
    if(existing.issue_id!==issueId||existing.action!=='renew')
      throw fail('distributor_request_conflict',409);
    return {ok:true,...existing.result,repeated:true};
   }
   if(Number(distributor.credits)<cost)throw fail('distributor_no_credits',409);
   const owned=(await db.query(`SELECT * FROM blofy_stream_distributor_issues
     WHERE id=$1 AND distributor_id=$2 AND status='done' FOR UPDATE`,
     [issueId,actor.id])).rows[0];
   if(!owned||!UUID.test(String(owned.subject_id||'')))
     throw fail('distributor_issue_missing',404);
   let code=null;
   if(owned.kind==='app'){
    code=(await db.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
      WHERE id=$1 FOR UPDATE`,[owned.subject_id])).rows[0];
    if(!code||!code.redeemed_at||!code.account_id||code.revoked_at)
      throw fail('distributor_renew_code_not_active',409);
   }
   const accountId=code?.account_id||owned.subject_id;
   const account=(await db.query(`SELECT * FROM blofy_xtream_gateway_accounts
     WHERE id=$1 FOR UPDATE`,[accountId])).rows[0];
   if(!account||account.enabled!==true||account.source_id!==saleh.id)
     throw fail('distributor_renew_account_unavailable',409);
   const baseline=Math.max(clock(),new Date(account.expires_at).getTime(),
     code?new Date(code.expires_at).getTime():0);
   const next=new Date(baseline+Number(days)*DAY);
   if(!Number.isFinite(next.getTime()))throw fail('distributor_renew_invalid',409);
   await db.query(`UPDATE blofy_xtream_gateway_accounts
     SET expires_at=$2,updated_at=NOW() WHERE id=$1`,[accountId,next]);
   if(code){
    await db.query(`UPDATE blofy_xtream_gateway_duration_codes
     SET expires_at=$2,extended_days=extended_days+$3 WHERE id=$1`,
     [code.id,next,days]);
    await db.query(`INSERT INTO blofy_xtream_gateway_code_events
      (id,code_id,event_type,details) VALUES($1,$2,'extended',$3::jsonb)`,
      [crypto.randomUUID(),code.id,JSON.stringify({
        days,via:'distributor',distributorId:actor.id})]);
   }
   await db.query(`UPDATE blofy_stream_distributors
     SET credits=credits-$2 WHERE id=$1`,[actor.id,cost]);
   await db.query(`INSERT INTO blofy_stream_distributor_credit_events
     (id,distributor_id,issue_id,type,delta,balance_after,details)
     VALUES($1,$2,$3,'renew',$4,$5,$6::jsonb)`,
     [crypto.randomUUID(),actor.id,issueId,-cost,Number(distributor.credits)-cost,
       JSON.stringify({days})]);
   const result={issueId,expiresAt:next.getTime(),chargedCredits:cost};
   await db.query(`INSERT INTO blofy_stream_distributor_actions
     (id,distributor_id,issue_id,request_id,action,credit_cost,result)
     VALUES($1,$2,$3,$4,'renew',$5,$6::jsonb)`,
     [crypto.randomUUID(),actor.id,issueId,requestId,cost,JSON.stringify(result)]);
   return {ok:true,...result};
  });
 }
 // Admin-approved re-entry for an owned active app code only, without
 // rotating the voucher or changing the subscription expiry. The next
 // different device has ten minutes to claim a single new binding.
 async function relogin(token,{issueId,requestId}={}){
  const actor=await session(token);
  if(!UUID.test(String(issueId||''))||!UUID.test(String(requestId||'')))
    throw fail('distributor_request_id_invalid');
  const saleh=await salehSource();
  return transaction(async db=>{
   const distributor=(await db.query(`SELECT * FROM blofy_stream_distributors
     WHERE id=$1 FOR UPDATE`,[actor.id])).rows[0];
   if(!distributor?.enabled)throw fail('distributor_disabled',403);
   const existing=(await db.query(`SELECT * FROM blofy_stream_distributor_actions
     WHERE distributor_id=$1 AND request_id=$2`,[actor.id,requestId])).rows[0];
   if(existing){
    if(existing.issue_id!==issueId||existing.action!=='relogin')
      throw fail('distributor_request_conflict',409);
    return {ok:true,...existing.result,repeated:true};
   }
   const owned=(await db.query(`SELECT * FROM blofy_stream_distributor_issues
     WHERE id=$1 AND distributor_id=$2 AND kind='app' AND status='done'
       FOR UPDATE`,[issueId,actor.id])).rows[0];
   if(!owned)throw fail('distributor_issue_missing',404);
   const code=(await db.query(`SELECT * FROM blofy_xtream_gateway_duration_codes
     WHERE id=$1 FOR UPDATE`,[owned.subject_id])).rows[0];
   if(!code||code.code_channel!=='app'||!code.redeemed_at||!code.account_id||
      !code.redeemed_device_hash||code.revoked_at||
      new Date(code.expires_at).getTime()<=clock())
      throw fail('distributor_relogin_unavailable',409);
   const account=(await db.query(`SELECT * FROM blofy_xtream_gateway_accounts
      WHERE id=$1 FOR UPDATE`,[code.account_id])).rows[0];
   if(!account||!account.enabled||account.source_id!==saleh.id||
      new Date(account.expires_at).getTime()<=clock())
      throw fail('distributor_relogin_unavailable',409);
   const until=new Date(clock()+10*60*1000);
   await db.query(`UPDATE blofy_xtream_gateway_duration_codes
     SET admin_relogin_until=$2,
       relogin_device_hash=NULL,relogin_request_hash=NULL,
       relogin_requested_at=NULL,relogin_approved_at=NULL,
       relogin_expires_at=NULL WHERE id=$1`,[code.id,until]);
   await db.query(`INSERT INTO blofy_xtream_gateway_code_events
     (id,code_id,event_type,details) VALUES($1,$2,$3,$4::jsonb)`,
     [crypto.randomUUID(),code.id,'same_code_admin_relogin_granted',
      JSON.stringify({via:'distributor',distributorId:actor.id,oneTime:true,validMinutes:10})]);
   const result={issueId,allowedUntil:until.getTime(),sameCode:true,oneTime:true};
   await db.query(`INSERT INTO blofy_stream_distributor_actions
     (id,distributor_id,issue_id,request_id,action,credit_cost,result)
     VALUES($1,$2,$3,$4,'relogin',0,$5::jsonb)`,
     [crypto.randomUUID(),actor.id,issueId,requestId,JSON.stringify(result)]);
   return {ok:true,...result};
  });
 }
 // Fail closed. The source must be exactly 'saleh', enabled, published and
 // unique. Never issue on XTREAM 2 or fallback to all sources.
 async function salehSource(){
  const r=await pool.query(`SELECT id,name FROM blofy_xtream_servers
    WHERE lower(btrim(name))='saleh' AND enabled=TRUE AND publish_catalog=TRUE
      AND deletion_requested_at IS NULL LIMIT 2`);
  if(r.rows?.length!==1)throw fail('distributor_saleh_source_unavailable',409);
  return r.rows[0];
 }
 const mediaType=x=>{
  if(!['live','movie','series'].includes(x))throw fail('distributor_library_type_invalid');
  return x;
 };
 const mediaId=x=>{
  if(!/^[A-Za-z0-9._-]{1,128}$/.test(String(x||'')))
   throw fail('distributor_library_item_invalid');
  return String(x);
 };

 async function libraryCategories(token,{type='movie'}={}){
  await session(token);const source=await salehSource(),kind=mediaType(type);
  const [categories,count]=await Promise.all([
   pool.query(`SELECT source_category_id,name FROM blofy_xtream_categories
     WHERE server_id=$1 AND media_type=$2 AND enabled=TRUE
     ORDER BY sort_order NULLS LAST,name ASC LIMIT 500`,[source.id,kind]),
   pool.query(`SELECT COUNT(*)::int AS total FROM blofy_xtream_items
     WHERE server_id=$1 AND media_type=$2 AND enabled=TRUE`,[source.id,kind])
  ]);
  return {ok:true,sourceName:'saleh',type:kind,
   total:Number(count.rows?.[0]?.total||0),
   categories:(categories.rows||[]).map(row=>({
     id:String(row.source_category_id||'').slice(0,128),
     name:clean(row.name,100)})),
   scope:'distributor_only'};
 }
 // Catalog organization is a reseller-specific overlay, not a mutation of
 // the shared source or of what other resellers/customers see.
 async function library(token,{type='movie',q='',offset=0,categoryId=''}={}){
  const actor=await session(token),source=await salehSource(),kind=mediaType(type);
  const page=number(offset,0,500000,'distributor_library_offset_invalid');
  const selectedCategory=categoryId?mediaId(categoryId):'';
  const query=String(q||'').trim().slice(0,85);
  const result=await listCatalog({
    sourceId:source.id,type:kind,q:query,offset:page,limit:48,
    ...(selectedCategory?{categoryId:selectedCategory}:{})
  });
  const items=Array.isArray(result)?result:[];
  const safe=items.map(i=>({
    id:mediaId(i.id),type:kind,name:clean(i.name,220),
    categoryId:String(i.categoryId||'').slice(0,128),
    categoryName:clean(i.categoryName,100),enabled:i.enabled===true
  }));
  const ids=safe.map(x=>x.id);
  if(ids.length){
   const overrides=(await pool.query(`SELECT source_item_id,custom_group,
      custom_title,sort_order,hidden FROM blofy_stream_distributor_library
      WHERE distributor_id=$1 AND media_type=$2 AND source_item_id=ANY($3::text[])`,
     [actor.id,kind,ids])).rows;
   const index=new Map(overrides.map(x=>[x.source_item_id,x]));
   for(const item of safe){
    const o=index.get(item.id);if(!o)continue;
    item.group=o.custom_group;item.title=o.custom_title;
    item.sortOrder=Number(o.sort_order)||0;item.hidden=Boolean(o.hidden);
   }
  }
  return {ok:true,sourceName:'saleh',type:kind,items:safe,
    nextOffset:items.length===48?page+48:null,
    scope:'distributor_only_not_global'};
 }
 async function organize(token,{type,itemId,group,title,sortOrder=0,hidden=false}={}){
  const actor=await session(token),source=await salehSource();
  const kind=mediaType(type),id=mediaId(itemId);
  const category=clean(group,60),customTitle=clean(title,120);
  const sort=number(sortOrder,0,9999,'distributor_library_sort_invalid');
  if(typeof hidden!=='boolean')throw fail('distributor_library_hidden_invalid');
  const matched=(await pool.query(`SELECT source_id FROM blofy_xtream_items
    WHERE server_id=$1 AND media_type=$2 AND source_id=$3 AND enabled=TRUE LIMIT 1`,
    [source.id,kind,id])).rows[0];
  if(!matched)throw fail('distributor_library_item_not_in_saleh',404);
  await pool.query(`INSERT INTO blofy_stream_distributor_library
    (distributor_id,media_type,source_item_id,custom_group,custom_title,sort_order,hidden)
    VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(distributor_id,media_type,source_item_id) DO UPDATE
      SET custom_group=EXCLUDED.custom_group,custom_title=EXCLUDED.custom_title,
        sort_order=EXCLUDED.sort_order,hidden=EXCLUDED.hidden,updated_at=NOW()`,
    [actor.id,kind,id,category,customTitle,sort,hidden]);
  return {ok:true,id,type:kind,group:category,title:customTitle,
    sortOrder:sort,hidden,scope:'distributor_only_not_global'};
 }
 
 // Atomic bounded merchant-specific batch. Validates every eligible item
 // belongs to the active saleh catalog before overlay creation.
 async function organizeBulk(token,{type,itemIds,group,hidden}={}){
  const actor=await session(token),source=await salehSource(),kind=mediaType(type);
  if(!Array.isArray(itemIds)||itemIds.length===0||itemIds.length>100)
   throw fail('distributor_bulk_selection_invalid',400);
  const ids=[...new Set(itemIds.map(mediaId))];
  const setGroup=group!==undefined,setHidden=hidden!==undefined;
  if(!setGroup&&!setHidden)throw fail('distributor_bulk_action_required',400);
  if(setHidden&&typeof hidden!=='boolean')
   throw fail('distributor_library_hidden_invalid',400);
  if(setGroup&&String(group||'').trim().length>60)
   throw fail('distributor_bulk_group_too_long',400);
  const result=await pool.query(`
   WITH eligible AS (
     SELECT DISTINCT source_id FROM blofy_xtream_items
     WHERE server_id=$1 AND media_type=$2 AND enabled=TRUE
       AND source_id=ANY($4::text[])
   )
   INSERT INTO blofy_stream_distributor_library
     (distributor_id,media_type,source_item_id,custom_group,custom_title,sort_order,hidden)
   SELECT $3,$2,e.source_id,
     CASE WHEN $5::boolean THEN $6::text ELSE COALESCE(o.custom_group,'') END,
     COALESCE(o.custom_title,''),COALESCE(o.sort_order,0),
     CASE WHEN $7::boolean THEN $8::boolean ELSE COALESCE(o.hidden,FALSE) END
   FROM eligible e
   LEFT JOIN blofy_stream_distributor_library o
     ON o.distributor_id=$3 AND o.media_type=$2 AND o.source_item_id=e.source_id
   ON CONFLICT(distributor_id,media_type,source_item_id) DO UPDATE
   SET custom_group=CASE WHEN $5::boolean THEN EXCLUDED.custom_group
                        ELSE blofy_stream_distributor_library.custom_group END,
       hidden=CASE WHEN $7::boolean THEN EXCLUDED.hidden
                   ELSE blofy_stream_distributor_library.hidden END,
       updated_at=NOW()
   RETURNING source_item_id
  `,[source.id,kind,actor.id,ids,setGroup,setGroup?clean(group,60):'',
    setHidden,hidden===true]);
  const updated=result.rows?.length||0;
  return {ok:true,updated,requested:ids.length,skipped:ids.length-updated,
   scope:'distributor_only_not_global'};
 }
 return {ensureSchema,listAdmin,createAdmin,setAdmin,login,me,logout,changePassword,rotateOwnedXtream,issued,reveal,issue,library,libraryCategories,organize,organizeBulk,customer,renew,relogin,clients,activity,analytics,exportIssues};
}

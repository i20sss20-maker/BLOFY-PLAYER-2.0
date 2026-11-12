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
 used:Number(row.issued_count||0),createdAt:new Date(row.created_at).getTime()
});
const publicIssue=row=>({
 id:row.id,type:row.kind,label:row.label,days:Number(row.duration_days),
 maxConnections:Number(row.max_connections),
 status:row.status,createdAt:new Date(row.created_at).getTime(),
 accountId:row.status==='done'?row.subject_id:null
});
export function createStreamDistributors({pool,issueCode,issueXtream,revealCode,revealXtream,
  clock=Date.now}={}){
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
   const row=(await pool.query(`INSERT INTO blofy_stream_distributors
     (id,display_name,username,password_hash,credits)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
     [crypto.randomUUID(),cleanName,login,hash,initial])).rows[0];
   return {ok:true,item:publicDistributor(row),password};
  }catch(e){if(e.code==='23505')throw fail('distributor_username_taken',409);throw e}
 }
 async function setAdmin(id,{credits,enabled,resetPassword}={}){
  await ensureSchema();if(!UUID.test(String(id||'')))throw fail('distributor_invalid_id');
  if(credits!==undefined){
   const increment=number(credits,-10000,10000,'distributor_credits_invalid');
   if(increment===0)throw fail('distributor_credits_invalid');
   const row=(await pool.query(`UPDATE blofy_stream_distributors SET credits=credits+$2
     WHERE id=$1 AND credits+$2 BETWEEN 0 AND 100000 RETURNING *`,[id,increment])).rows[0];
   if(!row)throw fail('distributor_missing_or_insufficient_credits',409);
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
 async function issued(token){
  const row=await session(token);
  const results=(await pool.query(`SELECT * FROM blofy_stream_distributor_issues
    WHERE distributor_id=$1 ORDER BY created_at DESC LIMIT 60`,[row.id])).rows;
  return {ok:true,items:results.map(publicIssue)};
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
 async function issue(token,{kind,label,durationDays,maxConnections,requestId}={}){
  const actor=await session(token);
  const type=String(kind||'');
  if(!['app','xtream'].includes(type))throw fail('distributor_type_invalid');
  const days=number(durationDays,1,730,'distributor_days_invalid');
  const connections=number(maxConnections,1,3,'distributor_connections_invalid');
  const request=String(requestId||'').toLowerCase();
  if(!UUID.test(request))throw fail('distributor_request_id_invalid');
  const safeLabel=clean(label,80)||'BLOFY STREAM';
  const reservation=await transaction(async db=>{
   const current=(await db.query(
     'SELECT * FROM blofy_stream_distributors WHERE id=$1 FOR UPDATE',[actor.id])).rows[0];
   if(!current?.enabled)throw fail('distributor_disabled',403);
   const existing=(await db.query(`SELECT * FROM blofy_stream_distributor_issues
     WHERE distributor_id=$1 AND request_id=$2`,[actor.id,request])).rows[0];
   if(existing)return {existing};
   if(Number(current.credits)<1)throw fail('distributor_no_credits',409);
   await db.query('UPDATE blofy_stream_distributors SET credits=credits-1 WHERE id=$1',[actor.id]);
   const created=(await db.query(`INSERT INTO blofy_stream_distributor_issues
     (id,distributor_id,request_id,kind,label,duration_days,max_connections)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
     [crypto.randomUUID(),actor.id,request,type,safeLabel,days,connections])).rows[0];
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
     quantity:1,maxConnections:connections,sourceId:null
   }):await issueXtream({
     label:safeLabel,maxConnections:connections,
     sourceId:null,expiresAt:new Date(clock()+days*DAY).toISOString()
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
   if(definite)await db.query(
     'UPDATE blofy_stream_distributors SET credits=credits+1 WHERE id=$1',[actor.id]);
  });
  // When an upstream result is ambiguous, do NOT retry or refund automatically:
  // the account might have been created. The owner can reconcile manually.
  throw fail(definite?'distributor_issuance_rejected':'distributor_issuance_needs_review',
    definite?409:503);
 }
 return {ensureSchema,listAdmin,createAdmin,setAdmin,login,me,logout,issued,reveal,issue};
}

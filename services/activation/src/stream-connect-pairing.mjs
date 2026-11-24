import {SHARED_CODE_LOCK_SQL,unifiedNamespaceEnabled,conflictsWithPaid} from './stream-code-namespace.mjs';
// External-provider pairing is independent of all BLOFY subscription/account tables.
// No server-side request is ever made to a submitted host. The compatible app
// must validate the provider and subscription directly on the user's device.
import crypto from 'node:crypto';
import net from 'node:net';
const TTL_MS=15*60*1000;
const CODE=/^BC-[A-Za-z0-9_-]{24}$/;
const NUMERIC=/^(?:[0-9]{8}|[0-9]{12})$/;
const SHORT=/^[0-9]{8}$/;
const error=(code,status=400)=>Object.assign(Error(code),{status});
export function normalizeConnectInput(input={}){
 const {host,username,password}=input||{};
 if(typeof host!=='string'||host.length>512||typeof username!=='string'||typeof password!=='string'||
   username.length<1||username.length>256||password.length<1||password.length>256||
   /[\x00-\x1f\x7f]/.test(host+username+password))throw error('connect_input_invalid');
 let url;
 try{url=new URL(host.trim());}catch{throw error('connect_host_invalid')}
 // HTTP is permitted only with explicit consent at issuance; no embedded auth, path, query, IP
 // literals or local hostname. No DNS/network lookup is performed here.
 const name=url.hostname.toLowerCase();
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||
    url.pathname!=='/'||name.endsWith('.')||net.isIP(name)||!name.includes('.')||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(name)||
    /(?:^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(name))
   throw error('connect_host_invalid');
 return {host:url.origin,username,password};
}
const keyFromHex=value=>{
 if(!/^[0-9a-f]{64}$/i.test(String(value||'')))throw error('connect_key_unconfigured',503);
 return Buffer.from(value,'hex');
};
const hash=(code,key)=>NUMERIC.test(code)?crypto.createHmac('sha256',key).update('blofy-connect:numeric:v1:'+code).digest('hex'):crypto.createHash('sha256').update(code).digest('hex');
function encrypt(data,key,id){
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(Buffer.from('blofy-connect:v1:'+id));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data),'utf8'),cipher.final()]);
 return Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]);
}
function decrypt(blob,key,id){
 const data=Buffer.from(blob),decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
 decipher.setAAD(Buffer.from('blofy-connect:v1:'+id));decipher.setAuthTag(data.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8'));
}
export function createStreamConnectPairing({pool,keyHex,enabled=false,clock=Date.now}={}){
 let schema;
 const gate=()=>{if(enabled!==true)throw error('connect_disabled',503);if(!pool)throw error('connect_store_unconfigured',503);return keyFromHex(keyHex)};
 async function ensureSchema(){
  gate();
  if(!schema)schema=(async()=>{
   const db=await pool.connect();
   try{
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(173921,25)');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_connect_pairings (code_hash TEXT PRIMARY KEY, sealed BYTEA NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    await db.query('ALTER TABLE blofy_connect_pairings ADD COLUMN IF NOT EXISTS claimed_device_hash TEXT');
    await db.query('CREATE INDEX IF NOT EXISTS idx_blofy_connect_pairings_expiry ON blofy_connect_pairings(expires_at)');
    await db.query('CREATE TABLE IF NOT EXISTS blofy_connect_short_budget (id INTEGER PRIMARY KEY CHECK (id=1), minute TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL)');
    await db.query('COMMIT');
   }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
  })().catch(e=>{schema=null;throw e});
  return schema;
 }
 async function issue(input){
  const key=gate(),credentials=normalizeConnectInput(input);
  if(credentials.host.startsWith('http:')&&input.allowHttp!==true)throw error('connect_host_invalid');
  await ensureSchema();
  let code;
  const short=input.shortCode===true;
  const expiresAt=clock()+(short?5*60000:TTL_MS);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   // Serialize only Connect creation to enforce a global bounded active queue.
   if(unifiedNamespaceEnabled())await db.query(SHARED_CODE_LOCK_SQL);
   await db.query("SELECT pg_advisory_xact_lock(173921,24)");
   await db.query('DELETE FROM blofy_connect_pairings WHERE expires_at<=NOW()');
   const n=Number((await db.query('SELECT COUNT(*)::int AS count FROM blofy_connect_pairings')).rows[0]?.count||0);
   if(n>=(short?100:2000))throw error('connect_capacity',429);
   for(let attempt=0;attempt<8;attempt++){
    const candidate=short?String(crypto.randomInt(0,100_000_000)).padStart(8,'0'):input.numericCode===true?String(crypto.randomInt(0,1_000_000_000_000)).padStart(12,'0'):'BC-'+crypto.randomBytes(18).toString('base64url');
    if(await conflictsWithPaid(db,candidate))continue;
    const id=hash(candidate,key);
    const inserted=await db.query('INSERT INTO blofy_connect_pairings(code_hash,sealed,expires_at) VALUES($1,$2,$3) ON CONFLICT (code_hash) DO NOTHING RETURNING code_hash',[id,encrypt(credentials,key,id),new Date(expiresAt)]);
    if(inserted.rows.length===1){code=candidate;break;}
   }
   if(!code)throw error('connect_capacity',429);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
  return {ok:true,code,expiresAt,oneTime:true,providerVerified:false};
 }
 // Only for internal unified redemption dispatch. Does not return credentials.
 async function exists(code){
  const key=gate();
  if(typeof code!=='string'||!(CODE.test(code)||NUMERIC.test(code)))return false;
  await ensureSchema();
  const result=await pool.query('SELECT 1 FROM blofy_connect_pairings WHERE code_hash=$1 AND expires_at>NOW() LIMIT 1',[hash(code,key)]);
  return result.rows.length===1;
 }
 async function reserveShortAttempt(code){
  if(SHORT.test(code)){
   // Database-backed global budget across processes; no per-IP bypass.
   const budget=await pool.query("INSERT INTO blofy_connect_short_budget(id,minute,attempts) VALUES(1,date_trunc('minute',NOW()),1) ON CONFLICT(id) DO UPDATE SET minute=EXCLUDED.minute, attempts=CASE WHEN blofy_connect_short_budget.minute=EXCLUDED.minute THEN blofy_connect_short_budget.attempts+1 ELSE 1 END WHERE blofy_connect_short_budget.minute<>EXCLUDED.minute OR blofy_connect_short_budget.attempts<20 RETURNING attempts");
   if(budget.rows.length!==1)throw error('connect_rate_limited',429);
  }
 }
 async function redeem(input={}){
  return redeemImpl(input,false);
 }
 // An internal one-use lookup/claim capability, never a JSON option.
 // Charge every short-code lookup even when it is unknown or paid.
 async function beginUnifiedAttempt(code){
  gate();
  if(typeof code!=='string'||!(CODE.test(code)||NUMERIC.test(code)))throw error('connect_code_invalid');
  await ensureSchema();
  await reserveShortAttempt(code);
  const found=await exists(code);
  let used=false;
  return {exists:found,async redeem(deviceKey){
   if(!found||used)throw error('connect_code_expired_or_used',404);
   used=true;
   return redeemImpl({code,deviceKey},true);
  }};
 }
 async function redeemImpl({code,deviceKey=null}={},budgetReserved=false){
  if(deviceKey!==null&&(typeof deviceKey!=='string'||!/^[a-f0-9]{64}$/.test(deviceKey)))throw error('connect_code_invalid');
  const key=gate();
  if(typeof code!=='string'||!(CODE.test(code)||NUMERIC.test(code)))throw error('connect_code_invalid');
  await ensureSchema();
  if(!budgetReserved)await reserveShortAttempt(code);
  const id=hash(code,key);
  // A unified claim is retryable only for the same installation, until the
  // original expiry (never extended). Old clients cannot consume a bound row.
  const deviceHash=deviceKey===null?null:crypto.createHmac('sha256',key)
   .update('blofy-connect:device:v1:').update(id).update(':').update(deviceKey).digest('hex');
  const result=deviceHash===null
   ?await pool.query('DELETE FROM blofy_connect_pairings WHERE code_hash=$1 AND expires_at>NOW() AND claimed_device_hash IS NULL RETURNING sealed',[id])
   :await pool.query('UPDATE blofy_connect_pairings SET claimed_device_hash=$2 WHERE code_hash=$1 AND expires_at>NOW() AND (claimed_device_hash IS NULL OR claimed_device_hash=$2) RETURNING sealed',[id,deviceHash]);
  if(result.rows.length!==1)throw error('connect_code_expired_or_used',404);
  let credentials;
  try{credentials=normalizeConnectInput(decrypt(result.rows[0].sealed,key,id));}
  catch{throw error('connect_pairing_unavailable',503)}
  return {ok:true,type:'external_xtream',credentials,providerVerified:false};
 }
 async function purgeExpired(){await ensureSchema();const result=await pool.query('DELETE FROM blofy_connect_pairings WHERE expires_at<=NOW()');return {removed:Number(result.rowCount||0)};}
 return {issue,redeem,exists,beginUnifiedAttempt,ensureSchema,purgeExpired};
}


// Expired pairing credentials must be removed even if issuance traffic stops.
// Keep a single bounded in-flight cleanup per process; DELETE is idempotent
// across replicas. Never log credentials, codes, or database error details.
export function createConnectExpiryMaintenance({pairing,enabled=false,onError=()=>{}}={}){
 let running=false;
 async function tick(){
  if(!enabled||running)return {skipped:true};
  running=true;
  try{return await pairing.purgeExpired();}
  catch{try{onError('connect_expiry_cleanup_failed')}catch{}return {failed:true};}
  finally{running=false}
 }
 return {tick};
}

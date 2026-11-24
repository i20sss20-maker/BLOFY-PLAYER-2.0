// External-provider pairing is independent of all BLOFY subscription/account tables.
// No server-side request is ever made to a submitted host. The compatible app
// must validate the provider and subscription directly on the user's device.
import crypto from 'node:crypto';
import net from 'node:net';
const TTL_MS=15*60*1000;
const CODE=/^BC-[A-Za-z0-9_-]{24}$/;
const error=(code,status=400)=>Object.assign(Error(code),{status});
export function normalizeConnectInput(input={}){
 const {host,username,password}=input||{};
 if(typeof host!=='string'||host.length>512||typeof username!=='string'||typeof password!=='string'||
   username.length<1||username.length>256||password.length<1||password.length>256||
   /[\x00-\x1f\x7f]/.test(host+username+password))throw error('connect_input_invalid');
 let url;
 try{url=new URL(host.trim());}catch{throw error('connect_host_invalid')}
 // Initial supported mode is HTTPS only; no embedded auth, path, query, IP
 // literals or local hostname. No DNS/network lookup is performed here.
 const name=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
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
const hash=code=>crypto.createHash('sha256').update(code).digest('hex');
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
   await pool.query('CREATE TABLE IF NOT EXISTS blofy_connect_pairings (code_hash TEXT PRIMARY KEY, sealed BYTEA NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
   await pool.query('CREATE INDEX IF NOT EXISTS idx_blofy_connect_pairings_expiry ON blofy_connect_pairings(expires_at)');
  })().catch(e=>{schema=null;throw e});
  return schema;
 }
 async function issue(input){
  const key=gate(),credentials=normalizeConnectInput(input);
  await ensureSchema();
  const code='BC-'+crypto.randomBytes(18).toString('base64url'),id=hash(code);
  const expiresAt=clock()+TTL_MS;
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   // Serialize only Connect creation to enforce a global bounded active queue.
   await db.query("SELECT pg_advisory_xact_lock(173921,24)");
   await db.query('DELETE FROM blofy_connect_pairings WHERE expires_at<=NOW()');
   const n=Number((await db.query('SELECT COUNT(*)::int AS count FROM blofy_connect_pairings')).rows[0]?.count||0);
   if(n>=2000)throw error('connect_capacity',429);
   await db.query('INSERT INTO blofy_connect_pairings(code_hash,sealed,expires_at) VALUES($1,$2,$3)',[id,encrypt(credentials,key,id),new Date(expiresAt)]);
   await db.query('COMMIT');
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
  return {ok:true,code,expiresAt,oneTime:true,providerVerified:false};
 }
 async function redeem({code}={}){
  const key=gate();
  if(typeof code!=='string'||!CODE.test(code))throw error('connect_code_invalid');
  await ensureSchema();
  const id=hash(code);
  // Atomically consume a code across concurrent replicas, never reveal it twice.
  const result=await pool.query('DELETE FROM blofy_connect_pairings WHERE code_hash=$1 AND expires_at>NOW() RETURNING sealed',[id]);
  if(result.rows.length!==1)throw error('connect_code_expired_or_used',404);
  let credentials;
  try{credentials=normalizeConnectInput(decrypt(result.rows[0].sealed,key,id));}
  catch{throw error('connect_pairing_unavailable',503)}
  return {ok:true,type:'external_xtream',credentials,providerVerified:false};
 }
 return {issue,redeem,ensureSchema};
}

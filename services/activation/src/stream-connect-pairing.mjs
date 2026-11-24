import crypto from 'node:crypto';
import net from 'node:net';

const TTL_MS=15*60*1000, CAP=5000;
const fail=(code,status=400)=>Object.assign(Error(code),{status});
const CODE=/^BC1-[A-Za-z0-9_-]{32}$/;
const digest=code=>crypto.createHash('sha256').update(code).digest('hex');
const keyFor=code=>crypto.createHash('sha256').update('blofy-connect:v1\0'+code).digest();
export function normalizeConnectCredentials(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('connect_invalid_input');
 const raw=typeof input.host==='string'?input.host.trim():'';
 const username=typeof input.username==='string'?input.username:'';
 const password=typeof input.password==='string'?input.password:'';
 if(!raw||raw.length>500||!username||username.length>200||!password||password.length>200||/[\x00-\x1f\x7f]/.test(raw+username+password))throw fail('connect_invalid_input');
 let url;try{url=new URL(raw)}catch{throw fail('connect_invalid_host')}
 // No server-side DNS lookup or upstream request, including redirects.
 // The app must separately enforce its own network and transport policy.
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw fail('connect_invalid_host');
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(net.isIP(host.replace(/^\[|\]$/g,''))||!host.includes('.')||/\.(local|localhost|internal|lan|home|test|invalid|onion)$/.test(host)||! /^[a-z0-9.-]+$/.test(host))throw fail('connect_invalid_host');
 return {host:url.origin,username,password};
}
export function sealConnectPayload(payload,code){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',keyFor(code),iv);
 cipher.setAAD(Buffer.from('blofy-connect-v1'));
 const data=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
export function openConnectPayload(sealed,code){
 const raw=Buffer.from(sealed,'base64');
 const decipher=crypto.createDecipheriv('aes-256-gcm',keyFor(code),raw.subarray(0,12));
 decipher.setAAD(Buffer.from('blofy-connect-v1'));decipher.setAuthTag(raw.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'));
}
export function createStreamConnectPairing({pool,enabled=false}={}){
 let schema;
 async function ready(){
  if(!enabled)throw fail('connect_not_enabled',503);
  if(!schema)schema=(async()=>{
   await pool.query('CREATE TABLE IF NOT EXISTS blofy_connect_pairings(code_hash TEXT PRIMARY KEY, sealed_payload TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)');
   await pool.query('CREATE INDEX IF NOT EXISTS idx_blofy_connect_pairing_expiry ON blofy_connect_pairings(expires_at)');
  })().catch(e=>{schema=null;throw e});
  await schema;
 }
 async function issue(input){
  const credentials=normalizeConnectCredentials(input);
  if(input.authorized!==true)throw fail('connect_authorization_required');
  await ready();
  const code='BC1-'+crypto.randomBytes(24).toString('base64url');
  const sealed=sealConnectPayload(credentials,code);
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   await db.query('SELECT pg_advisory_xact_lock(713508241)');
   await db.query('DELETE FROM blofy_connect_pairings WHERE expires_at<=NOW()');
   const count=Number((await db.query('SELECT COUNT(*)::int AS n FROM blofy_connect_pairings')).rows[0]?.n||0);
   if(count>=CAP)throw fail('connect_capacity',429);
   await db.query("INSERT INTO blofy_connect_pairings(code_hash,sealed_payload,expires_at) VALUES($1,$2,NOW()+INTERVAL '15 minutes')",[digest(code),sealed]);
   await db.query('COMMIT');
   return {ok:true,code,expiresIn:TTL_MS/1000,oneTime:true,providerVerified:false};
  }catch(e){await db.query('ROLLBACK').catch(()=>{});throw e}finally{db.release()}
 }
 async function claim({code}={}){
  if(typeof code!=='string'||!CODE.test(code))throw fail('connect_invalid_code');
  await ready();
  // Atomic one-time consumption across replicas; no account or content creation.
  const row=(await pool.query('DELETE FROM blofy_connect_pairings WHERE code_hash=$1 AND expires_at>NOW() RETURNING sealed_payload',[digest(code)])).rows[0];
  if(!row)throw fail('connect_code_missing_or_expired',404);
  return {ok:true,credentials:openConnectPayload(row.sealed_payload,code),providerVerified:false,oneTime:true};
 }
 return {issue,claim};
}

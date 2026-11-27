import {createPublicKey,randomBytes,sign,verify} from 'node:crypto';
import {signLiveLease,verifyLiveLease} from './blofy-live-worker-lease.mjs';
const pin='MCowBQYDK2VwAyEAxtbHHm7Ic1yMvEAldZh36zPYHCvllmh9KqgM6mxS0P4=';
const route='/internal/engine-lease-claim';
const fields=['sourceId','engineId','channelId','reservationId'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const valid=i=>i&&uuid.test(i.sourceId??'')&&uuid.test(i.reservationId??'')&&['hostbrr','linode'].includes(i.engineId)&&/^[1-9][0-9]{0,14}$/.test(i.channelId??'');
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const encode=e=>Buffer.from(JSON.stringify(['BLOFY_ENGINE_LEASE_CLAIM_V1',route,e.nonce,e.ts,...fields.map(k=>e[k])]));
export function signLeaseClaim(identity,key,now=Date.now()){
 if(!valid(identity))throw Error('invalid_identity');
 const e={...Object.fromEntries(fields.map(k=>[k,identity[k]])),nonce:randomBytes(16).toString('hex'),ts:now};
 return {...e,signature:sign(null,encode(e),key).toString('base64url')};
}
export function verifyLeaseClaim(e,key,now=Date.now()){
 try{
  if(!exact(e,[...fields,'nonce','ts','signature'])||!valid(e)||!/^[a-f0-9]{32}$/.test(e.nonce)||
     !Number.isSafeInteger(e.ts)||e.ts<now-10000||e.ts>now+2000||!/^[A-Za-z0-9_-]{86}$/.test(e.signature))return false;
  const b=Buffer.from(e.signature,'base64url');
  return b.length===64&&b.toString('base64url')===e.signature&&verify(null,encode(e),key,b);
 }catch{return false}
}
// Persist one-time signed claim nonces across portal replicas and restarts.
export async function ensureLeaseClaimSchema(db){
 await db.query('CREATE TABLE IF NOT EXISTS blofy_engine_lease_claim_nonce(nonce text PRIMARY KEY, expires_at timestamptz NOT NULL)');
}
export function createLeaseNonceClaim(pool){
 return async(nonce,ts)=>{
  if(!/^[a-f0-9]{32}$/.test(nonce??'')||!Number.isSafeInteger(ts))return false;
  const c=await pool.connect();
  try{
   await c.query('BEGIN');
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended('blofy-engine-lease-claim-nonce',0))");
   await c.query('DELETE FROM blofy_engine_lease_claim_nonce WHERE expires_at<=clock_timestamp()');
   const r=await c.query("INSERT INTO blofy_engine_lease_claim_nonce(nonce,expires_at) SELECT $1,clock_timestamp()+interval '30 seconds' WHERE to_timestamp($2::double precision/1000) BETWEEN clock_timestamp()-interval '10 seconds' AND clock_timestamp()+interval '2 seconds' ON CONFLICT DO NOTHING",[nonce,ts]);
   await c.query('COMMIT');return r.rowCount===1;
  }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
 };
}
export function createLeaseClaimHttpEndpoint(handler){
 return async(req,res)=>{
  const reply=(code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
  if(req.method!=='POST')return reply(405,{ok:false});
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,{ok:false});
  try{
   let size=0;const chunks=[];
   for await(const c of req){size+=c.length;if(size>2048){req.destroy();return;}chunks.push(c)}
   const e=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const r=await handler(e);return reply(r.code,r.body);
  }catch{return reply(503,{ok:false})}
 };
}
// This transport cannot accept fence evidence from the wire. Only the
// independent server-side verifier can supply an authoritative fence.
export function createLeaseClaimHandler({key=createPublicKey({key:Buffer.from(pin,'base64'),format:'der',type:'spki'}),claimNonce,readFence,ledger,enabled=false,clock=Date.now}={}){
 const deny=code=>({code,body:{ok:false}});
 return async e=>{
  if(!enabled||typeof claimNonce!=='function'||typeof readFence!=='function'||typeof ledger?.claimWorkerLease!=='function')return deny(503);
  if(!verifyLeaseClaim(e,key,clock()))return deny(403);
  try{
   if(await claimNonce(e.nonce,e.ts)!==true)return deny(409);
   const identity=Object.fromEntries(fields.map(k=>[k,e[k]]));
   const fence=await readFence(identity);
   if(fence?.authoritative!==true||fence.scope!=='all_paths'||!fields.filter(k=>k!=='channelId').every(k=>fence[k]===identity[k]))return deny(409);
   const result=await ledger.claimWorkerLease({...identity,fence});
   if(!result?.ok||!fields.every(k=>result.lease?.[k]===identity[k]))return deny(409);
   return {code:200,body:{ok:true,lease:result.lease}};
  }catch{return deny(503)}
 };
}
export function createLeaseClaimClient({controllerKey,fetchImpl=fetch,enabled=false,clock=Date.now}={}){
 return async identity=>{
  if(!enabled||!valid(identity))return null;
  try{
   const e=signLeaseClaim(identity,controllerKey,clock());
   const r=await fetchImpl('https://blofy-activation-portal-production.up.railway.app'+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{'content-type':'application/json'},body:JSON.stringify(e)});
   if(r.status!==200||!r.body){await r.body?.cancel().catch(()=>{});return null}
   const reader=r.body.getReader(),chunks=[];let n=0;
   try{for(;;){const c=await reader.read();if(c.done)break;n+=c.value.byteLength;if(n>2048)return null;chunks.push(Buffer.from(c.value))}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
   const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!exact(v,['ok','lease'])||v.ok!==true||!fields.every(k=>v.lease?.[k]===identity[k]))return null;
   const now=clock();
   const signed=signLiveLease(v.lease,controllerKey,now);
   return verifyLiveLease(signed,{key:createPublicKey(controllerKey),identity,now})?signed:null;
  }catch{return null}
 };
}

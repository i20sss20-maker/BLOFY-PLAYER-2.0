import {createPublicKey,sign,verify,randomBytes} from 'node:crypto';
import {readApprovedEngineSource} from './blofy-engine-schema-preflight.mjs';

const domain='BLOFY_ENGINE_AUTHORITY_READ_V1';
const pin='MCowBQYDK2VwAyEAxtbHHm7Ic1yMvEAldZh36zPYHCvllmh9KqgM6mxS0P4=';
const route='/internal/engine-authority-read';
const encode=(nonce,ts,probeProvider)=>Buffer.from(JSON.stringify(
 probeProvider?[domain,route,nonce,ts,'provider_account']:[domain,route,nonce,ts]));
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
export function signAuthorityRead(key,now=Date.now(),{probeProvider=false}={}){
 const nonce=randomBytes(16).toString('hex');
 const signature=sign(null,encode(nonce,now,probeProvider),key).toString('base64url');
 return probeProvider?{nonce,ts:now,signature,probeProvider:true}:{nonce,ts:now,signature};
}
export function verifyAuthorityRead(e,key,now=Date.now()){
 try{
  const probeProvider=e?.probeProvider===true;
  if(!exact(e,probeProvider?['nonce','ts','signature','probeProvider']:['nonce','ts','signature'])||!/^[a-f0-9]{32}$/.test(e.nonce)||
   !Number.isSafeInteger(e.ts)||e.ts<now-10000||e.ts>now+2000||
   !/^[A-Za-z0-9_-]{86}$/.test(e.signature))return false;
  const b=Buffer.from(e.signature,'base64url');
  return b.length===64&&b.toString('base64url')===e.signature&&verify(null,encode(e.nonce,e.ts,probeProvider),key,b);
 }catch{return false}
}
export async function ensureAuthorityReadSchema(db){
 await db.query('CREATE TABLE IF NOT EXISTS blofy_engine_authority_read_nonce(nonce text PRIMARY KEY, expires_at timestamptz NOT NULL)');
}
// Actual portal state; this adapter grants NO lease, cannot change the gate,
// and cannot assert all-paths fencing. Uses one transaction and source lock.
export function createAuthorityReadEndpoint(pool,{env=process.env,key=createPublicKey({key:Buffer.from(pin,'base64'),format:'der',type:'spki'}),clock=Date.now,readProviderAccount}={}){
 const reply=(res,code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
 return async(req,res)=>{
  if(env.BLOFY_ENGINE_AUTHORITY_READ!=='1')return reply(res,503,{ok:false});
  if(req.method!=='POST')return reply(res,405,{ok:false});
  try{
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(res,415,{ok:false});
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>1024){req.destroy();return;}chunks.push(chunk);}
   const e=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!verifyAuthorityRead(e,key,clock()))return reply(res,403,{ok:false});
   const source=await readApprovedEngineSource(pool,env);
   if(!source)return reply(res,503,{ok:false});
   const {sourceId,reportedMaxConnections}=source;
   const c=await pool.connect();
   let out,probeProvider=false;
   try{
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended('blofy-engine-authority-read',0))");
    await c.query('DELETE FROM blofy_engine_authority_read_nonce WHERE expires_at<=now()');
    const n=await c.query("INSERT INTO blofy_engine_authority_read_nonce VALUES($1,now()+interval '20 seconds') ON CONFLICT DO NOTHING RETURNING nonce",[e.nonce]);
    if(n.rowCount!==1){await c.query('ROLLBACK');return reply(res,409,{ok:false})}
    if(e.probeProvider&&typeof readProviderAccount==='function'){
     const p=await c.query("INSERT INTO blofy_engine_authority_read_nonce VALUES($1,now()+interval '60 seconds') ON CONFLICT DO NOTHING RETURNING nonce",['provider:'+sourceId]);
     probeProvider=p.rowCount===1;
    }
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))',['blofy-linode-feed:'+sourceId]);
    const {rows:[g]}=await c.query('SELECT mode,reservation_id,engine_id FROM blofy_engine_ingress_gate WHERE source_id=$1',[sourceId]);
    const {rows:[r]}=await c.query('SELECT state,engine_id,channel_id,reservation_id,generation FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
    const {rows:[h]}=await c.query('SELECT count(*)::int n,min(created_at) oldest,max(created_at) newest FROM blofy_engine_legacy_holds WHERE source_id=$1 AND NOT closed',[sourceId]);
    const {rows:[t]}=await c.query('SELECT clock_timestamp() AS now');
    if(!g)throw Error('gate_missing');
    const observedAt=new Date(t.now).getTime();
    const age=value=>Math.max(0,Math.floor((observedAt-new Date(value).getTime())/1000));
    const legacyHoldAgesSeconds=h.n>0?{oldest:age(h.oldest),newest:age(h.newest)}:null;
    out={ok:true,sourceId,mode:g.mode,reportedMaxConnections,registeredLegacyHolds:h.n,legacyHoldAgesSeconds,gateReservationMatches:g.mode==='engine'&&!!r&&g.reservation_id===r.reservation_id&&g.engine_id===r.engine_id,allPathsFenced:false,observedAt,reservation:r?{sourceId,state:r.state,engineId:r.engine_id,channelId:r.channel_id,reservationId:r.reservation_id,generation:r.generation}:null};
    await c.query('COMMIT');
   }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
   if(e.probeProvider){
    out.providerAccount=null;
    if(probeProvider){
     try{
      const {activeConnections,maxConnections}=await readProviderAccount(sourceId);
      if(Number.isSafeInteger(activeConnections)&&activeConnections>=0&&
         Number.isSafeInteger(maxConnections)&&maxConnections>=0)
       out.providerAccount={activeConnections,maxConnections,observedAt:clock()};
     }catch{} // Only sanitized counts, never credential, URL or error text.
    }
   }
   return reply(res,200,out);
  }catch{return reply(res,503,{ok:false})}
 };
}

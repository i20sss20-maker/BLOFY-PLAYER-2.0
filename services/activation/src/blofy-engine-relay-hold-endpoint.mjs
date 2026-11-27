import {timingSafeEqual} from 'node:crypto';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {resolveApprovedEngineSource} from './blofy-engine-schema-preflight.mjs';
// Conservative source-wide registration for relay activity. No source URL,
// subscriber data, promotion, or provider release assertion crosses this API.
// Holds are durable and never expire into a new admission permission.
export function createRelayHoldEndpoint(pool,env=process.env){
 const enabled=env.BLOFY_ENGINE_RELAY_HOLDS==='1'&&env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const secret=String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'');
 const valid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 return async(req,res)=>{
  const reply=(code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
  if(req.method!=='POST')return reply(405,{ok:false});
  const a=Buffer.from(String(req.headers.authorization||'')),b=Buffer.from('Bearer '+secret);
  if(secret.length<32||a.length!==b.length||!timingSafeEqual(a,b))return reply(403,{ok:false});
  if(!enabled)return reply(503,{ok:false});
  try{
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,{ok:false});
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>512){req.destroy();return;}chunks.push(chunk)}
   const e=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!e||Object.keys(e).sort().join(',')!=='holdId,operation'||!['enter','close'].includes(e.operation)||typeof e.holdId!=='string'||!valid.test(e.holdId))return reply(400,{ok:false});
   const sourceId=await resolveApprovedEngineSource(pool,env);
   if(!sourceId)return reply(503,{ok:false});
   const gate=createEngineIngressGate(pool,{sourceId,enabled:true});
   const r=e.operation==='enter'?await gate.enterLegacy(e.holdId):await gate.closeLegacy(e.holdId);
   return reply(r?.ok?200:409,{ok:r?.ok===true});
  }catch{return reply(503,{ok:false})}
 };
}

import {timingSafeEqual} from 'node:crypto';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {resolveApprovedEngineSource} from './blofy-engine-schema-preflight.mjs';
// Private read-only endpoint. Reuses the existing authenticated relay bridge
// credential, never the subscriber or admin credential. No mode mutation
// or provider capacity assertion is possible through this endpoint.
export function createRelayFenceEndpoint(pool,env=process.env){
 const enabled=env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const token=String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'');
 return async function handle(req,res){
  const reply=(status,body)=>{
   res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
   res.end(JSON.stringify(body));
  };
  if(req.method!=='GET')return reply(405,{ok:false});
  const a=Buffer.from(String(req.headers.authorization||''));
  const b=Buffer.from('Bearer '+token);
  if(token.length<32||a.length!==b.length||!timingSafeEqual(a,b))return reply(403,{ok:false});
  if(!enabled)return reply(503,{ok:false});
  try{
   const sourceId=await resolveApprovedEngineSource(pool,env);
   if(!sourceId)return reply(503,{ok:false});
   const gate=createEngineIngressGate(pool,{sourceId,enabled});
   const r=await gate.readMode();
   if(!r?.ok)return reply(503,{ok:false});
   return reply(200,r);
  }catch{return reply(503,{ok:false})}
 };
}

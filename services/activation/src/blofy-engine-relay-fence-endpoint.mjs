import {timingSafeEqual} from 'node:crypto';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {resolveEngineIngressSource} from './blofy-engine-schema-preflight.mjs';
// Private read-only endpoint. Reuses the existing authenticated relay bridge
// credential, never the subscriber or admin credential. No mode mutation
// or provider capacity assertion is possible through this endpoint.
export function createRelayFenceEndpoint(pool,env=process.env){
 const enabled=env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const token=String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'');
 const owned=env.BLOFY_RELAY_ENGINE_OWNERSHIP==='1';
 const keys={hostbrr:String(env.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN||''),linode:String(env.BLOFY_LINODE_RELAY_HOLD_TOKEN||'')};
 const distinct=Object.values(keys).every(k=>k.length>=32&&k!==token)&&keys.hostbrr!==keys.linode;
 const matches=(a,k)=>{const b=Buffer.from('Bearer '+k);return k.length>=32&&a.length===b.length&&timingSafeEqual(a,b)};
 return async function handle(req,res){
  const reply=(status,body)=>{
   res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
   res.end(JSON.stringify(body));
  };
  if(req.method!=='GET')return reply(405,{ok:false});
  const a=Buffer.from(String(req.headers.authorization||''));
  const engineId=owned&&distinct?Object.keys(keys).find(id=>matches(a,keys[id])):null;
  if(owned?!engineId:!matches(a,token))return reply(403,{ok:false});
  if(!enabled)return reply(503,{ok:false});
  try{
   const sourceId=await resolveEngineIngressSource(pool,env);
   if(!sourceId)return reply(503,{ok:false});
   const gate=createEngineIngressGate(pool,{sourceId,enabled});
   const r=owned?await gate.readRelayAdmission(engineId):await gate.readMode();
   if(!r?.ok)return reply(503,{ok:false});
   return reply(200,r);
  }catch{return reply(503,{ok:false})}
 };
}

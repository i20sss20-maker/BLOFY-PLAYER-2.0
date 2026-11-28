import {timingSafeEqual} from 'node:crypto';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {resolveEngineIngressSource} from './blofy-engine-schema-preflight.mjs';
// Conservative source-wide registration for relay activity. No source URL,
// subscriber data, promotion, or provider release assertion crosses this API.
// Holds are durable and never expire into a new admission permission.
export function createRelayHoldEndpoint(pool,env=process.env){
 const enabled=env.BLOFY_ENGINE_RELAY_HOLDS==='1'&&env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const secret=String(env.BLOFY_STREAM_RELAY_SHARED_TOKEN||'');
 const owned=env.BLOFY_RELAY_ENGINE_OWNERSHIP==='1';
 const keys={hostbrr:String(env.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN||''),linode:String(env.BLOFY_LINODE_RELAY_HOLD_TOKEN||'')};
 const distinct=Object.values(keys).every(k=>k.length>=32&&k!==secret)&&keys.hostbrr!==keys.linode;
 const matches=(a,k)=>{const b=Buffer.from('Bearer '+k);return k.length>=32&&a.length===b.length&&timingSafeEqual(a,b)};
 const valid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 return async(req,res)=>{
  const reply=(code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
  if(req.method!=='POST')return reply(405,{ok:false});
  const a=Buffer.from(String(req.headers.authorization||''));
  const engineId=owned&&distinct?Object.keys(keys).find(id=>matches(a,keys[id])):null;
  if(owned?!engineId:!matches(a,secret))return reply(403,{ok:false});
  if(!enabled)return reply(503,{ok:false});
  try{
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,{ok:false});
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>512){req.destroy();return;}chunks.push(chunk)}
   const e=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!e||Object.keys(e).sort().join(',')!=='holdId,operation'||!['enter','close','abandon'].includes(e.operation)||typeof e.holdId!=='string'||!valid.test(e.holdId))return reply(400,{ok:false});
   const sourceId=await resolveEngineIngressSource(pool,env);
   if(!sourceId)return reply(503,{ok:false});
   const gate=createEngineIngressGate(pool,{sourceId,enabled:true});
   const methods={enter:'enterLegacy',close:'closeLegacy',abandon:'abandonLegacy'};
   const r=owned?(e.operation==='enter'?await gate.enterOwnedRelay(e.holdId,engineId):
    await gate.closeOwnedRelay(e.holdId,engineId,{abandon:e.operation==='abandon'})):
    await gate[methods[e.operation]](e.holdId);
   return reply(r?.ok?200:409,{ok:r?.ok===true});
  }catch{return reply(503,{ok:false})}
 };
}

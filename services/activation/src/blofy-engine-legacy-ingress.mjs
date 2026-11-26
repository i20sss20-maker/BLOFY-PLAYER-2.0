import {randomUUID} from 'node:crypto';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
// Gate the authenticated source before issuing any media capability or opening
// a socket. These holds describe gateway requests, NOT provider-wide sockets.
// In particular, a redirected capability may outlive this request. Independent
// relay and provider verification remain mandatory before engine promotion.
export function createLegacyIngress(pool,env=process.env){
 const sourceId=String(env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID||'');
 const enabled=env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const gate=createEngineIngressGate(pool,{sourceId,enabled});
 return async function enter(source){
  if(!enabled||source!==sourceId)return {ok:true,close:async()=>true};
  const holdId=randomUUID();
  try{
   const r=await gate.enterLegacy(holdId);
   if(!r?.ok)return {ok:false,reason:'source_ingress_fenced'};
   let closed=false;
   return {ok:true,async close(){
    if(closed)return true;
    try{const r=await gate.closeLegacy(holdId);if(r?.ok){closed=true;return true;}}catch{}
    return false;
   }};
  }catch{return {ok:false,reason:'source_ingress_unknown'}}
 };
}

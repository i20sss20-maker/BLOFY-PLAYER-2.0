import {randomUUID} from 'node:crypto';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {resolveApprovedEngineSource} from './blofy-engine-schema-preflight.mjs';
// Gate the authenticated source before issuing any media capability or opening
// a socket. These holds describe gateway requests, NOT provider-wide sockets.
// In particular, a redirected capability may outlive this request. Independent
// relay and provider verification remain mandatory before engine promotion.
export function createLegacyIngress(pool,env=process.env){
 const enabled=env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const allow=()=>({ok:true,close:async()=>true});
 return async function enter(source){
  if(!enabled)return allow();
  const holdId=randomUUID();
  try{
   const sourceId=await resolveApprovedEngineSource(pool,env);
   if(!sourceId)return {ok:false,reason:'source_identity_unknown'};
   if(source!==sourceId)return allow();
   const gate=createEngineIngressGate(pool,{sourceId,enabled});
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

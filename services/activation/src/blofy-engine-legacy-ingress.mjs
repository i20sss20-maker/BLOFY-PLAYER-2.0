import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {resolveEngineIngressSource} from './blofy-engine-schema-preflight.mjs';
// Gate the authenticated source before issuing any media capability or opening
// a socket. These holds describe gateway requests, NOT provider-wide sockets.
// In particular, a redirected capability may outlive this request. Independent
// relay and provider verification remain mandatory before engine promotion.
export function createLegacyIngress(pool,env=process.env){
 const enabled=env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const allow=()=>({ok:true,close:async()=>true});
 return async function enter(source,{unknownSource=false}={}){
  if(!enabled)return allow();
  const holdId=randomUUID();
  try{
   const sourceId=await resolveEngineIngressSource(pool,env);
   if(!sourceId)return {ok:false,reason:'source_identity_unknown'};
   // An opaque subscriber proxy URL can redirect to this source; hold
   // conservatively until its actual upstream identity can be established.
   if(!unknownSource&&source!==sourceId)return allow();
   const gate=createEngineIngressGate(pool,{sourceId,enabled});
   let r;
   try{r=await gate.enterLegacy(holdId)}catch{
    void retryCleanup(()=>gate.abandonLegacy(holdId));
    return {ok:false,reason:'source_ingress_unknown'};
   }
   if(!r?.ok)return {ok:false,reason:'source_ingress_fenced'};
   let closing;
   return {ok:true,close(){
    closing??=retryCleanup(()=>gate.closeLegacy(holdId));
    return closing;
   }};
  }catch{return {ok:false,reason:'source_ingress_unknown'}}
 };
}

async function retryCleanup(operation){
 for(const backoff of [0,150,450]){
  if(backoff)await delay(backoff);
  try{if((await operation())?.ok===true)return true}catch{}
 }
 console.warn('BLOFY_LEGACY_INGRESS_CLEANUP_UNCONFIRMED');
 return false;
}

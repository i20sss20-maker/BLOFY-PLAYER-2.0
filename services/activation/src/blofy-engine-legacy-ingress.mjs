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
 const retryQueue=createLegacyCleanupQueue();
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
    void retryQueue.submit(holdId,()=>gate.abandonLegacy(holdId));
    return {ok:false,reason:'source_ingress_unknown'};
   }
   if(!r?.ok)return {ok:false,reason:'source_ingress_fenced'};
   let closing;
   return {ok:true,close(){
    closing??=retryQueue.submit(holdId,()=>gate.closeLegacy(holdId));
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

// A bounded, process-local retry queue for explicitly requested cleanup only.
// Never infer that an old hold is closed, and never evict a live admission.
// A restart can still lose pending intent; historical reconciliation requires
// independent all-path drain proof and is deliberately not performed here.
export function createLegacyCleanupQueue({maxPending=2048,batchSize=16,intervalMs=15000,attempt=retryCleanup,schedule=setInterval}={}){
 const pending=new Map(),running=new Map();
 let timer=null,busy=false;
 const stopIfIdle=()=>{if(!pending.size&&timer){clearInterval(timer);timer=null}};
 async function run(id,operation){
  if(running.has(id))return running.get(id);
  const task=Promise.resolve().then(()=>attempt(operation)).catch(()=>false).then(ok=>{
   if(ok===true){pending.delete(id);stopIfIdle();return true}
   if(!pending.has(id)&&pending.size>=maxPending){
    console.warn('BLOFY_LEGACY_CLEANUP_QUEUE_FULL');return false;
   }
   pending.set(id,operation);
   if(!timer){timer=schedule(()=>void flush(),intervalMs);timer?.unref?.()}
   return false;
  }).finally(()=>running.delete(id));
  running.set(id,task);return task;
 }
 async function flush(){
  if(busy)return;
  busy=true;
  try{
   const batch=[...pending.entries()].slice(0,batchSize);
   // Rotate failures so one permanently unavailable record cannot starve others.
   for(const [id,op] of batch){pending.delete(id);pending.set(id,op)}
   await Promise.all(batch.map(([id,op])=>run(id,op)));
  }finally{busy=false;stopIfIdle()}
 }
 return {submit:run,flush,pendingCount:()=>pending.size,stop(){if(timer)clearInterval(timer);timer=null}};
}

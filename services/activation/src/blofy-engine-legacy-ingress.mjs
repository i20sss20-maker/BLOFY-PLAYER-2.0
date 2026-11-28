import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {resolveEngineIngressSource} from './blofy-engine-schema-preflight.mjs';
// Gate the authenticated source before issuing any media capability or opening
// a socket. These holds describe gateway requests, NOT provider-wide sockets.
// In particular, a redirected capability may outlive this request. Independent
// relay and provider verification remain mandatory before engine promotion.
export function createGatewayHoldLifetime(){
 let retiring=false,active=0;
 const queues=new Set();
 function register(queue){
  queues.add(queue);
 }
 function begin(){
  if(retiring)return null;
  active++;
  let finished=false;
  return ()=>{
   if(finished)return;
   finished=true;active--;
  };
 }
 async function drain(timeoutMs=15000){
  retiring=true;
  const deadline=performance.now()+timeoutMs;
  for(;;){
   const pending=[...queues].reduce((n,q)=>n+q.outstandingCount(),0);
   const overflow=[...queues].reduce((n,q)=>n+q.overflowCount(),0);
   if(!active&&!pending)return {complete:overflow===0,active:0,pending:0,overflow};
   if(performance.now()>=deadline)return {complete:false,active,pending,overflow};
   for(const queue of queues)void queue.flush().catch(()=>{});
   await delay(Math.min(250,Math.max(1,deadline-performance.now())));
  }
 }
 return {register,begin,retire(){retiring=true},drain};
}
export const gatewayHoldLifetime=createGatewayHoldLifetime();

export function createLegacyIngress(pool,env=process.env,lifetime=gatewayHoldLifetime){
 const enabled=env.BLOFY_ENGINE_LEGACY_INGRESS_GATE==='1';
 const retryQueue=createLegacyCleanupQueue();
 if(enabled)lifetime.register(retryQueue);
 const allow=()=>({ok:true,close:async()=>true});
 return async function enter(source,{unknownSource=false,background=false}={}){
  const idleOnly=background&&env.BLOFY_ENGINE_IDLE_BACKGROUND_PROBES==='1';
  if(!enabled)return idleOnly?{ok:false,reason:'background_gate_disabled'}:allow();
  const finish=lifetime.begin();
  if(!finish)return {ok:false,reason:'gateway_retiring'};
  const holdId=randomUUID();
  let handedOff=false;
  try{
   const sourceId=await resolveEngineIngressSource(pool,env);
   if(!sourceId)return {ok:false,reason:'source_identity_unknown'};
   // An opaque subscriber proxy URL can redirect to this source; hold
   // conservatively until its actual upstream identity can be established.
   if(!unknownSource&&source!==sourceId)return allow();
   const gate=createEngineIngressGate(pool,{sourceId,enabled});
   let r;
   try{r=await gate.enterLegacy(holdId,{background:idleOnly})}catch{
    void retryQueue.submit(holdId,()=>gate.abandonLegacy(holdId));
    return {ok:false,reason:'source_ingress_unknown'};
   }
   if(!r?.ok)return {ok:false,reason:r?.reason==='background_source_busy'?'background_source_busy':'source_ingress_fenced'};
   let closing;
   handedOff=true;
   return {ok:true,close(){
    closing??=retryQueue.submit(holdId,()=>gate.closeLegacy(holdId)).finally(finish);
    return closing;
   }};
  }catch{return {ok:false,reason:'source_ingress_unknown'}}
  finally{if(!handedOff)finish()}
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
 let timer=null,busy=false,overflow=0;
 const stopIfIdle=()=>{if(!pending.size&&timer){clearInterval(timer);timer=null}};
 async function run(id,operation){
  if(running.has(id))return running.get(id);
  const task=Promise.resolve().then(()=>attempt(operation)).catch(()=>false).then(ok=>{
   if(ok===true){pending.delete(id);stopIfIdle();return true}
   if(!pending.has(id)&&pending.size>=maxPending){
    overflow++;
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
 return {submit:run,flush,pendingCount:()=>pending.size,
  overflowCount:()=>overflow,
  outstandingCount:()=>pending.size+[...running.keys()].filter(id=>!pending.has(id)).length,
  stop(){if(timer)clearInterval(timer);timer=null}};
}

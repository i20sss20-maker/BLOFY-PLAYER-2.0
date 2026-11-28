import {createEngineIngressGate} from './blofy-engine-ingress-gate.mjs';
import {readApprovedEngineSource} from './blofy-engine-schema-preflight.mjs';
import {createRelayHandoffCoordinator} from './blofy-relay-handoff-coordinator.mjs';
import {createRelayProviderReleaseObserver} from './blofy-relay-provider-release-observer.mjs';
import {checkProductionRelayPair} from './xtream-stream-relay-bridge.mjs';

// Internal composition only. No timers, HTTP route, provider call, or DB
// mutation at import. Never accept coverage/stop assertions from customers.
const hold=reason=>({ok:false,action:'hold',reason});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function createProductionRelayHandoff({
 pool,env=process.env,readProviderAccount,verifyCoverage,stopPreviousOwner,
 readApproved=()=>readApprovedEngineSource(pool,env),
 createGate=opts=>createEngineIngressGate(pool,opts),
 readPair=()=>checkProductionRelayPair({env}),clock=Date.now
}={}){
 let runner=null,busy=false;
 return async function tick(){
  if(env.BLOFY_RELAY_AUTO_HANDOFF!=='1')return hold('disabled');
  if(busy)return hold('tick_busy');
  if(!['BLOFY_ENGINE_LEGACY_INGRESS_GATE','BLOFY_ENGINE_RELAY_HOLDS',
     'BLOFY_RELAY_ENGINE_OWNERSHIP','BLOFY_RELAY_OWNER_ROUTING',
     'BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER'].every(k=>env[k]==='1'))
   return hold('production_flags_incomplete');
  if([readProviderAccount,verifyCoverage,stopPreviousOwner].some(x=>typeof x!=='function'))
   return hold('trusted_adapters_missing');
  const raw=String(env.BLOFY_RELAY_APPROVED_PROVIDER_QUOTA??'');
  const quota=/^[1-9][0-9]*$/.test(raw)?Number(raw):NaN;
  if(!Number.isSafeInteger(quota)||quota<1)return hold('source_capacity_unconfirmed');
  busy=true;
  try{
   const approved=await readApproved();
   if(!uuid.test(approved?.sourceId??'')||approved.reportedMaxConnections!==quota)
    return hold('source_capacity_unconfirmed');
   const sourceId=approved.sourceId;
   if(runner&&(runner.sourceId!==sourceId||runner.quota!==quota))
    return hold('configured_source_changed');
   if(!runner){
    const gate=createGate({sourceId,enabled:true,expectedRelayMaxConnections:quota});
    const coverage=async identity=>{
     const source=await readApproved();
     return source?.sourceId===sourceId&&source.reportedMaxConnections===quota&&
      await verifyCoverage(identity)===true;
    };
    const observeProviderRelease=createRelayProviderReleaseObserver({
     sourceId,expectedRelayMaxConnections:quota,readApprovedSource:readApproved,
     readOwnerState:()=>gate.readRelayOwnerState(),readProviderAccount,
     verifyCoverage:coverage,clock
    });
    const readHealth=async()=>{
     const at=clock(),pair=await readPair(),end=clock();
     if(end<at||end-at>7000)return {};
     return Object.fromEntries(['hostbrr','linode'].flatMap(id=>
      typeof pair?.[id]?.ok==='boolean'?[[id,{ok:pair[id].ok,observedAt:at}]]:[]));
    };
    runner={sourceId,quota,tick:createRelayHandoffCoordinator({
     enabled:true,gate,sourceId,readHealth,verifyCoverage:coverage,
     stopPreviousOwner,observeProviderRelease,clock,
     expectedRelayMaxConnections:quota,trackHealthContinuity:true
    })};
   }
   return await runner.tick();
  }catch{return hold('production_handoff_unavailable')}
  finally{busy=false}
 };
}

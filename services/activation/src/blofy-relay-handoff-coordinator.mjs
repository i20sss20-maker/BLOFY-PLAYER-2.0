// Internal only. The trusted adapters must fence every source path, stop
// the prior owner's upstream sockets, and independently observe the provider.
// An HTTP health failure or an empty local hold count is NOT release proof.
const hold=reason=>({ok:false,action:'hold',reason});
const validOwner=x=>x==='hostbrr'||x==='linode';
export function createRelayHandoffCoordinator({enabled=false,gate,sourceId,
 readHealth,verifyCoverage,stopPreviousOwner,observeProviderRelease,clock=Date.now,
 failoverAfterMs=30000,failbackAfterMs=300000}={}){
 let busy=false;
 return async function tick(){
  if(!enabled)return hold('disabled');
  if(!gate||typeof readHealth!=='function'||typeof verifyCoverage!=='function'||
    typeof stopPreviousOwner!=='function'||typeof observeProviderRelease!=='function')return hold('adapters_missing');
  if(busy)return hold('tick_busy');
  busy=true;
  try{
   // Never start a drain until the trusted coverage adapter is actually
   // available. It must prove coverage again after the drain.
   if(await verifyCoverage({sourceId,phase:'preflight'})!==true)return hold('coverage_unconfirmed');
   const state=await gate.readRelayOwnerState();
   if(!state?.ok||!['legacy','draining'].includes(state.mode))return hold('owner_state_unavailable');
   const health=await readHealth();
   const now=clock();
   const stable=(id,ok,ms,snapshot=health,at=now)=>{
    const h=snapshot?.[id];
    return Number.isSafeInteger(h?.observedAt)&&h.observedAt>=at-10000&&h.observedAt<=at+2000&&
      h.ok===ok&&Number.isSafeInteger(h.since)&&h.since<=h.observedAt&&h.observedAt-h.since>=ms;
   };
   let transition=state;
   if(state.mode==='legacy'){
    // Bootstrap is deliberately operator-controlled, not an automatic outage.
    if(!validOwner(state.owner)||state.nextOwner)return hold('owner_not_initialized');
    const next=state.owner==='hostbrr'?'linode':'hostbrr';
    const failed=stable(state.owner,false,failoverAfterMs)&&stable(next,true,failoverAfterMs);
    const returning=state.owner==='linode'&&stable('hostbrr',true,failbackAfterMs)&&stable('linode',true,failbackAfterMs);
    if(!failed&&!returning)return hold('no_stable_transition');
    transition=await gate.beginRelayDrain({expectedOwner:state.owner,nextOwner:next});
    if(!transition?.ok)return hold('drain_conflict');
   }
   if(!validOwner(transition.owner)||!validOwner(transition.nextOwner)||
      transition.owner===transition.nextOwner||!Number.isSafeInteger(transition.epoch))
     return hold('transition_unconfirmed');
   const identity=Object.freeze({sourceId,previousOwner:transition.owner,
     nextOwner:transition.nextOwner,drainStartedAt:transition.epoch});
   if(!stable(identity.nextOwner,true,failoverAfterMs,health,clock()))return hold('destination_unavailable');
   // Repeated calls must be safe: adapter stops only the recorded prior owner
   // for this exact epoch, never the proposed destination.
   if(await stopPreviousOwner(identity)!==true)return hold('stop_unconfirmed');
   const latest=await gate.readRelayOwnerState();
   if(!latest?.ok||latest.mode!=='draining'||latest.owner!==identity.previousOwner||
      latest.nextOwner!==identity.nextOwner||latest.epoch!==identity.drainStartedAt)
     return hold('drain_changed');
   if(latest.openHolds!==0)return hold('holds_open');
   if(await verifyCoverage({...identity,phase:'drained'})!==true)return hold('coverage_unconfirmed');
   const proof=await observeProviderRelease(identity);
   if(proof?.sourceId!==sourceId||proof.previousOwner!==identity.previousOwner||
     proof.drainStartedAt!==identity.drainStartedAt||proof.authoritative!==true||
     proof.scope!=='all_paths'||proof.activeConnections!==0||proof.maxConnections!==1||
     !Number.isSafeInteger(proof.observedAt)||proof.observedAt<identity.drainStartedAt)
      return hold('provider_release_unconfirmed');
   // Stopping the old owner and observing provider release can take time.
   // Do not commit a destination using the pre-drain health snapshot.
   const finalHealth=await readHealth();
   const commitAt=clock();
   if(!stable(identity.nextOwner,true,failoverAfterMs,finalHealth,commitAt))
      return hold('destination_unavailable');
   if(proof.observedAt<commitAt-10000||proof.observedAt>commitAt+2000)
      return hold('provider_release_unconfirmed');
   // The gate revalidates freshness, holds, intent and the worker ledger
   // atomically. An ambiguous commit must be re-read, never forced.
   const result=await gate.commitRelayOwner({expectedOwner:identity.previousOwner,nextOwner:identity.nextOwner,proof});
   return result?.ok===true?{ok:true,action:'owner_committed',owner:identity.nextOwner}:hold('commit_unconfirmed');
  }catch{return hold('transition_outcome_unknown')}
  finally{busy=false}
 };
}

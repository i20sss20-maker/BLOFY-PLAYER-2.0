// Health observations for handoff decisions, not authorization or release proof.
// Unknown/stale telemetry is never turned into a confirmed outage.
export function createRelayHealthTracker({clock=Date.now,maxGapMs=10000}={}){
 if(!Number.isSafeInteger(maxGapMs)||maxGapMs<1000||maxGapMs>10000)throw Error('invalid_health_gap');
 const states=new Map(),ids=['hostbrr','linode'];
 function observe(snapshot){
  const now=clock();
  for(const id of ids){
   const h=snapshot?.[id],old=states.get(id);
   if(!h||typeof h.ok!=='boolean'||!Number.isSafeInteger(h.observedAt)||
      h.observedAt<now-maxGapMs||h.observedAt>now+2000){
    states.delete(id);continue;
   }
   // Duplicate timestamps do not extend the duration of evidence. An
   // out-of-order observation invalidates the continuous evidence window.
   if(old&&h.observedAt<old.observedAt){states.delete(id);continue;}
   if(old&&h.observedAt===old.observedAt){
    if(h.ok!==old.ok)states.delete(id);
    continue;
   }
   const continuous=old&&old.ok===h.ok&&h.observedAt-old.observedAt<=maxGapMs;
   states.set(id,{ok:h.ok,observedAt:h.observedAt,since:continuous?old.since:h.observedAt});
  }
  return read();
 }
 function read(){
  const now=clock(),result={};
  for(const id of ids){
   const h=states.get(id);
   if(h&&h.observedAt>=now-maxGapMs&&h.observedAt<=now+2000)result[id]={...h};
  }
  return result;
 }
 return {observe,read};
}

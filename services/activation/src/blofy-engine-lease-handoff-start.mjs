// Adapter for the already installed signed-lease polling workers.
// No direct source request: only the committed ledger can permit a lease.
// A timeout preserves the pending reservation; never releases or reopens it.
import {createReadyProofReader} from './blofy-engine-ready-proof-read.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const hold=reason=>({ok:false,action:'hold',reason});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function createLeaseHandoffStart({ledger,enabled=false,env=process.env,
 readProof=createReadyProofReader({enabled,secret:env.BLOFY_ENGINE_READY_READ_SECRET}),
 clock=Date.now,sleep=delay,timeoutMs=45000,pollMs=1000}={}){
 return async function start({request,engineId,handoff}={}){
  if(!enabled)return hold('lease_start_disabled');
  if(!ledger?.reserve||!ledger?.readRoutingState||!ledger?.markLeaseReady||typeof readProof!=='function')return hold('lease_start_unavailable');
  const {sourceId,channelId,requestId,expiresAt}=request??{};
  if(request?.authorized!==true||!uuid.test(sourceId??'')||!uuid.test(requestId??'')||
    typeof channelId!=='string'||!/^[1-9][0-9]{0,14}$/.test(channelId)||
    !['hostbrr','linode'].includes(engineId)||!Number.isSafeInteger(expiresAt)||expiresAt<=clock())return hold('lease_start_unauthorized');
  // Initial migration requires its own independently verified drain protocol.
  // This adapter is exclusively for a released engine-owned reservation.
  if(!uuid.test(handoff?.fromReservationId??'')||!['hostbrr','linode'].includes(handoff?.fromEngineId)||
    handoff.proof?.sourceId!==sourceId)return hold('lease_handoff_required');
  let r;
  try{r=await ledger.reserve({sourceId,channelId,requestId,engineId,handoff})}catch{return hold('lease_reservation_unknown')}
  if(!r?.ok||r.action!=='start_once'||r.state!=='pending'||!uuid.test(r.reservationId??''))return hold(r?.reason??'lease_reservation_not_new');
  const identity={sourceId,channelId,engineId,reservationId:r.reservationId,generation:r.reservationId.replaceAll('-','')};
  const deadline=Math.min(expiresAt,clock()+Math.max(1,Math.min(60000,timeoutMs)));
  // Bounded attempts even if an injected clock fails to advance.
  const interval=Math.max(250,Math.min(5000,pollMs));
  const attempts=Math.ceil(Math.max(0,deadline-clock())/interval);
  for(let i=0;i<attempts&&clock()<deadline;i++){
   try{
    const current=await ledger.readRoutingState({sourceId});
    if(!current||!['pending','ready'].includes(current.state)||
      !['sourceId','channelId','engineId','reservationId'].every(k=>current[k]===identity[k]))return hold('lease_ownership_changed');
    const proof=await readProof(identity),now=clock();
    if(now>=deadline)return hold('lease_start_timeout');
    if(proof&&Object.keys(identity).every(k=>proof[k]===identity[k])&&
      Number.isSafeInteger(proof.observedAt)&&proof.observedAt>=now-10000&&proof.observedAt<=now+2000&&
      Number.isSafeInteger(proof.lastSegment)&&proof.lastSegment>=0){
     const ready=await ledger.markLeaseReady({...identity,proof});
     if(ready?.ok===true&&ready.state==='ready'&&ready.generation===identity.generation)
      return {ok:true,action:'feed_ready',...identity};
     return hold('lease_ready_not_committed');
    }
   }catch{return hold('lease_start_outcome_unknown')}
   if(i+1<attempts&&clock()<deadline)await sleep(Math.min(interval,Math.max(0,deadline-clock())));
  }
  return hold('lease_start_timeout');
 };
}

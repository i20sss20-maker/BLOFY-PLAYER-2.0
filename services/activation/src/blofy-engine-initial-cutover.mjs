// Operator-only initial cutover. No HTTP exposure and no default authority.
// The verifier must independently fence every upstream path and establish
// provider release; a database count or elapsed time is not a substitute.
export function createInitialCutover({gate,ledger,verifyDrain,verifyRollback,startWorker,enabled=false}={}){
 const hold=reason=>({ok:false,reason});
 return async function cutover(request){
  if(!enabled)return hold('disabled');
  if(!gate?.beginDrain||!gate?.cancelDrain||!gate?.readDrain||!ledger?.reserve||
     !ledger?.rollbackUnissuedInitial||typeof verifyDrain!=='function'||
     typeof verifyRollback!=='function'||typeof startWorker!=='function')return hold('adapters_unavailable');
  const {sourceId,channelId,engineId,requestId}=request??{};
  if(![sourceId,requestId].every(x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x))||
     typeof channelId!=='string'||!/^[1-9][0-9]{0,14}$/.test(channelId)||!['hostbrr','linode'].includes(engineId))return hold('invalid_request');
  // If beginDrain throws, ownership is ambiguous: don't cancel another drain.
  try{if(!(await gate.beginDrain())?.ok)return hold('drain_not_acquired')}catch{return hold('drain_state_unknown')}
  const cancel=async reason=>{
   try{return (await gate.cancelDrain())?.ok?{ok:false,reason,restoredLegacy:true}:hold('cancel_unconfirmed')}
   catch{return hold('cancel_unconfirmed')}
  };
  let snapshot,proof;
  try{
   snapshot=await gate.readDrain({includeOpenHoldIds:true});
   if(snapshot?.ok!==true||snapshot.mode!=='draining'||!Array.isArray(snapshot.openHoldIds))return cancel('drain_snapshot_unavailable');
   proof=await verifyDrain({sourceId,drainStartedAt:snapshot.drainStartedAt});
   if(!proof)return cancel('drain_unconfirmed');
  }catch{return cancel('drain_unconfirmed')}
  let reserved;
  try{
   reserved=await ledger.reserve({sourceId,channelId,engineId,requestId,initialDrain:{proof,openHoldIds:snapshot.openHoldIds}});
  }catch{return hold('reservation_commit_unknown')}
  if(!reserved?.ok)return cancel(reserved?.reason??'reservation_denied');
  if(reserved.action!=='start_once'||!reserved.reservationId)return hold('reservation_state_unknown');
  const identity={sourceId,channelId,engineId,reservationId:reserved.reservationId};
  let started;
  try{started=await startWorker(identity)}catch{return hold('worker_start_unknown')}
  if(started?.ok===true&&started.action==='feed_ready'&&Object.keys(identity).every(k=>started[k]===identity[k]))return {ok:true,action:'feed_ready',...identity};
  // A negative or timed-out start is not release proof. Roll back only when
  // the independent verifier and the DB confirm that no lease was issued.
  try{
   const releaseProof=await verifyRollback(identity);
   if(!releaseProof)return hold('worker_release_unconfirmed');
   const result=await ledger.rollbackUnissuedInitial({...identity,proof:releaseProof});
   return result?.ok?{ok:false,reason:'worker_not_ready',restoredLegacy:true}:hold('worker_release_unconfirmed');
  }catch{return hold('worker_release_unconfirmed')}
 };
}

// Internal only. No public request or heartbeat can certify provider release.
// The worker adapter must authenticate a stop-and-fence operation for the
// exact reservation, and the independent capacity authority must cover all
// paths (or an exclusively licensed pool). Neither adapter is wired here.
const hold=reason=>({ok:false,action:'hold',reason});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const valid=x=>typeof x==='string'&&uuid.test(x);
const bounded=async(fn,ms)=>{
 const c=new AbortController();let timer;
 try{return await Promise.race([Promise.resolve().then(()=>fn(c.signal)),new Promise((_,reject)=>{
  timer=setTimeout(()=>{c.abort();reject(Error('timeout'));},ms)
 })]);}finally{clearTimeout(timer)}
};
export function createEngineReleaseCoordinator({ledger,workers,capacity,env=process.env,clock=Date.now,timeoutMs=20000}={}){
 return async function release(input){
  if(env.BLOFY_ENGINE_RELEASE_COORDINATOR!=='1')return hold('disabled');
  const {sourceId,reservationId,engineId,channelId}=input??{};
  if(!valid(sourceId)||sourceId!==env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID||!valid(reservationId)||
     !['linode','hostbrr'].includes(engineId)||typeof channelId!=='string'||!/^[1-9][0-9]{0,14}$/.test(channelId))
   return hold('invalid_reservation');
  const worker=workers?.[engineId];
  if(typeof worker?.stopAndFence!=='function'||typeof capacity?.observe!=='function')return hold('adapter_unavailable');
  const ids={sourceId,reservationId,engineId};
  const ms=Math.min(30000,Math.max(1,timeoutMs));
  // Mark uncertain before stopping so no additional viewer grants can attach.
  // A ledger already in unknown is intentionally not auto-released by this
  // routine; reconciliation requires a separate trusted operator procedure.
  try{const r=await ledger.transition({...ids,next:'unknown'});
   if(!r?.ok||r.state!=='unknown')return hold('fence_not_committed');
  }catch{return hold('fence_outcome_unknown')}
  let proof,observed;
  const started=clock();
  try{proof=await bounded(signal=>worker.stopAndFence({...ids,channelId,signal}),ms)}
  catch{return hold('stop_outcome_unknown')}
  const matches=p=>p?.sourceId===sourceId&&p?.reservationId===reservationId&&p?.engineId===engineId;
  const fresh=(p,after)=>{const t=Date.parse(p?.observedAt);return Number.isFinite(t)&&t>=after&&t>=clock()-10000&&t<=clock()+5000};
  if(!matches(proof)||proof.channelId!==channelId||proof.status!=='stopped_and_fenced'||proof.localSourceConnections!==0||!fresh(proof,started))
   return hold('stop_proof_invalid');
  try{observed=await bounded(signal=>capacity.observe({...ids,signal}),ms)}
  catch{return hold('provider_outcome_unknown')}
  if(!matches(observed)||!['all_paths','dedicated_licensed_pool'].includes(observed.scope)||
    observed.authoritative!==true||observed.activeConnections!==0||observed.maxConnections!==1||
    !fresh(observed,Date.parse(proof.observedAt)))return hold('provider_release_unconfirmed');
  try{const r=await ledger.transition({...ids,next:'released',releaseConfirmed:true});
   if(!r?.ok||r.state!=='released')return hold('release_not_committed');
  }catch{return hold('release_outcome_unknown')}
  return {ok:true,action:'released',...ids};
 };
}

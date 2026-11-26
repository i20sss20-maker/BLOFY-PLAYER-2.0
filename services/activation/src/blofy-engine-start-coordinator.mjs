import {decideLinodeAdmission} from './linode-media-admission.mjs';
const hold=reason=>({ok:false,action:'hold',reason});
const generation=/^[a-f0-9]{32}$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const timeout=async(fn,ms)=>{
 const c=new AbortController();let timer;
 try{return await Promise.race([Promise.resolve().then(()=>fn(c.signal)),new Promise((_,reject)=>{
  timer=setTimeout(()=>{c.abort();reject(Error('worker_timeout'));},ms);
 })]);}finally{clearTimeout(timer);}
};
// Private orchestration contract. A caller MUST supply authenticated, persisted
// attempt state, authoritative source capacity and a trusted worker adapter.
// This module does not create either the worker transport or capacity authority.
export function createEngineStartCoordinator({ledger,workers,env=process.env,clock=Date.now,timeoutMs=20000}={}){
 return async function start(input){
  if(env.BLOFY_ENGINE_START_COORDINATOR!=='1')return hold('disabled');
  const engineId=input?.context?.engineId??'linode';
  if(!['linode','hostbrr'].includes(engineId))return hold('engine_invalid');
  const worker=workers?.[engineId];
  if(typeof worker?.start!=='function')return hold('worker_unavailable');
  const admission=decideLinodeAdmission(input,env,clock());
  if(admission.action!=='reserve')return hold(admission.reason??'not_new_reservation');
  const {sourceId,channelId,requestId,expiresAt}=admission;
  let reservation;
  try{reservation=await ledger.reserve({sourceId,channelId,requestId,engineId});}
  catch{return hold('reservation_outcome_unknown');}
  if(!reservation?.ok)return hold(reservation?.reason??'reservation_denied');
  if(!uuid.test(reservation.reservationId??''))return hold('reservation_invalid');
  const ids={sourceId,reservationId:reservation.reservationId,engineId};
  // Replays never dispatch another start even if the first response was lost.
  if(reservation.action!=='start_once'||reservation.state!=='pending')return hold('reservation_already_exists');
  async function uncertain(reason){
   try{await ledger.transition({...ids,next:'unknown'});}catch{}
   return hold(reason);
  }
  // Do not dispatch after the admission snapshot or authorization goes stale.
  if(decideLinodeAdmission(input,env,clock()).action!=='reserve'||Date.parse(expiresAt)<=clock())
   return uncertain('authorization_stale');
  let proof;
  try{proof=await timeout(signal=>worker.start({...ids,channelId,requestId,expiresAt,signal}),Math.min(30000,Math.max(1,timeoutMs)));}
  catch{return uncertain('worker_outcome_unknown');}
  const now=clock(),observed=Date.parse(proof?.observedAt);
  if(proof?.status!=='private_hls_ready'||proof.engineId!==engineId||
     proof.sourceId!==sourceId||proof.channelId!==channelId||proof.reservationId!==ids.reservationId||
     proof.requestId!==requestId||proof.realSourceVerified!==true||
     !generation.test(proof.generation??'')||!Number.isFinite(observed)||
     observed<now-10000||observed>now+5000||Date.parse(expiresAt)<=now)
   return uncertain('worker_proof_invalid');
  try{
   const ready=await ledger.transition({...ids,next:'ready',generation:proof.generation});
   if(!ready?.ok||ready.state!=='ready')return uncertain('ready_not_committed');
  }catch{return uncertain('ready_outcome_unknown');}
  return {ok:true,action:'feed_ready',engineId,sourceId,channelId,reservationId:ids.reservationId,generation:proof.generation};
 };
}

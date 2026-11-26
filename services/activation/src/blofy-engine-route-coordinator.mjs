// Internal orchestration only; no HTTP endpoints or production wiring.
// An authenticated, durable operation claim is required before any side effect.
// Adapters must enforce idempotency and transactional source reservation.
import {planEngineRoute} from './blofy-engine-route-plan.mjs';
export function createEngineRouteCoordinator({claims,ledger,readSnapshot,start,release,attach,enabled=false,clock=Date.now}={}){
 return async function route(request){
  const hold=reason=>({ok:false,action:'hold',reason});
  if(!enabled)return hold('disabled');
  if(typeof request?.requestId!=='string'||!request.requestId||typeof request?.sourceId!=='string'||!request.sourceId)return hold('invalid_request');
  if(!claims?.claim||!claims?.finish||typeof ledger?.readRoutingState!=='function'||typeof readSnapshot!=='function')return hold('adapters_unavailable');
  let claim;
  try{claim=await claims.claim({requestId:request.requestId,sourceId:request.sourceId});}catch{return hold('claim_unknown')}
  if(claim?.acquired!==true||typeof claim.token!=='string'||!claim.token)return hold('already_claimed');
  const finish=async(result)=>{
   try{if(await claims.finish({token:claim.token,result})!==true)return hold('completion_unknown');}
   catch{return hold('completion_unknown')}
   return result;
  };
  try{
   const evidence=await readSnapshot(request);
   // Always obtain reservation state from the authoritative ledger, never
   // from the telemetry snapshot or a public request.
   const feed=await ledger.readRoutingState({sourceId:request.sourceId});
   const plan=planEngineRoute({...evidence,feed,request,enabled:true,now:clock()});
   if(plan.action==='hold')return finish(hold(plan.reason));
   if(plan.action==='request_fenced_release'){
    if(typeof release!=='function')return finish(hold('release_unavailable'));
    const r=await release({sourceId:request.sourceId,channelId:request.channelId,engineId:plan.engineId,reservationId:plan.reservationId});
    // Never start a competing feed in the same attempt. A new request must
    // read fresh authoritative capacity and the committed released ledger.
    return finish(r?.ok===true&&r.action==='released'&&r.sourceId===request.sourceId&&r.engineId===plan.engineId&&r.reservationId===plan.reservationId?{ok:false,action:'retry_with_fresh_snapshot'}:hold('release_unconfirmed'));
   }
   if(plan.action==='request_reservation'){
    if(typeof start!=='function')return finish(hold('start_unavailable'));
    const r=await start({request,engineId:plan.engineId});
    if(r?.ok!==true||r.action!=='feed_ready'||r.sourceId!==request.sourceId||r.channelId!==request.channelId||r.engineId!==plan.engineId)return finish(hold('start_unconfirmed'));
    // Attaching viewers is a separate authorized, atomic operation.
    return finish({ok:true,action:'feed_ready',engineId:r.engineId,reservationId:r.reservationId});
   }
   if(plan.action==='reuse'){
    if(typeof attach!=='function')return finish(hold('attach_unavailable'));
    const r=await attach({request,engineId:plan.engineId,reservationId:plan.reservationId,generation:plan.generation});
    return finish(r?.ok===true?{ok:true,action:'attached',engineId:plan.engineId,reservationId:plan.reservationId}:hold('attach_unconfirmed'));
   }
   return finish(hold('invalid_plan'));
  }catch{
   // Do not clear or retry a claim after ambiguous external execution.
   return hold('execution_unknown');
  }
 };
}

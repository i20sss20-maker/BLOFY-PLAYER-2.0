import {signedLinodePlayback} from './linode-signed-hls.mjs';
import {preflightLinodeLive} from './linode-media-canary-preflight.mjs';
const hold=reason=>({ok:false,action:'hold',reason});
// Internal control-plane operation only. Caller must load authenticated account,
// catalog, capacity, reservation and worker evidence from trusted storage.
// No source socket, worker start, or fallback is performed here.
export function createEngineViewerGrant(ledger,env=process.env,clock=Date.now){
 return async function issue({sessionId,...input}={}){
  if(env.BLOFY_ENGINE_VIEWER_GRANT!=='1')return hold('disabled');
  const now=clock();
  const pre=preflightLinodeLive(input.context,env,now);
  if(!pre.eligible)return hold('preflight_denied');
  const proposed=signedLinodePlayback(input,env,now);
  if(!proposed.ok)return hold(proposed.reason);
  if(typeof sessionId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(sessionId))
   return hold('invalid_session');
  let lease;
  try{
   lease=await ledger.attachViewer({
    sourceId:pre.sourceId,reservationId:input.attempt.reservationId,
    channelId:pre.channelId,generation:input.worker.generation,sessionId,
    accountId:pre.accountId,accountQuota:pre.accountQuota,
    authorizedUntil:proposed.expiresAt,engineId:input.context.engineId??'linode'
   });
  }catch{return hold('lease_outcome_unknown');}
  if(!lease?.ok||lease.sessionId!==sessionId||lease.reservationId!==input.attempt.reservationId)
   return hold('lease_not_committed');
  const expires=Date.parse(lease.expiresAt);
  if(!Number.isFinite(expires))return hold('lease_expiry_invalid');
  const bounded={...input,attempt:{...input.attempt,expiresAt:new Date(Math.min(expires,Date.parse(proposed.expiresAt))).toISOString()}};
  // Check freshness again after the database round-trip; never issue a URL
  // that outlives either the signed authorization or the committed lease.
  const grant=signedLinodePlayback(bounded,env,clock());
  if(!grant.ok||Date.parse(grant.expiresAt)>expires)return hold('grant_not_current');
  return {ok:true,action:'signed_hls',sessionId,mediaHost:grant.mediaHost,path:grant.path,expiresAt:grant.expiresAt};
 };
}

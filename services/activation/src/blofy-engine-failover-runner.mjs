// Internal, default-off failover orchestration. Only an authenticated caller
// may supply route and renewAuthorization. No provider or worker calls here.
// The existing route coordinator commits and verifies release before returning
// retry_with_fresh_snapshot; it must read the ledger again on the next call.
const hold=reason=>({ok:false,action:'hold',reason});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const valid=(r,now)=>r?.authorized===true&&uuid.test(r.requestId??'')&&
 uuid.test(r.sourceId??'')&&uuid.test(r.accountId??'')&&
 typeof r.channelId==='string'&&/^[1-9][0-9]{0,14}$/.test(r.channelId)&&
 Number.isSafeInteger(r.expiresAt)&&r.expiresAt>now;
export function createEngineFailoverRunner({route,renewAuthorization,enabled=false,clock=Date.now}={}){
 return async function run(input){
  if(!enabled)return hold('failover_disabled');
  if(typeof route!=='function'||typeof renewAuthorization!=='function')return hold('failover_adapters_unavailable');
  if(!valid(input,clock()))return hold('request_unauthorized');
  // Freeze the identity before passing anything to injected adapters.
  const original=Object.freeze({...input});
  let first;
  try{first=await route(original)}catch{return hold('route_outcome_unknown')}
  if(first?.ok!==false||first.action!=='retry_with_fresh_snapshot')return first??hold('route_outcome_unknown');
  if(!valid(original,clock()))return hold('authorization_expired_after_release');
  let next;
  try{next=await renewAuthorization(original)}catch{return hold('reauthorization_unavailable')}
  if(!valid(next,clock())||next.requestId===original.requestId||
     ['sourceId','channelId','accountId'].some(k=>next[k]!==original[k]))
   return hold('reauthorization_invalid');
  // At most one second routing attempt. Never retry on ambiguous execution,
  // never reuse an operation claim, never force the standby, and never
  // bypass the ledger's independently verified provider-capacity check.
  try{
   const result=await route(Object.freeze({...next}));
   if(result?.action==='retry_with_fresh_snapshot')return hold('failover_retry_budget_exhausted');
   return result??hold('route_outcome_unknown');
  }catch{return hold('route_outcome_unknown')}
 };
}

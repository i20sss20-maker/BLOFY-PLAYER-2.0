// Bounded operator advice; does not mutate streams, subscriber state or providers.
// Never auto-retry a source that has denied restreaming or a concurrency limit.
const DENIALS=new Set(['upstream_http_403','upstream_http_429','upstream_http_456',
  'upstream_denial_cooldown','gateway_auth_denied']);
const MISSING=new Set(['upstream_http_404','catalog_item_unavailable']);
const NETWORK=new Set(['upstream_unreachable','headers_timeout','media_read_timeout',
 'upstream_http_502','upstream_http_503','upstream_http_504']);
export function playbackRecoveryAdvice({reason='',attempts=0,hasAuthorizedBackup=false}={}){
 const code=String(reason);
 const retries=Number.isInteger(attempts)?Math.max(0,attempts):0;
 if(DENIALS.has(code))return {class:'provider_or_auth_denial',
   action:'operator_review',automaticRetry:false,allowFailover:false};
 if(MISSING.has(code))return {class:'missing_media',
   action:'operator_review',automaticRetry:false,allowFailover:false};
 if(NETWORK.has(code)){
  if(hasAuthorizedBackup===true)return {class:'transient_network',
   action:'backup_candidate_review',automaticRetry:false,allowFailover:false};
  return {class:'transient_network',action:retries>=2?'cooldown':'observe_and_retry_on_next_request',
    automaticRetry:false,allowFailover:false};
 }
 if(code==='upstream_non_media_response'||code==='upstream_empty_media')
  return {class:'invalid_media',action:'operator_review',automaticRetry:false,allowFailover:false};
 return {class:'unknown',action:'collect_diagnostics',automaticRetry:false,allowFailover:false};
}
export function summarizeRecoveryAdvice(issues=[]){
 if(!Array.isArray(issues))return {issues:[],counts:{}};
 const counts=Object.create(null);
 const mapped=issues.slice(0,12).map(issue=>{
  const advice=playbackRecoveryAdvice({reason:issue?.reason,attempts:issue?.attempts});
  counts[advice.class]=(counts[advice.class]||0)+1;
  return {kind:['live','movie','series'].includes(issue?.kind)?issue.kind:'unknown',
   reason:typeof issue?.reason==='string'&&/^[a-z0-9_]{1,64}$/.test(issue.reason)?issue.reason:'unknown',
   class:advice.class,action:advice.action,automaticRetry:false};
 });
 return {issues:mapped,counts};
}

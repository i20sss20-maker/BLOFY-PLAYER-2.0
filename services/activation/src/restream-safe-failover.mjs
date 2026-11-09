// Failover decision engine only: does NOT fetch media or perform switching.
// Caller must verify operator authorization and contractual rights for both
// source accounts. Provider account denial MUST NOT be bypassed by failover.
const PROVIDER_DENIALS=new Set(['upstream_http_401','upstream_http_403',
 'upstream_http_429','upstream_http_456','upstream_denial_cooldown',
 'gateway_auth_denied','restream_not_allowed','connection_limit','account_expired']);
const TRANSIENT=new Set(['upstream_http_502','upstream_http_503',
 'upstream_http_504','headers_timeout','media_read_timeout','upstream_unreachable']);
export function evaluateSafeFailover({primaryFailure,consecutiveFailures=0,
 backupHealthy=false,backupRightsConfirmed=false,operatorApproved=false,
 currentViewers=0,cutoverSupportsExistingSessions=false}={}){
 const reason=String(primaryFailure||'');
 if(PROVIDER_DENIALS.has(reason))
  return {eligible:false,reason:'provider_denied',action:'review_source_access'};
 if(!TRANSIENT.has(reason))
  return {eligible:false,reason:'not_transient',action:'diagnose_first'};
 if(!Number.isInteger(consecutiveFailures)||consecutiveFailures<3)
  return {eligible:false,reason:'failure_threshold_not_met',action:'observe'};
 if(backupRightsConfirmed!==true)
  return {eligible:false,reason:'backup_rights_missing',action:'verify_rights'};
 if(backupHealthy!==true)
  return {eligible:false,reason:'backup_not_healthy',action:'verify_backup'};
 if(operatorApproved!==true)
  return {eligible:false,reason:'operator_approval_required',action:'review_cutover'};
 if(currentViewers>0&&cutoverSupportsExistingSessions!==true)
  return {eligible:false,reason:'active_sessions_not_migratable',action:'drain_first'};
 return {eligible:true,reason:'approved_transient_failover',
  action:'execute_in_separate_transaction',automaticSwitch:false};
}
// Never send credentials or URLs in a decision response.
export function safeFailoverAudit(decision){
 return {eligible:decision?.eligible===true,
  reason:typeof decision?.reason==='string'?decision.reason:'unknown',
  action:typeof decision?.action==='string'?decision.action:'diagnose_first',
  automaticSwitch:false};
}

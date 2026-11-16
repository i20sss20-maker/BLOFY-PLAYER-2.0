// Conservative in-process source cooldown for private mirror copies.
// This NEVER interrupts customer playback. No provider requests, token,
// URL, customer IP, credential or raw exception message is recorded.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RISKS=new Set([
 'xtream_transport_connection_reset','connection_reset',
 'upstream_unreachable','headers_timeout','media_read_timeout',
 'timeout','mirror_range_incomplete','mirror_range_overlong',
 'upstream_empty_media'
]);
const WINDOW_MS=30*60*1000;
export function createMirrorSourceTransportGuard({
 now=Date.now,maxSources=128,cooldownMs=WINDOW_MS
}={}){
 if(typeof now!=='function'||!Number.isSafeInteger(maxSources)||
    maxSources<1||maxSources>1024||!Number.isSafeInteger(cooldownMs)||
    cooldownMs<60000||cooldownMs>24*60*60*1000)
  throw Error('mirror_transport_guard_invalid_configuration');
 const failures=new Map();
 let saturated=false;
 function recordFailure({sourceId,reason}={}){
  const id=String(sourceId||'').toLowerCase();
  if(!UUID.test(id)||!RISKS.has(reason))
   return {recorded:false,code:'mirror_transport_signal_ignored'};
  const at=now();
  if(!Number.isSafeInteger(at)||at<0)
   return {recorded:false,code:'mirror_transport_clock_invalid'};
  // Retain bounded telemetry in process memory. Once at capacity,
  // fail closed rather than dropping an active source's risk history.
  for(const [key,entry] of failures){
   if(at-entry.at>cooldownMs)failures.delete(key);
  }
  if(!failures.has(id)&&failures.size>=maxSources){
   saturated=true;
   return {recorded:false,code:'mirror_transport_guard_saturated'};
  }
  const prev=failures.get(id);
  failures.set(id,{at,count:Math.min(1000,(prev?.count||0)+1)});
  return {recorded:true,code:'mirror_transport_copy_paused',
   noCustomerPlaybackChange:true};
 }
 function snapshot({sourceId}={}){
  const id=String(sourceId||'').toLowerCase(),at=now();
  if(!UUID.test(id)||!Number.isSafeInteger(at)||at<0)
   return {ok:false,code:'mirror_transport_risk_unknown',
    sourceMediaRequests:0,customerCutover:false,
    scope:'this_portal_process_only',otherReplicasMeasured:false};
  if(saturated)return {ok:false,code:'mirror_transport_risk_unreliable',
   sourceMediaRequests:0,customerCutover:false,
   scope:'this_portal_process_only',otherReplicasMeasured:false};
  const failure=failures.get(id);
  const age=failure?at-failure.at:null;
  const active=age!==null&&age>=0&&age<=cooldownMs;
  if(failure&&!active)failures.delete(id);
  return {ok:!active,
   code:active?'mirror_transport_cooldown_active':
    'mirror_transport_no_recent_local_failure',
   remainingMs:active?cooldownMs-age:0,
   recentFailureCount:active?failure.count:0,
   sourceMediaRequests:0,customerCutover:false,
   scope:'this_portal_process_only',
   otherReplicasMeasured:false,upstreamHealthProven:false,
   monitoredFailureWindowMs:cooldownMs};
 }
 return {recordFailure,snapshot};
}
export const mirrorSourceTransportGuard=createMirrorSourceTransportGuard();

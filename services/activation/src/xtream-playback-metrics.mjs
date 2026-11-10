import { validXtreamDenialHint } from './xtream-provider-denial.mjs';

// Bounded in-process metrics for the real BLOFY XTREAM media relay.
// Never store subscriber names, credentials, provider URLs, client IPs, or raw errors.
const samples=[];
const WINDOW_MS=60*60*1000;
const MAX_SAMPLES=400;
const KINDS=new Set(['live','movie','series']);
const PHASES=new Set(['started','failed','interrupted','ended','client_closed']);
const REASONS=new Set([
  'upstream_http_403','upstream_http_404','upstream_http_408','upstream_http_429','upstream_http_456',
  'upstream_http_500','upstream_http_502','upstream_http_503','upstream_http_504',
  'upstream_http_other','headers_timeout','media_read_timeout','upstream_empty_media',
  'upstream_non_media_response','upstream_unreachable','upstream_denial_cooldown',
  'gateway_auth_denied','catalog_item_unavailable',
  'upstream_stream_ended','client_or_proxy_closed','xtream_transport_connection_reset'
]);

export function recordXtreamPlayback({kind,phase,upstreamStatus,reason,providerHint,startupMs,attempts,itemId,sourceId,durationMs}={},now=Date.now()){
  if(!KINDS.has(kind)||!PHASES.has(phase))return;
  const safeStatus=Number.isInteger(Number(upstreamStatus))&&Number(upstreamStatus)>=100&&Number(upstreamStatus)<=599
    ?Number(upstreamStatus):null;
  const safeReason=REASONS.has(reason)?reason:'';
  const time=Number.isFinite(now)?now:Date.now();
  const parsedId=Number(itemId);
  const safeId=/^[1-9][0-9]{0,14}$/.test(String(itemId??''))&&Number.isSafeInteger(parsedId)?parsedId:null;
  const safeSourceId=typeof sourceId==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27,28}$/i.test(sourceId)?sourceId:null;
  const safeDuration=Number.isFinite(durationMs)&&durationMs>=0?Math.min(Math.round(durationMs),86400000):null;
  samples.push({
    at:time,kind,phase,itemId:safeId,sourceId:safeSourceId,durationMs:safeDuration,
    status:safeStatus,reason:safeReason,
    ...(validXtreamDenialHint(providerHint)?{providerHint:validXtreamDenialHint(providerHint)}:{}),
    startupMs:Number.isFinite(startupMs)&&startupMs>=0?Math.min(Math.round(startupMs),120000):null,
    attempts:Number.isInteger(attempts)?Math.min(Math.max(attempts,1),3):null
  });
  // Prune old records and cap memory even when a player floods the server.
  const threshold=time-WINDOW_MS;
  while(samples.length&&(samples[0].at<threshold||samples.length>MAX_SAMPLES))samples.shift();
}

export function xtreamPlaybackSnapshot(now=Date.now(),sourceId=null){
  const events=samples.filter(row=>row.at>=now-WINDOW_MS&&row.at<=now&&
    (sourceId===null||row.sourceId===sourceId));
  const started=events.filter(row=>row.phase==='started');
  const failed=events.filter(row=>row.phase==='failed');
  const interrupted=events.filter(row=>row.phase==='interrupted');
  const ended=events.filter(row=>row.phase==='ended');
  const clientClosed=events.filter(row=>row.phase==='client_closed');
  const times=started.map(row=>row.startupMs).filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile=percent=>times.length?times[Math.ceil(percent*times.length)-1]:null;
  const kindSummary=Object.fromEntries([...KINDS].map(kind=>[kind,{
    started:started.filter(row=>row.kind===kind).length,
    failed:failed.filter(row=>row.kind===kind).length,
    interrupted:interrupted.filter(row=>row.kind===kind).length,
    ended:ended.filter(row=>row.kind===kind).length,
    clientClosed:clientClosed.filter(row=>row.kind===kind).length
  }]));
  const upstreamCodes={};
  for(const event of [...failed,...interrupted]){
    if(event.status&&event.status>=400){
      const key=String(event.status);
      upstreamCodes[key]=(upstreamCodes[key]||0)+1;
    }
  }
  return {
    windowMinutes:60,
    scope:'this_instance',
    started:started.length,
    failed:failed.length,
    interrupted:interrupted.length,
    upstreamEnded:ended.length,
    clientOrProxyClosed:clientClosed.length,
    shortLiveUpstreamEnds:[...ended,...interrupted].filter(row=>row.kind==='live'&&
      row.durationMs!==null&&row.durationMs>=5000&&row.durationMs<=35000).length,
    gatewayAuthDenied:failed.filter(row=>row.reason==='gateway_auth_denied').length,
    unavailableItems:failed.filter(row=>row.reason==='catalog_item_unavailable').length,
    upstreamFailed:failed.filter(row=>row.reason!=='gateway_auth_denied'&&row.reason!=='catalog_item_unavailable').length,
    slowStarts:started.filter(row=>row.startupMs!==null&&row.startupMs>6000).length,
    medianStartMs:percentile(0.5),
    p95StartMs:percentile(0.95),
    byKind:kindSummary,
    upstreamCodes,
    recentIssues:[...failed,...interrupted,...ended].sort((a,b)=>b.at-a.at).slice(0,12).map(row=>({
      at:new Date(row.at).toISOString(),
      kind:row.kind,
      itemId:row.itemId,
      phase:row.phase,
      durationMs:row.durationMs,
      upstreamStatus:row.status,
      reason:row.reason,
      ...(row.providerHint?{providerHint:row.providerHint}:{}),
      attempts:row.attempts
    }))
  };
}

export function resetXtreamPlaybackMetricsForTest(){samples.length=0;}

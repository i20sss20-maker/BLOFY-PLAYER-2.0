// Sanitized, operator-only interpretation of in-process live playback events.
// Does not read customer identities or claim a one-replica sample covers all viewers.
export function summarizeXtreamLiveStability(metrics={},sourceInfo={}){
 const positiveInt=n=>Number.isSafeInteger(Number(n))&&Number(n)>0?Number(n):0;
 const live=metrics?.byKind?.live||{};
 const started=positiveInt(live.started);
 const drops=positiveInt(metrics.liveTsSourceDrops);
 const recovered=positiveInt(metrics.liveTsRecoverySuccesses);
 const earlyEnds=positiveInt(metrics.shortLiveUpstreamEnds);
 const clientCloses=positiveInt(live.clientClosed);
 const failed=positiveInt(live.failed)+positiveInt(live.interrupted);
 const limit=positiveInt(sourceInfo?.maxConnections);
 const active=positiveInt(sourceInfo?.activeConnections);
 const providerDenied=Object.keys(metrics.upstreamCodes||{}).some(code=>
   ['401','403','429','456','509'].includes(code)&&
   positiveInt(metrics.upstreamCodes[code])>0);
 const findings=[];
 if(limit>0&&active>=limit)findings.push('provider_limit');
 if(providerDenied)findings.push('provider_denials');
 if(drops>0)findings.push('source_drops');
 if(earlyEnds>0)findings.push('short_ends');
 if(clientCloses>0)findings.push('client_closures');
 if(sourceInfo?.isRestreamer===false)
   findings.push('provider_restream_not_confirmed');
 if(started<3&&!drops&&!failed)findings.push('insufficient_samples');
 return {
  status:drops>0||failed>0?'instability_observed':
    started>=3?'no_error_in_limited_sample':'insufficient_sample',
  findings,
  sourceReported:{maxConnections:limit||null,
    activeConnections:sourceInfo?.activeConnections==null?null:active,
    restreamerDeclared:sourceInfo?.isRestreamer===true},
  metrics:{started,liveTsSourceDrops:drops,liveTsRecoverySuccesses:recovered,
    shortLiveUpstreamEnds:earlyEnds,clientOrProxyClosed:clientCloses,
    failed,upstreamEnded:positiveInt(live.ended)}
 };
}

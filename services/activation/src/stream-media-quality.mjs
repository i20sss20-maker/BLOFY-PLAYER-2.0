// Operator-only, per-process streaming quality summary. No individual
// item IDs, source credentials, account names, URLs, cookies, or IPs.
const KINDS=['live','movie','series'];
const asCount=x=>Number.isFinite(Number(x))&&Number(x)>=0?
  Math.min(10000000,Math.trunc(Number(x))):0;
const allowedReasons=new Set([
 'upstream_http_403','upstream_http_404','upstream_http_408','upstream_http_429',
 'upstream_http_456','upstream_http_500','upstream_http_502','upstream_http_503',
 'upstream_http_504','upstream_http_other','headers_timeout','media_read_timeout',
 'upstream_empty_media','upstream_non_media_response','upstream_unreachable',
 'upstream_denial_cooldown','gateway_auth_denied','catalog_item_unavailable',
 'licensed_fanout_unavailable','upstream_stream_ended','client_or_proxy_closed',
 'xtream_transport_connection_reset'
]);
export function summarizeStreamMediaQuality(raw={},now=Date.now()){
 const byKind={};
 for(const k of KINDS){
  const r=raw?.byKind?.[k]||{};
  const started=asCount(r.started),failed=asCount(r.failed),
    interrupted=asCount(r.interrupted),closed=asCount(r.clientClosed);
  byKind[k]={started,failed,interrupted,closed,
    errorPercent:started+failed?Math.round(100*failed/(started+failed)):null,
    verifiedPlayback:false};
 }
 const recent={};
 for(const item of Array.isArray(raw.recentIssues)?raw.recentIssues.slice(0,60):[]){
  const key=String(item?.reason||'');
  if(allowedReasons.has(key))recent[key]=(recent[key]||0)+1;
 }
 const p95=Number.isFinite(raw.p95StartMs)?asCount(raw.p95StartMs):null;
 const median=Number.isFinite(raw.medianStartMs)?asCount(raw.medianStartMs):null;
 const slowStarts=asCount(raw.slowStarts);
 const summary={ok:true,scope:'this_instance',
   windowMinutes:60,checkedAt:new Date(now).toISOString(),
   decodedOnClient:false,sourceCredentialsExposed:false,
   started:asCount(raw.started),failed:asCount(raw.failed),
   interrupted:asCount(raw.interrupted),slowStarts,medianStartMs:median,
   p95StartMs:p95,byKind,byReason:recent,
   shortLiveUpstreamEnds:asCount(raw.shortLiveUpstreamEnds),
   clientClosed:asCount(raw.clientOrProxyClosed),
   sourceOutages:asCount(raw.upstreamFailed),
   providerCodes:Object.fromEntries(Object.entries(raw.upstreamCodes||{})
     .filter(([code,n])=>/^[45][0-9]{2}$/.test(code)&&Number.isFinite(Number(n)))
     .slice(0,25).map(([code,n])=>[code,asCount(n)]))};
 return summary;
}

// A pre-issue smoke test proves sampled media works now. It never certifies
// every title, and failed/untested sources must not get a "ready" verdict.
export const MAX_ISSUANCE_SOURCES=10;
export const PREFLIGHT_TTL_MS=90_000;

export function summarizeIssuancePreflight(sources){
  const list=Array.isArray(sources)?sources:[];
  const checks=list.flatMap(item=>Array.isArray(item.checks)?item.checks:[]);
  const media=checks.filter(check=>['live','movie','series'].includes(check.kind));
  const failures=checks.filter(check=>check.ok!==true);
  const eachSourceSampled=list.length>0&&list.every(source=>
    (source.checks||[]).some(check=>['live','movie','series'].includes(check.kind)));
  const passed=checks.length-failures.length;
  return {
    ready:list.length>0&&eachSourceSampled&&media.length>0&&failures.length===0,
    passed,failed:failures.length,mediaSampleCount:media.length,
    sourceCount:list.length,scope:'sampled_content_only'
  };
}

export function issuanceErrorReason(value){
  const s=String(value??'');
  if(/^xtream_gateway_upstream_(?:401|403|404|429|456|5\d\d)$/.test(s))
    return s.replace(/^xtream_gateway_/,'');
  if(s==='xtream_secret_decryption_failed'||s==='xtream_secret_invalid')
    return 'source_credentials_unreadable';
  if(['xtream_gateway_info_too_large','xtream_gateway_upstream_json_invalid',
      'xtream_gateway_redirect_invalid','xtream_gateway_redirect_loop',
      'xtream_private_host_blocked','xtream_host_unresolved'].includes(s))
    return 'source_api_unavailable';
  return 'source_unreachable';
}

/**
 * Transient fetch failures occasionally affect a single playable channel.
 * Retry only transport/timeouts and temporary 5xx. Explicit provider 403,
 * 404 and 456 must remain failures, not retry loops or fake readiness.
 */
export function shouldRetryIssuanceMedia({reason,httpStatus},remainingMs){
  const status=Number(httpStatus);
  const transient=reason==='timeout'||reason==='source_unreachable'||
    reason==='upstream_http_5xx'||[408,500,502,503,504].includes(status);
  return transient&&Number.isFinite(remainingMs)&&remainingMs>=3500;
}

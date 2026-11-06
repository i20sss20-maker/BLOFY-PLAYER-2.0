// Source probe summaries are intentionally free of upstream endpoints,
// usernames, passwords, item titles and account/stream identifiers.
const SAFE_REASONS=new Set([
  'no_imported_items','no_episode_info','no_playable_episodes',
  'series_response_invalid','series_response_too_large',
  'upstream_non_media_response','upstream_unreachable','empty_media',
  'timeout','redirect_invalid','xtream_private_host_blocked'
]);
export const MONITORED_MEDIA_TYPES=Object.freeze(['live','movie','series','episode']);

export function safeXtreamMonitorSample(kind,probe,now=Date.now()){
  if(!MONITORED_MEDIA_TYPES.includes(kind))throw new Error('xtream_monitor_kind_invalid');
  const checks=Array.isArray(probe?.checks)?probe.checks:[];
  const failed=checks.find(row=>!row?.ok)||checks[0]||null;
  const status=Number(failed?.httpStatus);
  const httpStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
  const raw=String(failed?.error||probe?.reason||'');
  const derived=/^xtream_http_([1-5][0-9]{2})$/.exec(raw);
  const reason=SAFE_REASONS.has(raw)?raw:derived?'upstream_http_'+derived[1]:null;
  const skipped=probe?.reason==='no_imported_items';
  return{kind,ok:!skipped&&Boolean(probe?.ok),skipped,
    httpStatus:httpStatus||(derived?Number(derived[1]):null),
    reason:skipped?'no_imported_items':reason||(!probe?.ok?'probe_failed':null),
    checkedAt:now};
}
export function pickXtreamMonitorSource(servers,cursor=0){
  const eligible=Array.isArray(servers)?servers.filter(x=>x&&x.enabled&&x.publish_catalog&&!x.syncing):[];
  if(!eligible.length)return null;
  const position=Math.max(0,Math.floor(Number(cursor)||0))%eligible.length;
  return eligible[position];
}

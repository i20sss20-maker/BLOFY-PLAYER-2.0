// Read-only source capacity risk from the authoritative cached Xtream account
// snapshots and gateway account COUNTS. No provider/media requests, no writes.
// "active accounts" are NOT active playback sessions or permitted concurrent
// streams. Provider flags do not establish redistribution rights.
import {sourceLiveCapacity} from './xtream-live-source-capacity.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeCount=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0&&
  Number(value)<=10000000?Number(value):0;
function safeLabel(value,index){
  const label=String(value||'').trim();
  // A provider's "name" can itself be a URL or a leaked token; never echo it.
  if(!label||label.length>80||/(?:https?:|ftp:|@|(?:password|token|secret|api[_-]?key)\s*[:=]|[\\/?#])|\r|\n/i.test(label))
    return 'المصدر '+index;
  return label;
}
export function summarizeStreamSourceCapacity(
  sources=[],accountsBySource=null,{now=Date.now(),maxAgeMs=3600000,
    gatewayDirectMedia=null}={}
){
  if(!Array.isArray(sources)||!Number.isSafeInteger(now)||now<0||
      !Number.isInteger(maxAgeMs)||maxAgeMs<60000||maxAgeMs>86400000)
    throw Error('stream_capacity_report_invalid');
  const countsAvailable=Array.isArray(accountsBySource);
  const accounts=new Map();
  let unboundActiveAccounts=countsAvailable?0:null;
  if(countsAvailable){
    for(const item of accountsBySource.slice(0,1024)){
      const key=item?.source_id===null?'':String(item?.source_id||'');
      const v={total:safeCount(item?.total),active:safeCount(item?.active)};
      if(key==='')unboundActiveAccounts+=v.active;
      else if(UUID.test(key))accounts.set(key,v);
    }
  }
  // Gauges are for the current portal process only; active HTTP transfers
  // are not unique viewers, provider upstream sessions, edge or HLS requests.
  const gaugeAvailable=gatewayDirectMedia?.ok===true;
  const gaugeBySource=new Map();
  if(gaugeAvailable&&Array.isArray(gatewayDirectMedia.bySource)){
    for(const row of gatewayDirectMedia.bySource.slice(0,64)){
      const id=String(row?.sourceId||'').toLowerCase();
      if(UUID.test(id))gaugeBySource.set(id,{
        total:safeCount(row.activeDirectHttpTransfers),
        live:safeCount(row.activeDirectLiveHttpTransfers)
      });
    }
  }
  const seen=new Set(),items=[];
  let restricted=0,warning=0,unknown=0,okSnapshot=0;
  for(const source of sources.slice(0,60)){
    const id=String(source?.id||'');
    if(!UUID.test(id)||seen.has(id))continue;
    seen.add(id);
    const allowed=['online','offline','error','syncing','unknown'];
    const status=allowed.includes(source?.status)?source.status:'unknown';
    const freshAt=source?.lastTestAt;
    const lastTestAt=Number.isSafeInteger(freshAt)&&freshAt>0&&
       freshAt<=now?freshAt:null;
    const ageMs=lastTestAt!==null?now-lastTestAt:null;
    const fresh=ageMs!==null&&ageMs<=maxAgeMs;
    const details=sourceLiveCapacity(source.accountInfo);
    const flags=[];
    let level='snapshot_only';
    if(source.enabled!==true){flags.push('source_paused');level='paused';}
    else if(status!=='online'){flags.push('source_not_online');level='warning';}
    if(!fresh){flags.push('source_capacity_snapshot_stale_or_missing');level=
      level==='paused'?level:'unknown';}
    if(details.maxConnections===null){flags.push('source_upstream_limit_unknown');
      if(level==='snapshot_only')level='unknown';}
    if(details.restreamer===false){flags.push('source_restream_flag_false');
      if(level==='snapshot_only')level='warning';}
    if(fresh&&source.enabled===true&&details.maxConnections===0){
      flags.push('source_upstream_no_connections');level='restricted';
    }else if(fresh&&source.enabled===true&&details.maxConnections!==null&&
       details.activeConnections!==null&&
       details.activeConnections>=details.maxConnections){
      flags.push('source_upstream_reported_at_limit');level='restricted';
    }
    if(details.maxConnections===1&&source.enabled===true){
      flags.push('source_single_upstream_connection');
      if(level==='snapshot_only')level='warning';
    }
    if(level==='restricted')restricted++;
    else if(level==='warning')warning++;
    else if(level==='unknown')unknown++;
    else if(level==='snapshot_only')okSnapshot++;
    const assigned=accounts.get(id);
    const measured=gaugeBySource.get(id.toLowerCase());
    items.push({
      id,name:safeLabel(source.name,items.length+1),
      enabled:source.enabled===true,status,level,flags:flags.slice(0,8),
      lastTestAt,ageMs,providerSnapshotFresh:fresh,
      sourceReportedMaxConnections:details.maxConnections,
      sourceReportedActiveConnections:details.activeConnections,
      sourceReportsRestreamer:details.restreamer,
      activeGatewayAccounts:countsAvailable?(assigned?.active??0):null,
      totalGatewayAccounts:countsAvailable?(assigned?.total??0):null,
      activeDirectHttpMediaTransfers:gaugeAvailable?(measured?.total??0):null,
      activeDirectLiveHttpTransfers:gaugeAvailable?(measured?.live??0):null,
      // Counts are from accepted direct gateway responses only.
      directTransferSampleScope:'this_portal_process_direct_http_media_only',
      directTransferCountsReliable:gaugeAvailable?
        gatewayDirectMedia.countsReliable===true:null,
      // These fields explicitly guard against treating accounts as viewers.
      accountsAreNotConcurrentSessions:true,
      providerConnectionsAreSnapshotOnly:true,
      permissionNotIndependentlyVerified:true
    });
  }
  return {ok:true,readOnly:true,checkedAt:now,
    scope:'cached_provider_xtream_and_gateway_subscriptions_only',
    actualConcurrentViewersMeasured:false,
    playbackQualityVerified:false,
    redistributionRightsVerified:false,
    actionsTaken:0,
    metricsFreshnessWindowMs:maxAgeMs,
    sourceCount:items.length,truncated:sources.length>items.length,
    accountCountsAvailable:countsAvailable,
    directHttpTransferMeasurementAvailable:gaugeAvailable,
    directHttpTransferCountsReliable:gaugeAvailable?
      gatewayDirectMedia.countsReliable===true:null,
    activeDirectHttpMediaTransfers:gaugeAvailable?
      safeCount(gatewayDirectMedia.activeDirectHttpTransfers):null,
    activeDirectLiveHttpTransfers:gaugeAvailable?
      safeCount(gatewayDirectMedia.activeDirectLiveHttpTransfers):null,
    unboundActiveGatewayAccounts:unboundActiveAccounts,
    summary:{restricted,warning,unknown,providerSnapshotsWithinWindow:okSnapshot,
      monitoredSources:items.length},
    sources:items,
    warning:'Gateway subscriptions are not simultaneous player streams. Current direct HTTP transfers include only this portal process, not redirects/fanout, edge, HLS segments, other replicas or distinct viewers. Provider limits are cached, not a redistribution license.'};
}

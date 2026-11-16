// Read-only, fail-closed LIVE-risk gate before each source Range.
// Cached Xtream account limits and this Portal process' direct HTTP gauge
// are NOT a guarantee of all external sessions or actual copy rights.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SNAPSHOT_MS=10*60*1000;
const base={sourceMediaRequests:0,customerCutover:false,readOnly:true,
 writesStarted:false,licenseProvenByCapacity:false,
 allUpstreamSessionsMeasured:false,providerAccountSnapshotOnly:true};

export function assessMirrorSourceHeadroom(report,{
 sourceId,now=Date.now()
}={}){
 const blockedBy=[];
 if(!UUID.test(String(sourceId||''))||!Number.isSafeInteger(now))
  return {ok:false,code:'mirror_source_headroom_input_invalid',
   blockedBy:['mirror_headroom_scope_invalid'],...base};
 if(report?.ok!==true||report?.readOnly!==true||
    report?.directHttpTransferMeasurementAvailable!==true||
    report?.directHttpTransferCountsReliable!==true)
  blockedBy.push('mirror_direct_traffic_measurement_unreliable');
 const rows=Array.isArray(report?.sources)?
  report.sources.filter(row=>String(row.id)===String(sourceId)):[];
 const row=rows.length===1?rows[0]:null;
 if(!row||String(row.name||'').trim().toLowerCase()!=='saleh')
  blockedBy.push('mirror_source_not_exactly_identified');
 if(row?.enabled!==true||row?.status!=='online')
  blockedBy.push('mirror_source_not_online');
 if(!Number.isSafeInteger(row?.lastTestAt)||
    row.lastTestAt>now||now-row.lastTestAt>SNAPSHOT_MS)
  blockedBy.push('mirror_source_limits_stale');
 if(row?.sourceReportsRestreamer!==true)
  blockedBy.push('mirror_source_restream_permission_not_reported');
 const max=row?.sourceReportedMaxConnections;
 const active=row?.sourceReportedActiveConnections;
 // After opening one internal transfer, leave at least one additional
 // provider-reported connection free for customers.
 if(!Number.isSafeInteger(max)||max<2||
    !Number.isSafeInteger(active)||active<0||active>max||
    max-active<2)
  blockedBy.push('mirror_source_reserved_customer_headroom_missing');
 const current=row?.activeDirectHttpMediaTransfers;
 if(!Number.isSafeInteger(current)||current!==0)
  blockedBy.push('mirror_source_direct_http_media_busy');
 if(row?.directTransferCountsReliable!==true)
  blockedBy.push('mirror_source_direct_transfer_sample_unreliable');
 if(row?.providerSnapshotFresh!==true)
  blockedBy.push('mirror_source_provider_snapshot_not_fresh');
 return {...base,ok:blockedBy.length===0,
  code:blockedBy.length===0?'mirror_source_headroom_cautiously_clear':
   'mirror_source_headroom_blocked',
  blockedBy,sourceName:'saleh',
  sourceReportedMaxConnections:Number.isSafeInteger(max)?max:null,
  sourceReportedActiveConnections:Number.isSafeInteger(active)?active:null,
  sourceActiveDirectTransfers:Number.isSafeInteger(current)?current:null,
  remainingReportedConnections:(
   Number.isSafeInteger(max)&&Number.isSafeInteger(active)&&max>=active)?
   max-active:null,
  snapshotWindowMs:SNAPSHOT_MS,
  mirrorDownloadAuthorized:false,
  bandwidthAndOtherProviderSessionsStillUnmeasured:true};
}

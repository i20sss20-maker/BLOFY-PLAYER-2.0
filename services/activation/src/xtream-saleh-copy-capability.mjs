// Strictly bounded, read-only source probe: check whether one indexed saleh
// movie can return playable first bytes and standard HTTP Range metadata.
// Does NOT copy, mirror, transcode or persist any media. Never logs URLs,
// passwords, item IDs, source address, customers or response body.
const TYPES=['live','movie','series'];
function count(value){return Number.isSafeInteger(Number(value))?
  Math.max(0,Math.min(10000000,Number(value))):0;}
function status(value){return Number.isInteger(value)&&value>=100&&value<=599?value:null;}
export function safeSalehCopySample(result){
 const reason=String(result?.reason||'');
 const safeReason=['timeout','source_unreachable','upstream_empty_media',
   'catalog_item_not_found','bounded_media_test_unavailable',
   'unsupported_media','source_denied'].includes(reason)||
   /^upstream_http_[1-5][0-9]{2}$/.test(reason)
     ?reason:'probe_media_unverified';
 const code=result?.ok===true?'first_media_bytes_only':safeReason;
 const rangeSupported=result?.httpStatus===206||result?.rangeApplied===true;
 return {
  mediaSampleReadable:result?.ok===true,
  mediaFormat:['mp4','mkv','avi','ts','mpegts','unknown'].includes(result?.format)
    ?result.format:'other_or_unknown',
  httpStatus:status(result?.httpStatus),
  rangeAccepted:rangeSupported,
  fullDownloadVerified:false,
  completeFileCopied:false,
  sampleBytesOnly:true,
  elapsedMs:Math.max(0,Math.min(20000,count(result?.elapsedMs))),
  code:code||null
 };
}
export async function diagnoseSalehCatalogCopy({query,probeMovie}={}){
 if(typeof query!=='function'||typeof probeMovie!=='function')
  throw Error('copy_probe_invalid_dependency');
 const begin=Date.now();
 const source=await query(`SELECT id FROM blofy_xtream_servers
   WHERE lower(btrim(name))='saleh' AND enabled=TRUE AND publish_catalog=TRUE
     AND deletion_requested_at IS NULL LIMIT 2`);
 if(source.rows?.length!==1)
  return {ok:false,source:'saleh',code:'saleh_unique_enabled_source_missing',
    mediaRequestCount:0,customerTrafficChanged:false};
 const sourceId=source.rows[0].id;
 const totals=await query(`SELECT media_type,COUNT(*)::int AS total
   FROM blofy_xtream_items WHERE server_id=$1 AND enabled=TRUE
     AND media_type IN ('live','movie','series')
   GROUP BY media_type`,[sourceId]);
 const counts=Object.fromEntries(TYPES.map(type=>[type,0]));
 for(const row of totals.rows||[]){
  if(TYPES.includes(row.media_type))counts[row.media_type]=count(row.total);
 }
 const sample=await query(`SELECT m.gateway_id FROM blofy_xtream_gateway_item_map m
   JOIN blofy_xtream_items i ON i.server_id=m.server_id
     AND i.media_type=m.media_type AND i.source_id=m.source_id
   WHERE m.server_id=$1 AND m.media_type='movie'
     AND i.enabled=TRUE AND i.container_extension IN ('mp4','mkv','ts','avi')
   ORDER BY m.gateway_id ASC LIMIT 1`,[sourceId]);
 const gatewayId=Number(sample.rows?.[0]?.gateway_id);
 if(!Number.isSafeInteger(gatewayId)||gatewayId<1)
  return {ok:true,source:'saleh',catalogIndexed:true,counts,
   sample:{mediaSampleReadable:false,code:'movie_sample_not_mapped',
    fullDownloadVerified:false},mediaRequestCount:0,customerTrafficChanged:false};
 let test;
 try{test=await probeMovie(gatewayId)}
 catch{test={ok:false,reason:'bounded_media_test_unavailable',httpStatus:null}}
 return {ok:true,source:'saleh',catalogIndexed:true,counts,
  sample:safeSalehCopySample(test),mediaRequestCount:1,
  customerTrafficChanged:false,sourceCredentialsExposed:false,
  durationMs:Math.max(0,Math.min(30000,Date.now()-begin))};
}

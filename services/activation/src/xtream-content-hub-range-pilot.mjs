// BLOFY CONTENT HUB: non-persistent two-part Range proof for ONE indexed
// saleh movie. NO movie download, no storage, no customer routing changes.
// Two sequential 4 KiB requests; no parallel upstream connections or retries.
// Bounded JSON report only (never emit source URLs, IDs or credentials).
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PART=4096;
const safeStatus=s=>Number.isInteger(s)&&s>=100&&s<=599?s:null;

export function parseStrictContentRange(header,start,end){
 const m=/^bytes (0|[1-9][0-9]*)-(0|[1-9][0-9]*)\/(?:([1-9][0-9]*))$/i.exec(String(header||'').trim());
 if(!m)return null;
 const from=Number(m[1]),to=Number(m[2]),size=Number(m[3]);
 if(![from,to,size].every(Number.isSafeInteger)||from!==start||
    to!==end||size<=end)return null;
 return {totalSize:size,from,to};
}
function safePart(res,from,to){
 const status=safeStatus(res?.httpStatus);
 const range=status===206?parseStrictContentRange(res?.contentRange,from,to):null;
 const size=Number(res?.bytesRead);
 const valid=status===206&&range&&size===to-from+1&&res?.transportOk===true;
 return {ok:Boolean(valid),httpStatus:status,totalSize:range?.totalSize||null,
   bodyBytesVerified:valid?size:0,
   code:valid?'range_chunk_verified':
     status===200?'range_ignored':
     status===206?'range_content_mismatch':
     status===401||status===403?'source_denied':
     status===404?'source_media_not_found':
     status===416?'range_unavailable':
     status?'source_http_'+status:'source_unreachable'};
}
export async function probeSalehRangedMovie({query,readPart}={}){
 if(typeof query!=='function'||typeof readPart!=='function')
  throw Error('range_pilot_invalid_dependencies');
 const source=await query(`SELECT id FROM blofy_xtream_servers
   WHERE lower(btrim(name))='saleh' AND enabled=TRUE AND publish_catalog=TRUE
     AND deletion_requested_at IS NULL LIMIT 2`);
 if(source.rows?.length!==1||!UUID.test(String(source.rows[0].id||'')))
  return {ok:false,code:'saleh_source_missing_or_ambiguous',requests:0,
   completeFileCopied:false,customerTrafficChanged:false};
 const sourceId=source.rows[0].id;
 const movie=await query(`SELECT m.gateway_id FROM blofy_xtream_gateway_item_map m
  JOIN blofy_xtream_items i ON i.server_id=m.server_id
    AND i.media_type=m.media_type AND i.source_id=m.source_id
  WHERE m.server_id=$1 AND m.media_type='movie' AND i.enabled=TRUE
    AND i.container_extension IN ('mp4','mkv','avi','ts')
  ORDER BY m.gateway_id ASC LIMIT 1`,[sourceId]);
 const gatewayId=Number(movie.rows?.[0]?.gateway_id);
 if(!Number.isSafeInteger(gatewayId)||gatewayId<1)
  return {ok:false,code:'no_indexed_movie',requests:0,
    completeFileCopied:false,customerTrafficChanged:false};
 let requests=0,first,second;
 try{
  requests=1;
  first=safePart(await readPart({sourceId,gatewayId,from:0,to:PART-1}),0,PART-1);
  if(first.ok){
   requests=2;
   second=safePart(await readPart({sourceId,gatewayId,from:PART,to:PART*2-1}),
     PART,PART*2-1);
  }
 }catch{
  // Unavailable transport is a test failure, NOT a reason to retry or bypass.
  if(!first)first={ok:false,code:'source_unreachable',httpStatus:null};
  else second={ok:false,code:'source_unreachable',httpStatus:null};
 }
 const verified=first?.ok===true&&second?.ok===true&&
   first.totalSize===second.totalSize;
 return {ok:verified,source:'saleh',code:verified?
   'sequential_range_resume_supported':'range_resume_unverified',
   firstPart:first||null,secondPart:second||null,
   sameFileSize:verified,partSizeBytes:PART,
   requests,maximumExpectedBodyBytes:PART*2,
   sequentialNotConcurrent:true,fullDownloadVerified:false,
   completeFileCopied:false,permanentStorageCreated:false,
   storageRightsVerified:false,customerTrafficChanged:false};
}

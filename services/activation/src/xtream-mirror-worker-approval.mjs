// Read-only server-authenticated per-item approval for licensed VOD copy.
// No client-supplied origin, credentials or source ID. The owner must have
// staged the exact catalog item and completed the separate verified preflight.
const MOVIE=/^[A-Za-z0-9._:-]{1,128}$/;
const EPISODE=/^[1-9][0-9]{0,9}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAFE_MEDIA=/^[A-Za-z0-9_-]{1,128}$/; // current durable movie manifest
const E_MEDIA=/^[A-Za-z0-9._-]{1,128}$/;
const EXT=new Set(['mp4','mkv','ts','avi']);
const MAX_AGE_MS=30*60*1000;
const base={ok:false,privateOnly:true,customerCutover:false,
 providerRequests:0,mediaBytesTransferred:0};

export async function loadApprovedMirrorItem(db,{kind,id,now=Date.now()}={}){
 if(typeof db?.query!=='function'||!['movie','episode'].includes(kind)||
    !(kind==='movie'?MOVIE:EPISODE).test(String(id||'')))
  return {...base,code:'mirror_approval_invalid_selection'};
 try{
  const source=await db.query([
   'SELECT id FROM blofy_xtream_servers',
   "WHERE lower(btrim(name))='saleh'",
   'AND enabled=TRUE AND publish_catalog=TRUE',
   'AND deletion_requested_at IS NULL LIMIT 2'
  ].join(' '));
  if(source.rows?.length!==1||!UUID.test(source.rows[0].id))
   return {...base,code:'mirror_approval_source_not_unique'};
  const sourceId=String(source.rows[0].id);
  const preflight=await db.query([
   'SELECT t.extension AS intake_extension,p.expected_bytes,',
   'p.rights_evidence_hash,p.measured_at,p.validator_present',
   'FROM blofy_stream_mirror_intents t',
   'JOIN blofy_stream_mirror_preflights p ON p.source_id=t.source_id',
   'AND p.media_kind=t.media_kind AND p.catalog_id=t.catalog_id',
   'WHERE t.source_id=$1 AND t.media_kind=$2 AND t.catalog_id=$3',
   "AND t.state='awaiting_size_and_license' AND p.state='eligible'",
   'LIMIT 1'
  ].join(' '),[sourceId,kind,id]);
  const row=preflight.rows?.[0];
  const bytes=Number(row?.expected_bytes);
  const observed=new Date(row?.measured_at||0).getTime();
  if(!row||row.validator_present!==true||
     !/^[a-f0-9]{64}$/.test(String(row.rights_evidence_hash||''))||
     !Number.isSafeInteger(bytes)||bytes<8*1024**2||bytes>4*1024**3||
     !Number.isFinite(observed)||observed>now||
     now-observed>MAX_AGE_MS)
   return {...base,code:'mirror_approval_preflight_stale_or_blocked'};
  const catalog=kind==='movie'?
   await db.query([
    'SELECT i.source_id AS media_id,i.container_extension AS extension,',
    'm.gateway_id',
    'FROM blofy_xtream_items i',
    'JOIN blofy_xtream_gateway_item_map m ON m.server_id=i.server_id',
    "AND m.media_type='movie' AND m.source_id=i.source_id",
    "WHERE i.server_id=$1 AND i.media_type='movie'",
    'AND i.source_id=$2 AND i.enabled=TRUE LIMIT 1'
   ].join(' '),[sourceId,id]):
   await db.query([
    'SELECT e.source_episode_id AS media_id,',
    'e.container_extension AS extension,e.gateway_id',
    'FROM blofy_xtream_gateway_episode_map e',
    'JOIN blofy_xtream_items i ON i.server_id=e.server_id',
    "AND i.media_type='series' AND i.source_id=e.series_source_id",
    'WHERE e.server_id=$1 AND e.gateway_id=$2 AND i.enabled=TRUE LIMIT 1'
   ].join(' '),[sourceId,Number(id)]);
  const media=catalog.rows?.[0],extension=String(media?.extension||'').toLowerCase();
  const mediaId=String(media?.media_id||''),gatewayId=Number(media?.gateway_id);
  if(!media||!EXT.has(extension)||
     extension!==String(row.intake_extension||'').toLowerCase()||
     !(kind==='movie'?SAFE_MEDIA:E_MEDIA).test(mediaId)||
     !Number.isSafeInteger(gatewayId)||gatewayId<1)
   return {...base,code:'mirror_approval_catalog_changed'};
  return {...base,ok:true,code:'mirror_approval_exact_item',
   sourceName:'saleh',sourceId,kind,id,mediaId,gatewayId,extension,
   expectedBytes:bytes,rightsEvidenceHash:String(row.rights_evidence_hash),
   validatorPresent:true,approvedAt:now,permissionScope:'licensed-private-vod-copy',
   customerCutover:false};
 }catch{return {...base,code:'mirror_approval_database_unavailable'}}
}

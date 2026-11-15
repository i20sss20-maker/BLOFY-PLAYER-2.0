// Read-only reconciliation of the Xtream catalog indexed in PostgreSQL.
// This is NOT a scan of physical media on S3. It never contacts the provider,
// reveals credentials/URLs, copies bytes, or changes subscriber routing.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MEDIA=new Set(['live','movie','series','episode']);
const EPISODE_CURSOR=/^(0|[1-9][0-9]{0,11})$/;
const ITEM_CURSOR=/^[A-Za-z0-9._:-]{0,128}$/;

function validInput({sourceId,mediaType,cursor,pageSize}) {
 if(!UUID.test(String(sourceId||''))||!MEDIA.has(mediaType)||
    !Number.isInteger(pageSize)||pageSize<1||pageSize>100||
    typeof cursor!=='string'||
    !(mediaType==='episode'?EPISODE_CURSOR.test(cursor||'0'):ITEM_CURSOR.test(cursor)))
  throw Error('xtream_mirror_inventory_query_invalid');
}

export async function listIndexedXtreamMirrorPage(db,{
 sourceId,mediaType='movie',cursor='',pageSize=50
}={}) {
 validInput({sourceId,mediaType,cursor,pageSize});
 if(!db||typeof db.query!=='function')
  throw Error('xtream_mirror_inventory_database_missing');
 const source=await db.query(`SELECT id,name,status,last_sync_at,counts
   FROM blofy_xtream_servers
   WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
     AND deletion_requested_at IS NULL AND lower(btrim(name))='saleh'
   LIMIT 1`,[sourceId]);
 const s=source.rows?.[0];
 if(!s)return {ok:false,code:'approved_source_not_found',items:[],
   providerRequests:0,mediaBytesTransferred:0,customerCutover:false};
 const limit=pageSize+1;
 let rows=[],metadataCoverage='indexed_xtream_catalog';
 if(mediaType==='episode'){
  // Episodes indexed by the existing gateway are only a *subset* of the
  // provider's full get_series_info catalog until every series is scanned.
  metadataCoverage='previously_mapped_episodes_only';
  const r=await db.query(`SELECT e.gateway_id,e.source_episode_id,
    e.series_source_id,e.container_extension,
    i.name AS series_name
    FROM blofy_xtream_gateway_episode_map e
    JOIN blofy_xtream_items i ON i.server_id=e.server_id
      AND i.media_type='series' AND i.source_id=e.series_source_id
    WHERE e.server_id=$1 AND e.gateway_id>$2
      AND i.enabled=TRUE
    ORDER BY e.gateway_id ASC LIMIT $3`,
    [sourceId,Number(cursor||0),limit]).catch(e=>{
    if(e?.code==='42P01')return {rows:[]};
    throw e;
  });
  rows=(r.rows||[]).map(r=>({
   id:String(r.gateway_id),seriesId:String(r.series_source_id),
   title:String(r.series_name||'').slice(0,220),
   extension:String(r.container_extension||'').toLowerCase(),
   mediaKind:'episode',copyStatus:'not_assessed'
  }));
 }else{
  const r=await db.query(`SELECT source_id,name,container_extension,
    updated_at FROM blofy_xtream_items
    WHERE server_id=$1 AND media_type=$2
      AND source_id>$3 AND enabled=TRUE
    ORDER BY source_id ASC LIMIT $4`,
    [sourceId,mediaType,cursor,limit]);
  rows=(r.rows||[]).map(r=>({
   id:String(r.source_id).slice(0,128),
   title:String(r.name||'').slice(0,220),
   extension:mediaType==='movie'?
     String(r.container_extension||'').toLowerCase():null,
   mediaKind:mediaType,copyStatus:mediaType==='live'?
     'metadata_only':'not_assessed',
   catalogUpdatedAt:r.updated_at||null
  }));
 }
 const hasMore=rows.length>pageSize,items=rows.slice(0,pageSize);
 const nextCursor=hasMore?items.at(-1)?.id:null;
 const counts=(s.counts&&typeof s.counts==='object')?s.counts:{};
 return {ok:true,code:'indexed_catalog_page',
  sourceName:'saleh',sourceId,mediaType,
  metadataCoverage,
  latestXtreamSyncAt:s.last_sync_at||null,
  xtreamStatus:String(s.status||'unknown').slice(0,16),
  sourceReportedCounts:{
   live:Number(counts.live)||0,
   movie:Number(counts.movie)||0,
   series:Number(counts.series)||0
  },items,hasMore,nextCursor,
  // Catalog import is not a media transfer or checksum proof.
  storedCopiesVerified:false,physicalCopyCoverageUnknown:true,
  providerRequests:0,mediaBytesTransferred:0,customerCutover:false};
}

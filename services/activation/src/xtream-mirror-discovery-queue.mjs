// Persistent, source-scoped metadata work queue for the licensed Content Hub.
// No Xtream network access; cannot upload, re-route, or grant copying rights.
// Metadata ingestion is incremental and resumes across worker restarts.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TYPES=new Set(['movie','episode']);
const ALLOWED_EXT=new Set(['mp4','mkv','avi','ts']);
const DAY=/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/;
const isoDay=v=>v instanceof Date?v.toISOString().slice(0,10):
 String(v||'').slice(0,10);

export function riyadhMirrorDay(now=new Date()){
 const date=new Date(now);
 if(!Number.isFinite(date.getTime()))throw Error('mirror_clock_invalid');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',
  day:'2-digit'
 }).formatToParts(date).map(x=>[x.type,x.value]));
 return [parts.year,parts.month,parts.day].join('-');
}

export function normalizeMirrorDiscoveryCandidate(row,mediaKind){
 const gatewayId=Number(row?.gateway_id);
 const mediaId=String(row?.media_id||'');
 const extension=String(row?.extension||'').toLowerCase();
 if(!TYPES.has(mediaKind)||!Number.isSafeInteger(gatewayId)||gatewayId<1||
    !/^[A-Za-z0-9._-]{1,128}$/.test(mediaId)||
    !ALLOWED_EXT.has(extension))return null;
 return {gatewayId,mediaId,extension,mediaKind,
  seriesMediaId:mediaKind==='episode'?String(row?.series_media_id||'').slice(0,128):null,
  title:String(row?.title||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,220)};
}

export function createXtreamMirrorDiscoveryStore(db){
 if(typeof db?.connect!=='function'||typeof db?.query!=='function')
  throw Error('mirror_discovery_database_required');
 let init=null;
 async function ensure(){
  if(!init)init=(async()=>{
   await db.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_mirror_items (
    source_id UUID NOT NULL,
    media_kind TEXT NOT NULL CHECK(media_kind IN ('movie','episode')),
    gateway_id BIGINT NOT NULL CHECK(gateway_id>0),
    media_id TEXT NOT NULL,series_media_id TEXT,
    extension TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'needs_review'
      CHECK(state IN ('needs_review','approved','copying','verified','failed')),
    expected_bytes BIGINT,
    license_reviewed_at TIMESTAMPTZ,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(source_id,media_kind,gateway_id)
   )`);
   await db.query(`CREATE INDEX IF NOT EXISTS idx_xtream_mirror_queue_state
    ON blofy_xtream_mirror_items(source_id,media_kind,state,gateway_id)`);
   await db.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_mirror_discovery (
    source_id UUID NOT NULL,
    media_kind TEXT NOT NULL CHECK(media_kind IN ('movie','episode')),
    cursor_id BIGINT NOT NULL DEFAULT 0,
    completed_local_day DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(source_id,media_kind)
   )`);
  })().catch(error=>{init=null;throw error});
  return init;
 }
 async function scanPage({sourceId,mediaKind,localDay,limit=250}={}){
  if(!UUID.test(String(sourceId||''))||!TYPES.has(mediaKind)||
     !DAY.test(String(localDay||''))||
     !Number.isInteger(limit)||limit<1||limit>500)
   throw Error('mirror_discovery_request_invalid');
  await ensure();
  const client=await db.connect();
  let active=false;
  try{
   await client.query('BEGIN');active=true;
   // Disallow source names other than the exact approved saleh source.
   // Catalog can be scanned without either downloading or opening a feed.
   const approved=await client.query(`SELECT id FROM blofy_xtream_servers
    WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
      AND deletion_requested_at IS NULL
      AND lower(btrim(name))='saleh'
      AND status='online' AND last_error IS NULL
      AND last_sync_at > NOW()-INTERVAL '48 hours'
    LIMIT 1`,[sourceId]);
   if(approved.rows?.length!==1){
    await client.query('ROLLBACK');active=false;
    return {ok:false,code:'mirror_source_not_currently_approved',
     scanned:0,mediaBytesTransferred:0};
   }
   await client.query(`INSERT INTO blofy_xtream_mirror_discovery
    (source_id,media_kind) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [sourceId,mediaKind]);
   const lock=await client.query(`SELECT cursor_id,completed_local_day
    FROM blofy_xtream_mirror_discovery
    WHERE source_id=$1 AND media_kind=$2 FOR UPDATE`,[sourceId,mediaKind]);
   const state=lock.rows?.[0]||{};
   const finishedDay=state.completed_local_day?
    isoDay(state.completed_local_day):null;
   if(finishedDay===localDay){
    await client.query('COMMIT');active=false;
    return {ok:true,code:'mirror_scan_already_complete_today',
     scanned:0,hasMore:false,mediaBytesTransferred:0};
   }
   // On a new local day after completing the previous full pass, start
   // from zero. Incomplete scans continue across local day boundaries.
   const cursor=finishedDay&&finishedDay<localDay?0:Number(state.cursor_id||0);
   if(!Number.isSafeInteger(cursor)||cursor<0)
    throw Error('mirror_discovery_cursor_invalid');
   const sql=mediaKind==='movie'?`SELECT m.gateway_id,
     m.source_id AS media_id,i.container_extension AS extension,
     COALESCE(NULLIF(i.custom_name,''),i.name) AS title
     FROM blofy_xtream_gateway_item_map m
     JOIN blofy_xtream_items i ON i.server_id=m.server_id
       AND i.media_type=m.media_type AND i.source_id=m.source_id
     WHERE m.server_id=$1 AND m.media_type='movie'
       AND m.gateway_id>$2 AND i.enabled=TRUE
     ORDER BY m.gateway_id ASC LIMIT $3`:
    `SELECT e.gateway_id,e.source_episode_id AS media_id,
       e.series_source_id AS series_media_id,
       e.container_extension AS extension,i.name AS title
     FROM blofy_xtream_gateway_episode_map e
     JOIN blofy_xtream_items i ON i.server_id=e.server_id
       AND i.media_type='series' AND i.source_id=e.series_source_id
     WHERE e.server_id=$1 AND e.gateway_id>$2 AND i.enabled=TRUE
     ORDER BY e.gateway_id ASC LIMIT $3`;
   const result=await client.query(sql,[sourceId,cursor,limit]);
   const records=result.rows||[];
   const valid=records.map(r=>normalizeMirrorDiscoveryCandidate(r,mediaKind))
    .filter(Boolean);
   if(valid.length){
    // Exact identity conflict never overwrites an existing approved/verified
    // job; a changed gateway mapping requires separate operator review.
    await client.query(`INSERT INTO blofy_xtream_mirror_items
      (source_id,media_kind,gateway_id,media_id,series_media_id,extension,title)
      SELECT $1::uuid,$2::text,x.gateway_id,x.media_id,
        x.series_media_id,x.extension,x.title
      FROM jsonb_to_recordset($3::jsonb) AS x(
        gateway_id bigint,media_id text,series_media_id text,
        extension text,title text)
      ON CONFLICT(source_id,media_kind,gateway_id) DO UPDATE SET
        last_seen_at=NOW(),title=EXCLUDED.title
      WHERE blofy_xtream_mirror_items.media_id=EXCLUDED.media_id
        AND blofy_xtream_mirror_items.extension=EXCLUDED.extension`,
     [sourceId,mediaKind,JSON.stringify(valid.map(x=>({
        gateway_id:x.gatewayId,media_id:x.mediaId,
        series_media_id:x.seriesMediaId,
        extension:x.extension,title:x.title
      })))]);
   }
   const last=records.length?Number(records.at(-1).gateway_id):cursor;
   if(!Number.isSafeInteger(last)||last<cursor)throw Error('mirror_discovery_page_invalid');
   const complete=records.length<limit;
   await client.query(`UPDATE blofy_xtream_mirror_discovery
     SET cursor_id=$3,
       completed_local_day=CASE WHEN $4::boolean THEN $5::date
         ELSE completed_local_day END,updated_at=NOW()
     WHERE source_id=$1 AND media_kind=$2`,
    [sourceId,mediaKind,last,complete,localDay]);
   await client.query('COMMIT');active=false;
   return {ok:true,code:complete?'mirror_scan_pass_completed':
      'mirror_scan_page_saved',
    mediaKind,sourceId,scanned:records.length,
    discoverable:valid.length,invalidCandidates:records.length-valid.length,
    lastGatewayId:last,hasMore:!complete,completedDay:complete?localDay:null,
    providerRequests:0,mediaBytesTransferred:0,
    mediaCopyStarted:false,customerCutover:false};
  }catch(error){
   if(active)await client.query('ROLLBACK').catch(()=>{});
   throw error;
  }finally{client.release()}
 }
 async function summary({sourceId}={}){
  if(!UUID.test(String(sourceId||'')))throw Error('mirror_discovery_source_invalid');
  await ensure();
  const [counts,scans]=await Promise.all([
   db.query(`SELECT media_kind,state,COUNT(*)::text AS total
      FROM blofy_xtream_mirror_items WHERE source_id=$1
      GROUP BY media_kind,state ORDER BY media_kind,state`,[sourceId]),
   db.query(`SELECT media_kind,cursor_id,completed_local_day,updated_at
      FROM blofy_xtream_mirror_discovery WHERE source_id=$1
      ORDER BY media_kind`,[sourceId])
  ]);
  return {ok:true,sourceId,queue:(counts.rows||[]).map(x=>({
    mediaKind:x.media_kind,state:x.state,total:Number(x.total)||0
   })),scans:(scans.rows||[]).map(x=>({
    mediaKind:x.media_kind,cursor:Number(x.cursor_id)||0,
    completedDay:x.completed_local_day||null,updatedAt:x.updated_at||null
   })),allLicensesVerified:false,allMediaFilesCopied:false,
   episodesOnlyMappedSubset:true,readOnly:true,
   providerRequests:0,mediaBytesTransferred:0,customerCutover:false};
 }
 return {scanPage,summary,ensure};
}

// Bounded, opt-in discovery of Xtream series EPISODES that were not
// previously opened in a player. Metadata only. Does not transfer media,
// authorize copying or change customer playlists. One provider metadata
// lookup per claimed series, serialized by a session-level Postgres lock.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PG_LOCK_A=1774401053,PG_LOCK_B=1774401054;
const isoDay=v=>v instanceof Date?v.toISOString().slice(0,10):
 String(v||'').slice(0,10);

export function shouldEnumerateMirrorSeries(env={}){
 return env.BLOFY_XTREAM_MIRROR_SERIES_ENUM_ENABLED==='1' &&
  UUID.test(String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID||''));
}

export async function enumerateOneMirrorSeries({
 db,sourceId,localDay,seriesLookup
}={}){
 if(!UUID.test(String(sourceId||''))||
  !/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(String(localDay||''))||
  typeof db?.connect!=='function'||typeof seriesLookup!=='function')
  throw Error('mirror_series_enumeration_invalid_request');
 const client=await db.connect();
 let held=false;
 try{
  const lock=await client.query(
   'SELECT pg_try_advisory_lock($1::integer,$2::integer) AS held',
   [PG_LOCK_A,PG_LOCK_B]);
  held=lock.rows?.[0]?.held===true;
  if(!held)return {ok:false,code:'mirror_series_enumeration_busy',
   providerRequests:0,mediaBytesTransferred:0};
  await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_mirror_series_progress (
   source_id UUID PRIMARY KEY,
   last_gateway_id BIGINT NOT NULL DEFAULT 0,
   started_local_day DATE,
   finished_local_day DATE,
   failed_gateway_id BIGINT,
   last_error_code TEXT,
   last_checked_at TIMESTAMPTZ,
   series_scanned BIGINT NOT NULL DEFAULT 0,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const approved=await client.query(`SELECT s.id
   FROM blofy_xtream_servers s
   WHERE s.id=$1 AND s.enabled=TRUE AND s.publish_catalog=TRUE
     AND s.deletion_requested_at IS NULL
     AND lower(btrim(s.name))='saleh' AND s.status='online'
     AND s.last_error IS NULL
     AND s.last_sync_at>NOW()-INTERVAL '48 hours'
   LIMIT 1`,[sourceId]);
  if(approved.rows?.length!==1)return {
   ok:false,code:'mirror_series_source_not_currently_approved',
   providerRequests:0,mediaBytesTransferred:0};
  await client.query(`INSERT INTO blofy_xtream_mirror_series_progress
   (source_id) VALUES ($1) ON CONFLICT DO NOTHING`,[sourceId]);
  const progress=await client.query(`SELECT last_gateway_id,started_local_day,
   finished_local_day,failed_gateway_id
   FROM blofy_xtream_mirror_series_progress WHERE source_id=$1`,[sourceId]);
  const state=progress.rows?.[0]||{};
  const finished=state.finished_local_day?isoDay(state.finished_local_day):null;
  const started=state.started_local_day?isoDay(state.started_local_day):null;
  if(finished===localDay)return {ok:true,
   code:'mirror_series_already_scanned_today',seriesScanned:0,
   providerRequests:0,mediaBytesTransferred:0};
  // A partially complete multi-day catalog must retain its cursor.
  const restart=Boolean(finished&&finished<localDay&&
   (!started||started<=finished));
  const cursor=restart?0:Number(state.last_gateway_id||0);
  if(!Number.isSafeInteger(cursor)||cursor<0)
   throw Error('mirror_series_cursor_invalid');
  const item=await client.query(`SELECT m.gateway_id
    FROM blofy_xtream_gateway_item_map m
    JOIN blofy_xtream_items i ON i.server_id=m.server_id
      AND i.media_type=m.media_type AND i.source_id=m.source_id
    WHERE m.server_id=$1 AND m.media_type='series'
      AND m.gateway_id>$2 AND i.enabled=TRUE
    ORDER BY m.gateway_id ASC LIMIT 1`,[sourceId,cursor]);
  const id=Number(item.rows?.[0]?.gateway_id);
  if(!Number.isSafeInteger(id)||id<1){
   await client.query(`UPDATE blofy_xtream_mirror_series_progress
    SET last_gateway_id=$2,started_local_day=$3::date,
      finished_local_day=$3::date,failed_gateway_id=NULL,
      last_error_code=NULL,last_checked_at=NOW(),updated_at=NOW()
    WHERE source_id=$1`,[sourceId,cursor,localDay]);
   return {ok:true,code:'mirror_series_scan_completed',
    seriesScanned:0,providerRequests:0,mediaBytesTransferred:0};
  }
  // One metadata request. Existing seriesInfo() independently binds the
  // gateway row to the source ID and persists mapped episodes transactionally.
  // No SELECT/UPDATE cursor advance if provider lookup fails.
  let result;
  try{result=await seriesLookup(id,sourceId)}
  catch{
   await client.query(`UPDATE blofy_xtream_mirror_series_progress
     SET failed_gateway_id=$2,last_error_code='series_metadata_unavailable',
       last_checked_at=NOW(),updated_at=NOW() WHERE source_id=$1`,
    [sourceId,id]);
   return {ok:false,code:'mirror_series_metadata_unavailable',
    attempted:1,seriesScanned:0,providerRequests:1,
    mediaBytesTransferred:0,customerCutover:false};
  }
  if(!result||typeof result!=='object'){
   await client.query(`UPDATE blofy_xtream_mirror_series_progress
     SET failed_gateway_id=$2,last_error_code='series_metadata_invalid',
       last_checked_at=NOW(),updated_at=NOW() WHERE source_id=$1`,
    [sourceId,id]);
   return {ok:false,code:'mirror_series_metadata_invalid',
    attempted:1,seriesScanned:0,providerRequests:1,
    mediaBytesTransferred:0,customerCutover:false};
  }
  await client.query(`UPDATE blofy_xtream_mirror_series_progress
   SET last_gateway_id=$2,started_local_day=CASE
       WHEN $4::boolean OR started_local_day IS NULL THEN $3::date
       ELSE started_local_day END,
     failed_gateway_id=NULL,last_error_code=NULL,
     last_checked_at=NOW(),series_scanned=series_scanned+1,
     updated_at=NOW() WHERE source_id=$1`,
   [sourceId,id,localDay,restart]);
  return {ok:true,code:'mirror_series_episode_metadata_indexed',
   gatewayId:id,seriesScanned:1,providerRequests:1,
   mediaBytesTransferred:0,mediaCopyStarted:false,
   customerCutover:false};
 }finally{
  if(held)await client.query(
   'SELECT pg_advisory_unlock($1::integer,$2::integer)',
   [PG_LOCK_A,PG_LOCK_B]).catch(()=>{});
  client.release();
 }
}

export async function readMirrorSeriesEnumerationProgress(db,{
 sourceId
}={}){
 if(!UUID.test(String(sourceId||''))||typeof db?.query!=='function')
  throw Error('mirror_series_status_request_invalid');
 const result=await db.query(`SELECT p.last_gateway_id,p.started_local_day,
   p.finished_local_day,p.failed_gateway_id,p.last_error_code,
   p.series_scanned,p.updated_at
   FROM blofy_xtream_mirror_series_progress p
   JOIN blofy_xtream_servers s ON s.id=p.source_id
   WHERE s.id=$1 AND lower(btrim(s.name))='saleh'
    AND s.enabled=TRUE AND s.publish_catalog=TRUE
    AND s.deletion_requested_at IS NULL
   LIMIT 1`,[sourceId]).catch(error=>{
    if(error?.code==='42P01')return {rows:[]};
    throw error;
   });
 const row=result.rows?.[0];
 if(!row)return {ok:true,code:'mirror_series_scan_not_started',
  readOnly:true,providerRequests:0,mediaBytesTransferred:0,
  customerCutover:false};
 return {ok:true,code:'mirror_series_scan_progress',
  lastGatewayId:Number(row.last_gateway_id)||0,
  startedLocalDay:row.started_local_day?isoDay(row.started_local_day):null,
  finishedLocalDay:row.finished_local_day?
    isoDay(row.finished_local_day):null,
  failedGatewayId:row.failed_gateway_id===null?null:
    Number(row.failed_gateway_id),
  lastErrorCode:row.last_error_code||null,
  seriesScanned:Number(row.series_scanned)||0,
  updatedAt:row.updated_at||null,
  episodesCountNotExhaustivelyVerified:true,
  readOnly:true,providerRequests:0,mediaBytesTransferred:0,
  customerCutover:false};
}

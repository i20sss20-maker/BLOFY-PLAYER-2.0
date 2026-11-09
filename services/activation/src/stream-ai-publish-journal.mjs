// Operator-approved catalog changes: durable, scoped journal + revision.
// Does not send notifications or trigger device playback refresh by itself.
const TOKEN=/^[a-f0-9]{48}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function ensureAiJournalSchema(client){
 await client.query(`CREATE TABLE IF NOT EXISTS blofy_library_ai_publish_log (
   plan_id CHAR(48) PRIMARY KEY,
   source_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
   media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
   operation TEXT NOT NULL CHECK(operation IN ('classify_items','titles_cleanup','category_sort','full_catalog_sort')),
   changes JSONB NOT NULL DEFAULT '[]'::jsonb,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   reverted_at TIMESTAMPTZ
 )`);
 await client.query(`CREATE TABLE IF NOT EXISTS blofy_library_ai_revisions (
   source_id UUID PRIMARY KEY REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
   revision BIGINT NOT NULL DEFAULT 0,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
}
export async function bumpAiCatalogRevision(client,sourceId){
 const data=await client.query(`INSERT INTO blofy_library_ai_revisions
  (source_id,revision,updated_at) VALUES($1,1,NOW())
  ON CONFLICT(source_id) DO UPDATE
  SET revision=blofy_library_ai_revisions.revision+1,updated_at=NOW()
  RETURNING revision`,[sourceId]);
 return Number(data.rows[0].revision);
}
export async function recordAiPublish(client,{planId,sourceId,mediaType,operation,changes=[]}){
 if(!TOKEN.test(planId)||!UUID.test(sourceId)||!['live','movie','series'].includes(mediaType)||
    !['classify_items','titles_cleanup','category_sort','full_catalog_sort'].includes(operation)||
    !Array.isArray(changes)||changes.length>12)
  throw Error('stream_ai_publish_invalid');
 await client.query(`INSERT INTO blofy_library_ai_publish_log
  (plan_id,source_id,media_type,operation,changes) VALUES($1,$2,$3,$4,$5::jsonb)`,
  [planId,sourceId,mediaType,operation,JSON.stringify(changes)]);
 return bumpAiCatalogRevision(client,sourceId);
}
export async function readAiPublishState(pool,sourceId){
 if(!UUID.test(sourceId))return {ok:false,code:'stream_ai_selection_invalid'};
 const [revision,history]=await Promise.all([
  pool.query(`SELECT revision,updated_at FROM blofy_library_ai_revisions WHERE source_id=$1`,[sourceId]),
  pool.query(`SELECT plan_id,operation,media_type,created_at,reverted_at,
    CASE WHEN operation='classify_items' THEN jsonb_array_length(changes) ELSE 0 END AS moved
    FROM blofy_library_ai_publish_log WHERE source_id=$1
    ORDER BY created_at DESC LIMIT 20`,[sourceId])
 ]);
 return {ok:true,sourceId,revision:Number(revision.rows[0]?.revision||0),
  updatedAt:revision.rows[0]?.updated_at||null,
  changes:history.rows.map(x=>({planId:x.plan_id,operation:x.operation,
   mediaType:x.media_type,moved:Number(x.moved||0),
   createdAt:x.created_at,reverted:x.reverted_at!=null}))};
}
export async function revertAiClassification(pool,{sourceId,planId}){
 if(!UUID.test(sourceId)||!TOKEN.test(planId))
  return {ok:false,code:'stream_ai_rollback_invalid'};
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='1300ms'");
  await client.query("SET LOCAL statement_timeout='12000ms'");
  const record=await client.query(`SELECT media_type,operation,changes,reverted_at
    FROM blofy_library_ai_publish_log
    WHERE plan_id=$1 AND source_id=$2 FOR UPDATE`,[planId,sourceId]);
  const row=record.rows[0];
  if(!row||row.reverted_at){await client.query('ROLLBACK');return {ok:false,code:'stream_ai_rollback_not_available'};}
  if(row.operation!=='classify_items'){await client.query('ROLLBACK');return {ok:false,code:'stream_ai_rollback_unsupported'};}
  const changes=row.changes;
  if(!Array.isArray(changes)||changes.length<1||changes.length>12){
   await client.query('ROLLBACK');return {ok:false,code:'stream_ai_rollback_invalid'};
  }
  let restored=0;
  for(const x of changes){
   if(typeof x.id!=='string'||typeof x.toCategory!=='string'||
      typeof x.title!=='string'){
     await client.query('ROLLBACK');return {ok:false,code:'stream_ai_rollback_invalid'};
   }
   const r=await client.query(`UPDATE blofy_xtream_items SET
    category_id=$4,custom_category_id=$5,updated_at=NOW()
    WHERE server_id=$1 AND media_type=$2 AND source_id=$3
      AND category_id=$6 AND custom_category_id=$6
      AND COALESCE(NULLIF(custom_name,''),name)=$7
    RETURNING source_id`,
    [sourceId,row.media_type,x.id,x.fromCategory??null,
     x.fromOverride??null,x.toCategory,x.title]);
   if(r.rowCount!==1){await client.query('ROLLBACK');
    return {ok:false,code:'stream_ai_rollback_conflict'};}
   restored++;
  }
  await client.query(`UPDATE blofy_library_ai_publish_log
    SET reverted_at=NOW() WHERE plan_id=$1`,[planId]);
  const revision=await bumpAiCatalogRevision(client,sourceId);
  await client.query('COMMIT');
  return {ok:true,reverted:true,restored,revision,sourceId,
   clientsNeedRefresh:true,automaticDevicePush:false};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(['55P03','57014'].includes(String(error?.code||'')))
   return {ok:false,code:'stream_ai_rollback_busy'};
  throw error;
 }finally{client.release();}
}

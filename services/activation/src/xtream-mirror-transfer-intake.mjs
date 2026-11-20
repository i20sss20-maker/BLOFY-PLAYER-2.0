// Private owner-side VOD transfer INTAKE only. Durable PostgreSQL plan,
// not an active media transfer worker. Each movie or indexed episode stays
// blocked until real size, storage capacity and content rights are verified.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MOVIE=/^[A-Za-z0-9._:-]{1,128}$/;
const EPISODE=/^[1-9][0-9]{0,9}$/;
const EXTENSIONS=new Set(['mkv','mp4','avi','ts']);
const CAP=24,STATE='awaiting_size_and_license';
const schemaPromise=new WeakMap();
export const mirrorIntakeLimit=CAP;
export function validateMirrorIntakeSelection({sourceId,kind,id}={}){
 return UUID.test(String(sourceId||''))&&
  ['movie','episode'].includes(kind)&&
  (kind==='movie'?MOVIE:EPISODE).test(String(id||''));
}
function noCopy(extra={}){
 return {mediaBytesTransferred:0,mediaCopyStarted:false,
  sizeProbePerformed:false,storageRightsNotInferred:true,
  customerCutover:false,copyWorkerEnabled:false,...extra};
}
async function ensure(db){
 let pending=schemaPromise.get(db);
 if(!pending){
  pending=db.query([
   'CREATE TABLE IF NOT EXISTS blofy_stream_mirror_intents (',
   'source_id UUID NOT NULL,',
   "media_kind TEXT NOT NULL CHECK(media_kind IN ('movie','episode')),",
   'catalog_id TEXT NOT NULL,title TEXT NOT NULL,extension TEXT NOT NULL,',
   "state TEXT NOT NULL DEFAULT 'awaiting_size_and_license'",
   "CHECK(state IN ('awaiting_size_and_license','cancelled')),",
   'expected_bytes BIGINT,license_reference TEXT,',
   'created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
   'updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
   'PRIMARY KEY(source_id,media_kind,catalog_id),',
   'CHECK(expected_bytes IS NULL AND license_reference IS NULL)',
   ')'
  ].join(' ')).catch(error=>{schemaPromise.delete(db);throw error});
  schemaPromise.set(db,pending);
 }
 await pending;
}
async function scopedSource(conn,id){
 const r=await conn.query([
  'SELECT id FROM blofy_xtream_servers',
  'WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE',
  "AND deletion_requested_at IS NULL AND lower(btrim(name))='saleh'",
  'LIMIT 1'
 ].join(' '),[id]);
 return r.rowCount===1;
}
const toPublic=row=>({
 kind:row.media_kind,id:row.catalog_id,
 title:String(row.title||'').slice(0,190),
 extension:String(row.extension||'').slice(0,12),
 state:row.state,expectedBytes:null,rightsEvidenceRecorded:false,
 createdAt:row.created_at,updatedAt:row.updated_at,
 transferReady:false,storageBytesReserved:0,bytesCopied:0
});
// Materialize exactly ONE owner-selected movie gateway mapping. Xtream
// catalog imports do not necessarily precreate the mapping, but the Hub
// private Range bridge resolves it by gateway ID. Never map the entire
// catalog here (that would be a large unexpected DB write).
async function ensureSelectedMovieGateway(client,sourceId,id){
 const inserted=await client.query([
  'INSERT INTO blofy_xtream_gateway_item_map',
  '(server_id,media_type,source_id)',
  'SELECT i.server_id,i.media_type,i.source_id',
  'FROM blofy_xtream_items i',
  'JOIN blofy_xtream_servers s ON s.id=i.server_id',
  'LEFT JOIN blofy_xtream_categories c',
  'ON c.server_id=i.server_id AND c.media_type=i.media_type',
  'AND c.source_category_id=i.category_id',
  "WHERE i.server_id=$1 AND i.source_id=$2 AND i.media_type='movie'",
  "AND i.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE",
  'AND (c.enabled IS NULL OR c.enabled=TRUE)',
  'ON CONFLICT(server_id,media_type,source_id) DO NOTHING'
 ].join(' '),[sourceId,id]);
 const mapped=await client.query([
  'SELECT gateway_id FROM blofy_xtream_gateway_item_map',
  "WHERE server_id=$1 AND media_type='movie' AND source_id=$2",
  'LIMIT 1'
 ].join(' '),[sourceId,id]);
 return Number.isSafeInteger(Number(mapped.rows?.[0]?.gateway_id))&&
  Number(mapped.rows[0].gateway_id)>0;
}
export async function stageMirrorIntake(db,{
 sourceId,kind,id,manifestStatus,ownerConfirmed
}={}){
 if(!validateMirrorIntakeSelection({sourceId,kind,id})||
   ownerConfirmed!==true||
   !['not_recorded','copy_incomplete','copy_failed'].includes(manifestStatus))
  return noCopy({ok:false,code:'mirror_intake_selection_unapproved'});
 if(!db?.connect||!db?.query)
  return noCopy({ok:false,code:'mirror_intake_database_unavailable'});
 await ensure(db);
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='1200ms'");
  await client.query("SET LOCAL statement_timeout='4500ms'");
  // Serialize cap checks across Portal instances.
  await client.query(
   "SELECT pg_advisory_xact_lock(hashtext('blofy_mirror_intake'),hashtext($1))",
   [sourceId]);
  if(!await scopedSource(client,sourceId)){
   await client.query('ROLLBACK');
   return noCopy({ok:false,code:'mirror_intake_source_not_approved'});
  }
  const itemSql=kind==='movie'?[
   'SELECT i.name AS title,i.container_extension AS extension',
   'FROM blofy_xtream_items i',
   "WHERE i.server_id=$1 AND i.media_type='movie'",
   'AND i.source_id=$2 AND i.enabled=TRUE LIMIT 1'
  ].join(' '):[
   'SELECT i.name AS title,e.container_extension AS extension',
   'FROM blofy_xtream_gateway_episode_map e',
   'JOIN blofy_xtream_items i',
   "ON i.server_id=e.server_id AND i.media_type='series'",
   'AND i.source_id=e.series_source_id',
   'WHERE e.server_id=$1 AND e.gateway_id=$2',
   'AND i.enabled=TRUE LIMIT 1'
  ].join(' ');
  const existingItem=(await client.query(itemSql,[
   sourceId,kind==='movie'?id:Number(id)])).rows?.[0];
  const extension=String(existingItem?.extension||'').trim().toLowerCase();
  if(!existingItem||!EXTENSIONS.has(extension)){
   await client.query('ROLLBACK');
   return noCopy({ok:false,code:'mirror_intake_item_unavailable'});
  }
  const old=await client.query([
   'SELECT media_kind,catalog_id,title,extension,state,created_at,updated_at',
   'FROM blofy_stream_mirror_intents',
   'WHERE source_id=$1 AND media_kind=$2 AND catalog_id=$3'
  ].join(' '),[sourceId,kind,id]);
  if(old.rowCount===1&&old.rows[0].state===STATE){
   if(kind==='movie'&&!await ensureSelectedMovieGateway(client,sourceId,id)){
    await client.query('ROLLBACK');
    return noCopy({ok:false,code:'mirror_intake_movie_mapping_unavailable'});
   }
   await client.query('COMMIT');
   return noCopy({ok:true,code:'mirror_intake_already_staged',
    item:toPublic(old.rows[0]),maxStaged:CAP});
  }
  const count=await client.query([
   'SELECT COUNT(*)::int AS total FROM blofy_stream_mirror_intents',
   'WHERE source_id=$1 AND state=$2'
  ].join(' '),[sourceId,STATE]);
  if(Number(count.rows?.[0]?.total||0)>=CAP){
   await client.query('ROLLBACK');
   return noCopy({ok:false,code:'mirror_intake_queue_limit',
    maxStaged:CAP});
  }
  if(kind==='movie'&&!await ensureSelectedMovieGateway(client,sourceId,id)){
   await client.query('ROLLBACK');
   return noCopy({ok:false,code:'mirror_intake_movie_mapping_unavailable'});
  }
  const title=String(existingItem.title||'').trim().slice(0,190)||
    'Untitled catalog media';
  const result=await client.query([
   'INSERT INTO blofy_stream_mirror_intents',
   '(source_id,media_kind,catalog_id,title,extension,state)',
   'VALUES($1,$2,$3,$4,$5,$6)',
   'ON CONFLICT(source_id,media_kind,catalog_id)',
   'DO UPDATE SET title=EXCLUDED.title,extension=EXCLUDED.extension,',
   'state=EXCLUDED.state,updated_at=NOW()',
   'RETURNING media_kind,catalog_id,title,extension,state,created_at,updated_at'
  ].join(' '),[sourceId,kind,id,title,extension,STATE]);
  await client.query('COMMIT');
  return noCopy({ok:true,code:'mirror_intake_staged_metadata_only',
   item:toPublic(result.rows[0]),maxStaged:CAP,
   requires:['independent_storage_rights_evidence',
    'measured_source_expected_bytes','private_storage_capacity_check',
    'manual_transfer_worker_authorization']});
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release()}
}
export async function listMirrorIntake(db,{sourceId}={}){
 if(!UUID.test(String(sourceId||''))||!db?.query)
  return noCopy({ok:false,code:'mirror_intake_source_invalid'});
 await ensure(db);
 const r=await db.query([
  'SELECT media_kind,catalog_id,title,extension,state,created_at,updated_at',
  'FROM blofy_stream_mirror_intents WHERE source_id=$1',
  "ORDER BY CASE WHEN state='awaiting_size_and_license' THEN 0 ELSE 1 END,",
  'updated_at DESC LIMIT 25'
 ].join(' '),[sourceId]);
 const items=(r.rows||[]).slice(0,CAP).map(toPublic);
 return noCopy({ok:true,code:'mirror_intake_ledger',
   items,totalReturned:items.length,maxStaged:CAP,
   pending:items.filter(x=>x.state===STATE).length,
   stateScope:'metadata_only_awaiting_preflight'});
}
export async function cancelMirrorIntake(db,{
 sourceId,kind,id,ownerConfirmed
}={}){
 if(!validateMirrorIntakeSelection({sourceId,kind,id})||
    ownerConfirmed!==true||!db?.query)
  return noCopy({ok:false,code:'mirror_intake_cancel_invalid'});
 await ensure(db);
 const r=await db.query([
  "UPDATE blofy_stream_mirror_intents SET state='cancelled',",
  'updated_at=NOW()',
  'WHERE source_id=$1 AND media_kind=$2 AND catalog_id=$3',
  "AND state='awaiting_size_and_license'",
  'RETURNING catalog_id'
 ].join(' '),[sourceId,kind,id]);
 return noCopy({ok:r.rowCount===1,
  code:r.rowCount===1?'mirror_intake_cancelled':'mirror_intake_not_active'});
}

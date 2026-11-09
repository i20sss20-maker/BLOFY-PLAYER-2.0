// Source-scoped catalog generation for the BLOFY code app.
// Increment after a successfully committed source ingestion; a client can
// check cheaply and re-fetch the standard Xtream lists when it changes.
// Never include source secrets or subscriber identities.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function ensureXtreamCatalogRevisionSchema(db){
 await db.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_catalog_revisions (
  source_id UUID PRIMARY KEY REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT NOT NULL DEFAULT 'sync'
  CHECK (reason IN ('sync','operator_edit','restored'))
 )`);
}
export async function bumpXtreamCatalogRevision(db,sourceId,reason='sync'){
 if(!UUID.test(String(sourceId||''))||
    !['sync','operator_edit','restored'].includes(reason))
  throw new TypeError('xtream_catalog_revision_invalid');
 const row=(await db.query(`INSERT INTO blofy_xtream_catalog_revisions
  (source_id,revision,reason,updated_at) VALUES($1,1,$2,NOW())
  ON CONFLICT (source_id) DO UPDATE SET
   revision=blofy_xtream_catalog_revisions.revision+1,
   reason=EXCLUDED.reason,updated_at=NOW()
  RETURNING revision`,[sourceId,reason])).rows[0];
 return Number(row.revision);
}
export async function xtreamCatalogVersionForAccount(pool,sourceId,since=null){
 if(!UUID.test(String(sourceId||'')))
  return {ok:false,code:'xtream_catalog_source_unscoped'};
 let from=null;
 if(since!==null&&since!==''){
  if(!/^(0|[1-9]\d{0,15})$/.test(String(since)))
   return {ok:false,code:'xtream_catalog_version_invalid'};
  from=Number(since);
  if(!Number.isSafeInteger(from))return {ok:false,code:'xtream_catalog_version_invalid'};
 }
 const r=await pool.query(`SELECT s.enabled,s.publish_catalog,s.status,
   s.last_sync_at,s.counts,COALESCE(v.revision,0) AS revision,
   v.updated_at AS revision_at
   FROM blofy_xtream_servers s
   LEFT JOIN blofy_xtream_catalog_revisions v ON v.source_id=s.id
   WHERE s.id=$1 AND s.deletion_requested_at IS NULL LIMIT 1`,[sourceId]);
 const row=r.rows[0];
 if(!row||!row.enabled||!row.publish_catalog)
  return {ok:false,code:'xtream_catalog_source_unavailable'};
 const version=Number(row.revision)||0;
 return {ok:true,revision:version,
   changed:from===null?null:version!==from,
   requiresFullReload:from!==null&&version!==from,
   lastSyncAt:row.last_sync_at||null,
   syncStatus:['online','syncing','error','offline','unknown'].includes(row.status)?row.status:'unknown',
   counts:{live:Number(row.counts?.live||0),
    movie:Number(row.counts?.movie||0),series:Number(row.counts?.series||0)},
   clientAction:'refresh_categories_and_items_if_changed',
   automaticPush:false};
}

// Check the EXACT item leased by a private licensed mirror worker before
// revealing a provider byte range. Works only for movies approved for
// persistent private storage; no public listener, no source URL returned.
export async function findActiveMirrorMovie(pool,{gatewayId,sourceId}={}){
 if(!Number.isSafeInteger(gatewayId)||gatewayId<1||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(sourceId||''))||
    typeof pool?.query!=='function')return null;
 const r=await pool.query(`SELECT q.source_id,q.media_id,q.gateway_id,
    q.extension,q.expected_bytes,q.copy_run_id
    FROM blofy_xtream_mirror_items q
    JOIN blofy_xtream_servers s ON s.id=q.source_id
    JOIN blofy_xtream_gateway_item_map m
      ON m.server_id=q.source_id AND m.media_type='movie'
      AND m.gateway_id=q.gateway_id AND m.source_id=q.media_id
    JOIN blofy_xtream_items i ON i.server_id=m.server_id
      AND i.media_type=m.media_type AND i.source_id=m.source_id
    WHERE q.media_kind='movie' AND q.gateway_id=$1
      AND q.source_id=$2::uuid
      AND q.state='copying' AND q.mapping_conflict=FALSE
      AND q.copy_lease_until>NOW()
      AND q.copy_run_id ~ '^mirror_[a-f0-9]{40}$'
      AND q.license_reviewed_at IS NOT NULL
      AND q.rights_ref_sha256 ~ '^[a-f0-9]{64}$'
      AND q.size_probe_at>NOW()-INTERVAL '48 hours'
      AND q.expected_bytes BETWEEN 8388608 AND 4294967296
      AND i.enabled=TRUE AND lower(i.container_extension)=q.extension
      AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND s.status='online' AND s.last_error IS NULL
      AND s.deletion_requested_at IS NULL
      AND lower(btrim(s.name))='saleh'
      AND s.last_sync_at>NOW()-INTERVAL '48 hours'
    LIMIT 1`,[gatewayId,sourceId]);
 const row=r.rows?.[0];
 if(!row)return null;
 const size=Number(row.expected_bytes);
 if(!Number.isSafeInteger(size)||size<8388608||size>4294967296)
  return null;
 return {gatewayId:Number(row.gateway_id),sourceId:String(row.source_id),
  mediaId:String(row.media_id),extension:String(row.extension),
  expectedBytes:size,copyRunId:String(row.copy_run_id)};
}

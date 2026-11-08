// Read-only, full local-catalog integrity audit for a single saved Xtream
// source. Checks every imported item and every existing episode/gateway map.
// No media requests, provider login, credentials, source updates or reindexing.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ITEM_SQL=`
 SELECT media_type,
   count(*)::int AS total,
   count(*) FILTER (WHERE enabled)::int AS enabled_count,
   count(*) FILTER (WHERE NOT enabled)::int AS disabled_count,
   count(*) FILTER (WHERE nullif(btrim(name),'') IS NULL)::int AS blank_name_count,
   count(*) FILTER (WHERE source_id !~ '^[A-Za-z0-9_-]{1,128}$')::int AS unsafe_id_count,
   count(*) FILTER (WHERE media_type='movie' AND
     nullif(btrim(coalesce(container_extension,'')),'') IS NULL)::int AS movie_missing_extension_count,
   count(*) FILTER (WHERE media_type='movie' AND
     nullif(btrim(coalesce(container_extension,'')),'') IS NOT NULL AND
     lower(btrim(container_extension)) NOT IN ('mp4','mkv','avi','mov','webm','ts'))::int
     AS movie_unsupported_extension_count,
   count(*) FILTER (WHERE metadata->>'directSourcePresent'='true')::int
     AS advertised_direct_source_count
 FROM blofy_xtream_items
 WHERE server_id=$1
 GROUP BY media_type
 ORDER BY media_type
`;
const CATEGORY_SQL=`
 SELECT i.media_type,
   count(*) FILTER (WHERE i.category_id IS NOT NULL AND
     btrim(i.category_id)<>'' AND c.source_category_id IS NULL)::int
     AS missing_category_reference_count
 FROM blofy_xtream_items i
 LEFT JOIN blofy_xtream_categories c
   ON c.server_id=i.server_id AND c.media_type=i.media_type
   AND c.source_category_id=i.category_id
 WHERE i.server_id=$1
 GROUP BY i.media_type
`;
const GATEWAY_SQL=`
 SELECT m.media_type,
   count(*)::int AS mapped_items,
   count(*) FILTER (WHERE i.source_id IS NULL)::int AS mapped_items_no_longer_imported
 FROM blofy_xtream_gateway_item_map m
 LEFT JOIN blofy_xtream_items i ON i.server_id=m.server_id
   AND i.media_type=m.media_type AND i.source_id=m.source_id
 WHERE m.server_id=$1
 GROUP BY m.media_type
`;
const EPISODE_SQL=`
 SELECT count(*)::int AS mapped_episodes,
   count(*) FILTER (WHERE i.source_id IS NULL)::int AS episodes_parent_series_missing,
   count(*) FILTER (WHERE e.source_episode_id !~ '^[A-Za-z0-9_-]{1,128}$')::int
     AS episode_unsafe_id_count,
   count(*) FILTER (WHERE lower(btrim(coalesce(e.container_extension,''))) NOT IN
     ('mp4','mkv','avi','mov','webm','ts'))::int AS episode_unsupported_extension_count
 FROM blofy_xtream_gateway_episode_map e
 LEFT JOIN blofy_xtream_items i ON i.server_id=e.server_id
   AND i.media_type='series' AND i.source_id=e.series_source_id
 WHERE e.server_id=$1
`;
const fields=(row,keys)=>Object.fromEntries(keys.map(k=>[k,Math.max(0,Number(row?.[k]||0))]));
export async function auditEntireXtreamStoredCatalog(pool,sourceId){
 if(!UUID.test(String(sourceId||'')))throw Error('xtream_audit_source_invalid');
 const client=await pool.connect();
 let begun=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  begun=true;
  await client.query("SET LOCAL statement_timeout = '12000ms'");
  const [items,categories,gateway,episode]=await Promise.all([
    client.query(ITEM_SQL,[sourceId]),
    // Use independent read-only scans, all bound to this one source ID.
    // Query pool client calls are queued by node-postgres on one connection.
    client.query(CATEGORY_SQL,[sourceId]),
    client.query(GATEWAY_SQL,[sourceId]),
    client.query(EPISODE_SQL,[sourceId])
  ]);
  await client.query('COMMIT');begun=false;
  const byType=new Map((items.rows||[]).map(r=>[r.media_type,r]));
  const category=new Map((categories.rows||[]).map(r=>[r.media_type,r]));
  const mapped=new Map((gateway.rows||[]).map(r=>[r.media_type,r]));
  const types=['live','movie','series'].map(type=>({
    type,...fields(byType.get(type),['total','enabled_count','disabled_count',
      'blank_name_count','unsafe_id_count','movie_missing_extension_count',
      'movie_unsupported_extension_count','advertised_direct_source_count']),
    ...fields(category.get(type),['missing_category_reference_count']),
    ...fields(mapped.get(type),['mapped_items','mapped_items_no_longer_imported'])
  }));
  const episodes=fields(episode.rows?.[0],[
    'mapped_episodes','episodes_parent_series_missing','episode_unsafe_id_count',
    'episode_unsupported_extension_count'
  ]);
  const examined=types.reduce((n,x)=>n+x.total,0)+episodes.mapped_episodes;
  return {
    ok:true,readOnly:true,fullLocalCatalogScan:true,playbackVerified:false,
    rowsExamined:examined,importedItems:examined-episodes.mapped_episodes,
    types,episodes,
    // These are integrity signals, not proof of playable/unplayable media.
    integrityWarnings:types.reduce((n,x)=>n+
      x.blank_name_count+x.unsafe_id_count+x.movie_missing_extension_count+
      x.movie_unsupported_extension_count+x.missing_category_reference_count+
      x.mapped_items_no_longer_imported,0)+
      episodes.episodes_parent_series_missing+
      episodes.episode_unsafe_id_count+episodes.episode_unsupported_extension_count
  };
 }catch(error){
  if(begun)await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}

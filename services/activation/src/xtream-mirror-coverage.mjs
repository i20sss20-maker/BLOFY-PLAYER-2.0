// Owner-only read-only source coverage. Xtream indexing, gateway-mapped
// episodes and verified private S3 manifest rows are DIFFERENT quantities.
// This never contacts the provider nor scans an S3 bucket.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const n=v=>Math.max(0,Number(v)||0);

export async function readXtreamPrivateMirrorCoverage(db,{sourceId}={}){
 if(!UUID.test(String(sourceId||''))||typeof db?.query!=='function')
  throw Error('xtream_mirror_coverage_invalid_request');
 const src=await db.query(`SELECT id,last_sync_at,status FROM blofy_xtream_servers
    WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
    AND deletion_requested_at IS NULL
    AND lower(btrim(name))='saleh' LIMIT 1`,[sourceId]);
 const s=src.rows?.[0];
 if(!s)return {ok:false,code:'approved_source_not_found',readOnly:true,
  providerRequests:0,customerCutover:false};
 const catalog=await db.query(`SELECT media_type,COUNT(*)::text AS total
    FROM blofy_xtream_items WHERE server_id=$1 AND enabled=TRUE
    GROUP BY media_type`,[sourceId]);
 const totals={live:0,movie:0,series:0};
 for(const row of catalog.rows||[]){
  if(Object.hasOwn(totals,row.media_type))totals[row.media_type]=n(row.total);
 }
 // Tables created lazily when their dedicated pilots are used. Missing
 // table != zero verified files; report 'null' so the UI cannot claim
 // zero copied content based on an unavailable proof registry.
 const names=await db.query(`SELECT
    to_regclass('blofy_xtream_gateway_item_map') IS NOT NULL AS movies_mapped,
    to_regclass('blofy_xtream_gateway_episode_map') IS NOT NULL AS episodes_mapped,
    to_regclass('blofy_content_hub_chunk_runs') IS NOT NULL AS movie_runs,
    to_regclass('blofy_content_hub_episode_runs') IS NOT NULL AS episode_runs`);
 const present=names.rows?.[0]||{};
 let mappedMovieCount=null,mappedEpisodeCount=null;
 let verifiedMovieCount=null,verifiedEpisodeCount=null,verifiedBytes=0;
 let verifiedKinds=0;
 if(present.movies_mapped===true){
  const r=await db.query(`SELECT COUNT(*)::text AS total
    FROM blofy_xtream_gateway_item_map
    WHERE server_id=$1 AND media_type='movie'`,[sourceId]);
  mappedMovieCount=n(r.rows?.[0]?.total);
 }
 if(present.episodes_mapped===true){
  const r=await db.query(`SELECT COUNT(*)::text AS total
    FROM blofy_xtream_gateway_episode_map
    WHERE server_id=$1`,[sourceId]);
  mappedEpisodeCount=n(r.rows?.[0]?.total);
 }
 if(present.movies_mapped===true&&present.movie_runs===true){
  const r=await db.query(`SELECT COUNT(*)::text AS verified,
    COALESCE(SUM(c.expected_bytes),0)::text AS bytes
    FROM blofy_content_hub_chunk_runs c
    WHERE c.source_id=$1 AND c.state='verified'
      AND c.verified_sha256 ~ '^[a-f0-9]{64}$'
      AND EXISTS(SELECT 1 FROM blofy_xtream_gateway_item_map m
        WHERE m.server_id=c.source_id AND m.media_type='movie'
        AND m.source_id=c.media_id AND m.gateway_id=c.gateway_id)`,[sourceId]);
  // Multiple verified revisions may exist per file; this is a manifest
  // count, not proof that every unique title still exists in S3.
  verifiedMovieCount=n(r.rows?.[0]?.verified);
  verifiedBytes+=n(r.rows?.[0]?.bytes);
  verifiedKinds++;
 }
 if(present.episodes_mapped===true&&present.episode_runs===true){
  const r=await db.query(`SELECT COUNT(*)::text AS verified,
    COALESCE(SUM(e.expected_bytes),0)::text AS bytes
    FROM blofy_content_hub_episode_runs e
    WHERE e.source_id=$1 AND e.state='verified'
      AND e.verified_sha256 ~ '^[a-f0-9]{64}$'
      AND EXISTS(SELECT 1 FROM blofy_xtream_gateway_episode_map m
        WHERE m.server_id=e.source_id AND m.gateway_id=e.gateway_id
          AND m.source_episode_id=e.media_id)`,[sourceId]);
  verifiedEpisodeCount=n(r.rows?.[0]?.verified);
  verifiedBytes+=n(r.rows?.[0]?.bytes);
  verifiedKinds++;
 }
 return {ok:true,code:'source_coverage_read_only',sourceId,
  lastCatalogSyncAt:s.last_sync_at||null,
  sourceStatus:String(s.status||'unknown').slice(0,20),
  catalogTotals:totals,
  gatewayMapped:{movie:mappedMovieCount,episode:mappedEpisodeCount},
  verifiedPrivateManifests:{
   movie:verifiedMovieCount,episode:verifiedEpisodeCount,
   knownBytes:verifiedKinds>0?verifiedBytes:null,
   unknownProofKinds:2-verifiedKinds
  },
  restrictions:{
   episodesAreMappedSubsetOnly:true,
   manifestCountsNotCurrentS3Integrity:true,
   legacyPilotNotIncluded:true,
   perFileLicenseAndSizeUnverifiedForUncopiedItems:true,
   storedLiveRecordings:0,
   completeCatalogCopyProven:false
  },
  providerRequests:0,mediaBytesTransferred:0,
  readOnly:true,customerCutover:false};
}

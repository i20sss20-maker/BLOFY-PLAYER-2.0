// Operator-only READ-ONLY proof that the Content Hub PG connection can
// actually see the Xtream catalog, mirror queue, transfer budget and its
// own verified S3 manifests. A DATABASE_URL existing in TWO services
// does not establish that both URLs point to the same database.
// This preflight never requests media, stores files, or enables workers.
import pg from 'pg';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const requiredTables=Object.freeze({
 xtreamServers:'blofy_xtream_servers',
 xtreamCatalog:'blofy_xtream_items',
 movieGatewayMap:'blofy_xtream_gateway_item_map',
 episodeGatewayMap:'blofy_xtream_gateway_episode_map',
 mirrorQueue:'blofy_xtream_mirror_items',
 privateMovieManifests:'blofy_content_hub_chunk_runs',
 privateEpisodeManifests:'blofy_content_hub_episode_runs',
 sharedDailyBudget:'blofy_content_hub_mirror_daily_budget'
});

export function createMirrorDeploymentPreflightStore({
 connectionString,Pool=pg.Pool
}={}){
 if(typeof connectionString!=='string'||!connectionString)
  throw Error('mirror_preflight_db_missing');
 const pool=new Pool({connectionString,max:1,connectionTimeoutMillis:5000,
  idleTimeoutMillis:10000,application_name:'blofy_mirror_readonly_preflight'});
 return {db:pool,close:()=>pool.end()};
}

export async function inspectMirrorDeploymentPreflight({
 db,storage,env={}
}={}){
 if(typeof db?.query!=='function')throw Error('mirror_preflight_db_required');
 const sourceId=String(env.BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID||'');
 const pinned=UUID.test(sourceId);
 const tables=Object.fromEntries(Object.keys(requiredTables).map(k=>[k,false]));
 const failures=[];
 let databaseReadable=false,storageReadable=false;
 try{
  // Bind table identifiers to to_regclass; do not interpolate source IDs
  // or use DDL. A missing table is UNKNOWN rollout readiness, not zero.
  const entries=Object.entries(requiredTables);
  const sql='SELECT '+entries.map(([key],i)=>
   'to_regclass($'+(i+1)+'::text) IS NOT NULL AS "'+key+'"'
  ).join(',');
  const result=await db.query(sql,entries.map(([,name])=>name));
  const row=result.rows?.[0];
  if(!row)throw Error('mirror_preflight_db_empty');
  for(const key of Object.keys(tables))tables[key]=row[key]===true;
  databaseReadable=true;
 }catch{failures.push('mirror_preflight_database_unavailable')}
 let approvedSource=false,sourceFresh=false,sourceOnline=false;
 if(databaseReadable&&tables.xtreamServers&&pinned){
  try{
   const source=await db.query(`SELECT id,
     status='online' AND last_error IS NULL AS source_online,
     last_sync_at>NOW()-INTERVAL '48 hours' AS catalog_fresh
    FROM blofy_xtream_servers
    WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
      AND deletion_requested_at IS NULL
      AND lower(btrim(name))='saleh'
    LIMIT 1`,[sourceId]);
   const item=source.rows?.[0]||null;
   approvedSource=Boolean(item);
   sourceOnline=item?.source_online===true;
   sourceFresh=item?.catalog_fresh===true;
  }catch{failures.push('mirror_preflight_source_query_unavailable')}
 }
 if(!pinned)failures.push('mirror_preflight_source_id_not_pinned');
 if(!approvedSource)failures.push('mirror_preflight_approved_source_not_visible');
 if(approvedSource&&!sourceOnline)failures.push('mirror_preflight_source_not_online');
 if(approvedSource&&!sourceFresh)failures.push('mirror_preflight_catalog_not_fresh');
 const catalogVisible=['xtreamServers','xtreamCatalog','movieGatewayMap',
  'episodeGatewayMap','mirrorQueue'].every(x=>tables[x]);
 const privateManifestsVisible=['privateMovieManifests',
  'privateEpisodeManifests'].every(x=>tables[x]);
 const budgetVisible=tables.sharedDailyBudget;
 if(!catalogVisible)failures.push('mirror_preflight_xtream_catalog_not_on_hub_db');
 if(!privateManifestsVisible)failures.push('mirror_preflight_verified_manifests_missing');
 if(!budgetVisible)failures.push('mirror_preflight_shared_budget_table_missing');
 if(storage&&typeof storage.health==='function'){
  try{const health=await storage.health();storageReadable=health?.ok===true}
  catch{storageReadable=false}
 }
 if(!storageReadable)failures.push('mirror_preflight_private_storage_not_ready');
 const rightsAuditDeclared=env.BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED==='1';
 const movieWorkerEnabled=env.BLOFY_CONTENT_HUB_MIRROR_MOVIE_DISPATCH_ENABLED==='1';
 const episodeWorkerEnabled=env.BLOFY_CONTENT_HUB_MIRROR_EPISODE_DISPATCH_ENABLED==='1';
 const sourceVisible=approvedSource&&sourceOnline&&sourceFresh;
 const databaseCompatible=databaseReadable&&catalogVisible&&
  privateManifestsVisible&&budgetVisible&&sourceVisible;
 // This is a technical readiness report, NOT legal verification of an
 // Xtream file license, media transfer approval, physical device proof,
 // or source concurrency/capacity analysis.
 return {
  ok:true,code:databaseCompatible&&storageReadable?
   'mirror_preflight_technical_prerequisites_seen':
   'mirror_preflight_technical_prerequisites_missing',
  sourceId:pinned?sourceId:null,
  checks:{databaseReadable,approvedSource,sourceOnline,sourceFresh,
   catalogVisibleOnHubConnection:catalogVisible,
   privateManifestTablesVisible:privateManifestsVisible,
   sharedBudgetVisible:budgetVisible,
   privateStorageAccessible:storageReadable,
   operatorDeclaredRightsAudit:rightsAuditDeclared,
   movieWorkerEnabled,episodeWorkerEnabled},
  schema:tables,blockedBy:[...new Set(failures)],
  technicalDatabaseCompatible:databaseCompatible,
  technicalPreflightPassed:databaseCompatible&&storageReadable,
  perFileStorageRightsIndependentlyVerified:false,
  realProviderConcurrencyMeasured:false,
  realDevicePlaybackValidated:false,
  enableTransferAutomatically:false,
  providerRequests:0,providerMediaBytesRead:0,readOnly:true,
  customerCutover:false
 };
}

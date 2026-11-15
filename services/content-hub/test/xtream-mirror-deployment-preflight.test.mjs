import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMirrorDeploymentPreflight} from
 '../src/xtream-mirror-deployment-preflight.mjs';
import {createContentHubServer} from '../src/server.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const tables={
 xtreamServers:true,xtreamCatalog:true,movieGatewayMap:true,
 episodeGatewayMap:true,mirrorQueue:true,
 privateMovieManifests:true,privateEpisodeManifests:true,
 sharedDailyBudget:true
};
const env={BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID};
function fixture({tableMap=tables,source={
 id:ID,source_online:true,catalog_fresh:true
 },storageHealthy=true}={}){
 const queries=[];
 const db={query:async (sql,params)=>{
  queries.push({sql,params});
  if(sql.startsWith('SELECT to_regclass('))
   return {rows:[tableMap]};
  if(sql.includes('FROM blofy_xtream_servers'))
   return {rows:source?[source]:[]};
  throw Error('unexpected_preflight_sql');
 }};
 const storage={health:async()=>({ok:storageHealthy})};
 return {db,storage,queries};
}

test('read-only mirror preflight verifies exact source on the Content Hub database',async()=>{
 const f=fixture();
 const result=await inspectMirrorDeploymentPreflight({...f,env});
 assert.equal(result.ok,true);
 assert.equal(result.technicalDatabaseCompatible,true);
 assert.equal(result.technicalPreflightPassed,true);
 assert.equal(result.checks.approvedSource,true);
 assert.equal(result.checks.catalogVisibleOnHubConnection,true);
 assert.equal(result.checks.privateStorageAccessible,true);
 assert.equal(result.providerRequests,0);
 assert.equal(result.providerMediaBytesRead,0);
 assert.equal(result.enableTransferAutomatically,false);
 assert.equal(result.perFileStorageRightsIndependentlyVerified,false);
 assert.equal(result.realDevicePlaybackValidated,false);
 assert.equal(f.queries.length,2);
 assert.deepEqual(f.queries[1].params,[ID]);
 for(const q of f.queries){
  assert.match(q.sql,/SELECT/);
  assert.doesNotMatch(q.sql,/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)\b/i);
 }
});

test('Hub database missing Xtream catalog (separate PG) blocks deployment without media requests',async()=>{
 const f=fixture({tableMap:{
  ...tables,xtreamServers:false,xtreamCatalog:false,mirrorQueue:false
 }});
 const result=await inspectMirrorDeploymentPreflight({...f,env});
 assert.equal(result.technicalPreflightPassed,false);
 assert.ok(result.blockedBy.includes(
  'mirror_preflight_xtream_catalog_not_on_hub_db'));
 assert.equal(f.queries.length,1);
 assert.equal(result.enableTransferAutomatically,false);
});

test('source offline/stale, private-S3 unhealthy, budget absent fail closed',async()=>{
 const f=fixture({source:{id:ID,source_online:false,
  catalog_fresh:false},storageHealthy:false,tableMap:{
   ...tables,sharedDailyBudget:false
  }});
 const result=await inspectMirrorDeploymentPreflight({...f,env});
 assert.equal(result.technicalPreflightPassed,false);
 for(const reason of [
  'mirror_preflight_source_not_online',
  'mirror_preflight_catalog_not_fresh',
  'mirror_preflight_shared_budget_table_missing',
  'mirror_preflight_private_storage_not_ready'
 ])assert.ok(result.blockedBy.includes(reason),reason);
});

test('a missing pinned source ID never looks up arbitrary upstream credentials',async()=>{
 const f=fixture();
 const result=await inspectMirrorDeploymentPreflight({...f,env:{
  BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:'not-a-source'
 }});
 assert.equal(result.technicalPreflightPassed,false);
 assert.equal(result.sourceId,null);
 assert.equal(f.queries.length,1);
 assert.ok(result.blockedBy.includes('mirror_preflight_source_id_not_pinned'));
});

test('private preflight only works with bearer, rejects query and never enables source copy',async()=>{
 const token='Q'.repeat(40);
 const f=fixture();
 const hub=createContentHubServer({token,lease:{},
  storage:f.storage,pilotEnv:env,mirrorPreflightStore:{db:f.db}});
 await new Promise(resolve=>hub.server.listen(0,'127.0.0.1',resolve));
 try{
  const url='http://127.0.0.1:'+hub.server.address().port+
   '/internal/mirror/deployment/preflight';
  const unsigned=await fetch(url);
  assert.equal(unsigned.status,401);
  const headers={authorization:'Bearer '+token};
  assert.equal((await fetch(url+'?sourceId=evil',{headers})).status,400);
  const result=await fetch(url,{headers});
  assert.equal(result.status,200);
  const json=await result.json();
  assert.equal(json.technicalPreflightPassed,true);
  assert.equal(json.enableTransferAutomatically,false);
  assert.equal(json.customerCutover,false);
  assert.equal(f.queries.length,2);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

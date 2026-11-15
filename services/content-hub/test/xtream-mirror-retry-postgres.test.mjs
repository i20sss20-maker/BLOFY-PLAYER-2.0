// Real disposable PostgreSQL integration. No Xtream access, no S3 media,
// no production DB, no customer routing. Validates source/rights/mapping
// guards and cross-movie+episode retry budget atomically.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createXtreamMirrorDiscoveryStore} from
 '../../activation/src/xtream-mirror-discovery-queue.mjs';
import {createMirrorMovieTransferStore} from
 '../src/xtream-mirror-movie-transfer.mjs';
import {createMirrorEpisodeTransferStore} from
 '../src/xtream-mirror-episode-transfer.mjs';
import {inspectMirrorDeploymentPreflight} from
 '../src/xtream-mirror-deployment-preflight.mjs';

const PG=process.env.BLOFY_TEST_PG_URL||'';
const SOURCE='123e4567-e89b-42d3-a456-426614174000';
const PART=8*1024*1024;
const SHA='b'.repeat(64);
const DAY='2026-11-15';

test('real PG cross-media copy budget, durable checkpoints and 3 maximum retries',
 {skip:!PG},async()=>{
 const schema='mirror_retry_'+process.pid;
 const owner=new pg.Pool({connectionString:PG,max:2});
 class IsolatedPool extends pg.Pool{
  constructor(opts={}){super({...opts,options:'-c search_path='+schema})}
 }
 const pool=new IsolatedPool({connectionString:PG,max:3});
 let movie,episode;
 try{
  await owner.query('CREATE SCHEMA "'+schema+'"');
  await pool.query(`CREATE TABLE blofy_xtream_servers (
    id UUID PRIMARY KEY,name TEXT NOT NULL,
    enabled BOOLEAN,publish_catalog BOOLEAN,
    deletion_requested_at TIMESTAMPTZ,status TEXT,
    last_error TEXT,last_sync_at TIMESTAMPTZ)`);
  await pool.query(`CREATE TABLE blofy_xtream_gateway_item_map (
    server_id UUID,media_type TEXT,gateway_id BIGINT,source_id TEXT)`);
  await pool.query(`CREATE TABLE blofy_xtream_gateway_episode_map (
    server_id UUID,gateway_id BIGINT,source_episode_id TEXT,
    series_source_id TEXT,container_extension TEXT)`);
  await pool.query(`CREATE TABLE blofy_xtream_items (
    server_id UUID,media_type TEXT,source_id TEXT,
    enabled BOOLEAN,container_extension TEXT)`);
  const discovery=createXtreamMirrorDiscoveryStore(pool);
  await discovery.ensure();
  await pool.query(`INSERT INTO blofy_xtream_servers(
    id,name,enabled,publish_catalog,status,last_sync_at)
    VALUES($1,'saleh',TRUE,TRUE,'online',NOW())`,[SOURCE]);
  await pool.query(`INSERT INTO blofy_xtream_gateway_item_map
    VALUES($1,'movie',15,'test-movie')`,[SOURCE]);
  await pool.query(`INSERT INTO blofy_xtream_gateway_episode_map
    VALUES($1,401,'test-ep','test-series','mkv')`,[SOURCE]);
  await pool.query(`INSERT INTO blofy_xtream_items
    VALUES($1,'movie','test-movie',TRUE,'mp4'),
      ($1,'series','test-series',TRUE,'mkv')`,[SOURCE]);
  await pool.query(`INSERT INTO blofy_xtream_mirror_items (
   source_id,media_kind,gateway_id,media_id,extension,title,state,
   rights_ref_sha256,license_reviewed_at,size_probe_at,expected_bytes)
    VALUES
      ($1,'movie',15,'test-movie','mp4','Fixture movie','approved',
       $2,NOW(),NOW(),16777216),
      ($1,'episode',401,'test-ep','mkv','Fixture episode','approved',
       $2,NOW(),NOW(),16777216)`,[SOURCE,SHA]);
  // A real PG connection can see the Xtream tables yet not the Hub
  // private manifest/budget tables; an operator must NOT enable copy.
  const beforeSetup=await inspectMirrorDeploymentPreflight({
   db:pool,storage:{health:async()=>({ok:true})},
   env:{BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:SOURCE}
  });
  assert.equal(beforeSetup.checks.catalogVisibleOnHubConnection,true);
  assert.equal(beforeSetup.checks.privateManifestTablesVisible,false);
  assert.equal(beforeSetup.checks.sharedBudgetVisible,false);
  assert.equal(beforeSetup.technicalPreflightPassed,false);

  movie=createMirrorMovieTransferStore({
   connectionString:PG,Pool:IsolatedPool});
  episode=createMirrorEpisodeTransferStore({
   connectionString:PG,Pool:IsolatedPool});

  const m1=await movie.claim({
   sourceId:SOURCE,localDay:DAY,dailyBytesLimit:64*1024**2});
  assert.equal(m1.ok,true,JSON.stringify(m1));
  const e1=await episode.claim({
   sourceId:SOURCE,day:DAY,limit:64*1024**2});
  assert.equal(e1.ok,true,JSON.stringify(e1));
  assert.match(m1.runId,/^mirror_[a-f0-9]{40}$/);
  assert.match(e1.runId,/^mirror_[a-f0-9]{40}$/);
  assert.notEqual(m1.runId,e1.runId);
  // The transfer workers created the shared PG budget in this schema;
  // supply separate sample manifest tables without writing actual media.
  await pool.query('CREATE TABLE blofy_content_hub_chunk_runs (run_id TEXT)');
  await pool.query('CREATE TABLE blofy_content_hub_episode_runs (run_id TEXT)');
  const ready=await inspectMirrorDeploymentPreflight({
   db:pool,storage:{health:async()=>({ok:true})},
   env:{BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:SOURCE}
  });
  assert.equal(ready.technicalDatabaseCompatible,true);
  assert.equal(ready.technicalPreflightPassed,true);
  assert.equal(ready.enableTransferAutomatically,false);
  assert.equal(ready.perFileStorageRightsIndependentlyVerified,false);
  assert.equal(ready.providerRequests,0);
  const before=await movie.status(SOURCE);
  assert.equal(before.dailyBudgets[0].bytesReserved,2*PART,
   'movie and episode must share ONE atomic PG source-day budget');
  const eBefore=await episode.status(SOURCE);
  assert.equal(eBefore.dailyBudgets[0].reservedBytes,2*PART);

  const transient=await movie.finish(m1,{
   status:'retry',parts:1,code:'batch_retryable_error'});
  assert.equal(transient.ok,true);
  assert.equal(transient.state,'approved');
  assert.equal(transient.retryAttempts,1);
  assert.ok(new Date(transient.retryAfter).getTime()>Date.now());
  const blocked=await movie.claim({
   sourceId:SOURCE,localDay:DAY,dailyBytesLimit:64*1024**2});
  assert.equal(blocked.ok,false);
  assert.equal(blocked.code,'mirror_movie_no_approved_item');

  const eSaved=await episode.finish(e1,{
   state:'approved',parts:1});
  assert.equal(eSaved.ok,true);
  const afterEpisode=await pool.query(`SELECT copied_parts,copy_retry_count,
    state FROM blofy_xtream_mirror_items
    WHERE source_id=$1 AND media_kind='episode'`,[SOURCE]);
  assert.equal(afterEpisode.rows[0].copied_parts,1);
  assert.equal(afterEpisode.rows[0].copy_retry_count,0);

  // Force the retry clock forward with a disposable DB; production code
  // never ignores its 15 minute clock.
  for(let attempt=2;attempt<=3;attempt++){
   await pool.query(`UPDATE blofy_xtream_mirror_items
     SET copy_retry_after=NOW()-INTERVAL '1 second'
     WHERE source_id=$1 AND media_kind='movie'`,[SOURCE]);
   const claim=await movie.claim({
    sourceId:SOURCE,localDay:DAY,dailyBytesLimit:64*1024**2});
   assert.equal(claim.ok,true);
   assert.equal(claim.runId,m1.runId,'resume exact prior SHA S3 lineage');
   const saved=await movie.finish(claim,{
    status:'retry',parts:1,code:'batch_retryable_error'});
   assert.equal(saved.ok,true);
   assert.equal(saved.retryAttempts,attempt);
   assert.equal(saved.state,attempt===3?'failed':'approved');
  }
  const failed=await pool.query(`SELECT state,copy_retry_count,
     copy_retry_after,copy_run_id,copied_parts
    FROM blofy_xtream_mirror_items WHERE source_id=$1
    AND media_kind='movie'`,[SOURCE]);
  assert.equal(failed.rows[0].state,'failed');
  assert.equal(failed.rows[0].copy_retry_count,3);
  assert.equal(failed.rows[0].copy_retry_after,null);
  assert.equal(failed.rows[0].copied_parts,1);
  assert.equal(failed.rows[0].copy_run_id,m1.runId);

  const canClaimMovie=await movie.claim({
   sourceId:SOURCE,localDay:DAY,dailyBytesLimit:64*1024**2});
  assert.equal(canClaimMovie.ok,false);
  assert.equal(canClaimMovie.code,'mirror_movie_no_approved_item');
  // An episode finishing later does not reset the movie's failed status.
  const e2=await episode.claim({
   sourceId:SOURCE,day:DAY,limit:64*1024**2});
  assert.equal(e2.ok,true);
  assert.equal(e2.runId,e1.runId);
  const verified=await episode.finish(e2,{
   state:'verified',parts:2,sha256:SHA});
  assert.equal(verified.ok,true);
  const eFinal=await pool.query(`SELECT state,copy_sha256,
    copy_retry_count,copy_retry_after
    FROM blofy_xtream_mirror_items
    WHERE source_id=$1 AND media_kind='episode'`,[SOURCE]);
  assert.equal(eFinal.rows[0].state,'verified');
  assert.equal(eFinal.rows[0].copy_sha256,SHA);
  assert.equal(eFinal.rows[0].copy_retry_count,0);
  assert.equal(eFinal.rows[0].copy_retry_after,null);
 }finally{
  await Promise.allSettled([movie?.close(),episode?.close()]);
  await pool.end();
  await owner.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');
  await owner.end();
 }
});

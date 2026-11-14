import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createSeasonQueueStore} from '../src/season-queue.mjs';
import {createContentCatalogStore} from '../src/curated-metadata.mjs';

// Uses only an ephemeral CI Postgres service. No source, S3 or customer data.
test('real PostgreSQL executes reporting and chunk-timing queries safely',{
 skip:!process.env.BLOFY_TEST_PG_URL
},async()=>{
 const url=process.env.BLOFY_TEST_PG_URL;
 const pool=new Pool({connectionString:url});
 const store=createSeasonQueueStore({connectionString:url});
 const catalog=createContentCatalogStore({connectionString:url});
 const runId='season_ci_0123456789abcdef';
 try{
  await store.ensure();
  await pool.query([
   'INSERT INTO blofy_content_hub_season_queue',
   '(run_id,season_key,episode_number,title,gateway_id,source_id,',
   'media_id,extension,expected_bytes,state,code)',
   "VALUES($1,'series_ci_s01',1,'Offline fixture',9512365,",
   "'00000000-0000-4000-8000-000000000001'::uuid,",
   "'fixture','mp4',8388608,'failed','episode_source_busy')"
  ].join(' '),[runId]);
  const missing=await store.analyticsStats();
  assert.equal(Number(missing.sample_count||0),0);
  await store.recordTransferMetric({runId,bytes:8388608,
   durationMs:20000,code:'episode_checkpoint_saved',
   stageTimingsMs:{source_chunk:9000,boundary_precheck:1000,
    s3_upload:6500,s3_verify:2000,checkpoint:1500}});
  const stats=await store.analyticsStats();
  assert.equal(stats.sample_count,'1');
  assert.equal(stats.transfer_bytes,'8388608');
  assert.equal(stats.source_ms,'9000');
  assert.equal(stats.boundary_ms,'1000');
  assert.equal(stats.upload_ms,'6500');
  assert.equal(stats.verification_ms,'2000');
  const seasons=await store.seasonAnalyticsSummary();
  assert.equal(seasons[0].episode_count,'1');
  assert.equal(seasons[0].failed_count,'1');
  const reasons=await store.failureReasons();
  assert.equal(reasons[0].code,'episode_source_busy');
  const events=await store.recentTransferEvents();
  assert.equal(events[0].seasonKey,'series_ci_s01');
  assert.equal(events[0].bytes,8388608);
  const states=await store.recentEpisodeStates();
  assert.equal(states[0].state,'failed');
  assert.equal(states[0].snapshotOnly,true);
  assert.equal(states[0].percent,0);
  const detail=await store.seasonDetailPage({seasonKey:'series_ci_s01',page:1});
  assert.equal(detail.totals.episode_count,'1');
  assert.equal(detail.page.pages,1);
  assert.equal(detail.episodes[0].state,'failed');
  assert.equal(detail.episodes[0].title,'Offline fixture');
  assert.equal(detail.episodes[0].storedBytes,0);
  const history=await store.seasonTransferEvents({seasonKey:'series_ci_s01'});
  assert.equal(history.length,1);
  assert.equal(history[0].durationMs,20000);
  const outside=await store.seasonDetailPage({seasonKey:'series_no_s07',page:1});
  assert.equal(outside,null);
  const emptyPage=await store.seasonDetailPage({seasonKey:'series_ci_s01',page:2});
  assert.equal(emptyPage.episodes.length,0);
  await assert.rejects(store.seasonDetailPage({seasonKey:'bad/season',page:1}),
   /season_report_selection_invalid/);
  const timing=await store.seasonTimingStats({seasonKey:'series_ci_s01'});
  assert.equal(timing.sample_count,'1');
  assert.equal(timing.active_ms,'20000');
  assert.equal(timing.measured_bytes,'8388608');
  assert.ok(timing.first_measured_at);
  assert.equal((await store.seasonTimingStats({seasonKey:'series_none_s01'}))
   .sample_count,'0');
  assert.equal((await store.setPriority({runId,priority:2})).code,
   'season_priority_not_pending');
  const pending='season_ci_pending_12345678';
  const high='season_ci_urgent_123456789';
  for(const [id,episode,gate] of [[pending,2,9512366],[high,3,9512367]]){
   await pool.query([
    'INSERT INTO blofy_content_hub_season_queue',
    '(run_id,season_key,episode_number,title,gateway_id,source_id,',
    'media_id,extension,expected_bytes,state)',
    "VALUES ($1,'series_ci_s01',$2,'Pending', $3,",
    "'00000000-0000-4000-8000-000000000001'::uuid,",
    "'fixture','mp4',8388608,'queued')"
   ].join(' '),[id,episode,gate]);
  }
  // Read-only preview does not change the worker or object storage.
  const preview=await store.resumePreview();
  assert.equal(preview.automaticStart,false);
  assert.equal(preview.sourceProbePerformed,false);
  assert.equal(preview.items.length,0);
  const before=await pool.query(
   'SELECT updated_at FROM blofy_content_hub_season_queue WHERE run_id=$1',
   [high]);
  const saved=await store.setPriority({runId:high,priority:2});
  assert.equal(saved.ok,true);
  assert.equal(saved.automaticStart,false);
  const after=await pool.query(
   'SELECT updated_at,priority FROM blofy_content_hub_season_queue WHERE run_id=$1',
   [high]);
  assert.equal(Number(after.rows[0].priority),2);
  assert.equal(String(before.rows[0].updated_at),String(after.rows[0].updated_at));
  assert.equal((await store.seasonDetailPage({
   seasonKey:'series_ci_s01',page:1})).episodes[2].priority,2);
  assert.equal((await store.setPriority({runId:high,priority:9})).code,
   'season_priority_invalid');
  const lock=await store.acquireWorker();
  assert.ok(lock);
  assert.equal((await store.setPriority({runId:pending,priority:1})).code,
   'season_priority_worker_active');
  await lock.release();
  // Production priority ordering is enforced on claims, not only in the UI.
  const job=await store.claimNext();
  assert.equal(job.runId,high);
  assert.equal(job.priority,2);
  await store.update(high,'paused',{code:'season_queue_paused'});
  assert.equal((await store.setPriority({runId:high,priority:1})).ok,true);
  const pausedPreview=await store.resumePreview();
  assert.equal(pausedPreview.items[0].runId,high);
  assert.equal(pausedPreview.items[0].databaseSnapshotOnly,true);
  const other=await store.claimNext();
  assert.equal(other.runId,pending);
  await store.update(pending,'paused',{code:'season_queue_paused'});
  const h=await store.healthStats();
  assert.equal(h.episode_count,'3');
  assert.equal(h.season_count,'1');
  // Upgrade safety: production queue has no priority column initially.
  // Claim stays FIFO, and operator action migrates only while idle.
  await pool.query('ALTER TABLE blofy_content_hub_season_queue DROP COLUMN priority');
  const legacy='season_ci_legacy_123456789';
  await pool.query([
   'INSERT INTO blofy_content_hub_season_queue',
   '(run_id,season_key,episode_number,title,gateway_id,source_id,',
   'media_id,extension,expected_bytes,state)',
   "VALUES ($1,'series_ci_s01',4,'Legacy',9512368,",
   "'00000000-0000-4000-8000-000000000001'::uuid,",
   "'fixture','mp4',8388608,'queued')"
  ].join(' '),[legacy]);
  const fifo=await store.claimNext();
  assert.equal(fifo.runId,legacy);
  assert.equal(fifo.priority,0);
  await store.update(legacy,'paused',{code:'season_queue_paused'});
  const migrated=await store.setPriority({runId:legacy,priority:2});
  assert.equal(migrated.ok,true);
  const newColumn=await pool.query(
   'SELECT priority FROM blofy_content_hub_season_queue WHERE run_id=$1',
   [legacy]);
  assert.equal(Number(newColumn.rows[0].priority),2);
  // The triage index reads historical failed/paused/partial queue snapshots.
  // It may not request source media and cannot alter any persisted state.
  const attention=await store.attentionRows({limit:51});
  const failed=attention.find(r=>r.runId===runId);
  const paused=attention.find(r=>r.runId===high);
  assert.equal(failed.state,'failed');
  assert.equal(failed.code,'episode_source_busy');
  assert.equal(failed.storedBytes,0);
  assert.equal(failed.manualRetries,0);
  assert.equal(paused.state,'paused');
  assert.ok(attention.length<=51);
  assert.equal((await pool.query(
   "SELECT state FROM blofy_content_hub_season_queue WHERE run_id=$1",
   [runId])).rows[0].state,'failed');
  // Full database search is paged and does not perform source-media reads.
  const library=await store.librarySearch({
   query:'Pending',state:'all',page:1});
  assert.equal(library.episodes.length,2);
  assert.equal(library.seasons.length,1);
  // Whole-season counts remain full despite title match on only two episodes.
  assert.equal(library.seasons[0].episodeCount,4);
  assert.equal(library.seasons[0].fullyVerifiedInQueue,false);
  assert.equal(library.episodes.some(x=>x.title==='Pending'),true);
  const byState=await store.librarySearch({
   query:'series_ci_s01',state:'failed',page:1});
  assert.equal(byState.episodes.length,1);
  assert.equal(byState.episodes[0].runId,runId);
  assert.equal(byState.seasons[0].episodeCount,4);
  const afterPage=await store.librarySearch({
   query:'Pending',state:'all',page:2});
  assert.equal(afterPage.episodes.length,0);
  assert.equal(afterPage.seasons.length,0);
  assert.equal(library.automaticStart,false);
  assert.equal(library.storageRequests,0);



  // Curated names are stored only after the owner edits a persisted series.
  // Full title search must remain an index of *registered* queue episodes.
  const curatedRun='season_curated_pg_123456789';
  await pool.query([
   'INSERT INTO blofy_content_hub_season_queue',
   '(run_id,season_key,episode_number,title,gateway_id,source_id,',
   'media_id,extension,expected_bytes,state)',
   "VALUES($1,'series_987654321_s01',1,'Fixture heading',98675345,",
   "'00000000-0000-4000-8000-000000000001'::uuid,",
   "'fixture','mp4',8388608,'queued')"
  ].join(' '),[curatedRun]);
  const metadata={key:'series:987654321',title:'Curated Neon Voyage',
   year:2025,genre:'drama',overview:'Test-only catalog information',
   posterPath:'/ValidCover1234.jpg',confirmed:true,
   artworkRightsConfirmed:true};
  assert.equal(await catalog.hasRegisteredKey('series:987654321'),true);
  assert.equal(await catalog.hasRegisteredKey('series:987654322'),false);
  assert.deepEqual(await catalog.episodeTitleHints('series:987654321'),
   ['Fixture heading']);
  assert.deepEqual(await catalog.episodeTitleHints('movie:movie_missing'),[]);
  const curatedSaved=await catalog.save(metadata);
  assert.equal(curatedSaved.ok,true);
  assert.equal(curatedSaved.metadata.source,'owner_curated');
  assert.equal(curatedSaved.metadata.posterPath,metadata.posterPath);
  const names=await catalog.searchSeriesIds('Neon Voyage');
  assert.deepEqual(names.ids,['987654321']);
  const full=await store.librarySearch({
   query:'Neon Voyage',state:'all',page:1,seriesIds:names.ids});
  assert.equal(full.episodes.length,1);
  assert.equal(full.episodes[0].runId,curatedRun);
  assert.equal(full.seasons.length,1);
  assert.equal(full.seasons[0].episodeCount,1);
  const seriesDetail=await store.registeredSeriesSummary({seriesId:'987654321'});
  assert.equal(seriesDetail.readOnly,true);
  assert.equal(seriesDetail.providerMediaRequests,0);
  assert.equal(seriesDetail.seasonSummaries.length,1);
  assert.equal(seriesDetail.seasonSummaries[0].seasonKey,'series_987654321_s01');
  assert.equal(seriesDetail.seasonSummaries[0].episodeCount,1);
  assert.equal(seriesDetail.seasonSummaries[0].verifiedCount,0);
  assert.equal(seriesDetail.hasMoreSeasons,false);
  const notRegistered=await store.registeredSeriesSummary({seriesId:'987654322'});
  assert.equal(notRegistered.seasonSummaries.length,0);

  // Durable owner A/V review is separate from media verification and
  // exists only for rows confirmed in BOTH private queue and episode run.
  const avRun='season_av_pg_123456789';
  await pool.query([
   'INSERT INTO blofy_content_hub_season_queue',
   '(run_id,season_key,episode_number,title,gateway_id,source_id,',
   'media_id,extension,expected_bytes,state)',
   "VALUES($1,'series_987654321_s02',1,'Test episode for AV',98675346,",
   "'00000000-0000-4000-8000-000000000001'::uuid,",
   "'fixture','mp4',8388608,'verified')"
  ].join(' '),[avRun]);
  await pool.query([
   'CREATE TABLE IF NOT EXISTS blofy_content_hub_episode_runs (',
   'run_id TEXT PRIMARY KEY,state TEXT NOT NULL,',
   'source_id UUID NOT NULL,media_id TEXT NOT NULL,',
   'gateway_id INTEGER NOT NULL,extension TEXT NOT NULL,',
   'expected_bytes BIGINT NOT NULL,bytes_copied BIGINT NOT NULL DEFAULT 0,',
   "parts JSONB NOT NULL DEFAULT '[]'::jsonb,",
   'updated_at TIMESTAMPTZ DEFAULT NOW())'
  ].join(' '));
  await pool.query([
   'INSERT INTO blofy_content_hub_episode_runs',
   '(run_id,state,source_id,media_id,gateway_id,extension,',
   'expected_bytes,bytes_copied)',
   "VALUES($1,'verified','00000000-0000-4000-8000-000000000001'::uuid,",
   "'fixture',98675346,'mp4',8388608,8388608)"
  ].join(' '),[avRun]);
  assert.equal(await store.ownsVerifiedRun(avRun),true);
  assert.equal((await store.episodeAvReviews({runIds:[avRun]})).length,0);
  assert.equal((await store.confirmEpisodeAv({runId:curatedRun})).code,
   'episode_av_not_storage_verified');
  const confirmedAv=await store.confirmEpisodeAv({runId:avRun});
  assert.equal(confirmedAv.ok,true);
  assert.equal(confirmedAv.videoOwnerConfirmed,true);
  assert.equal(confirmedAv.audioOwnerConfirmed,true);
  assert.equal(confirmedAv.automaticVerification,false);
  // Global queue audit covers all registered seasons, not a 50-row UI page.
  const readiness=await store.readinessAudit({page:1});
  assert.equal(readiness.readOnly,true);
  assert.equal(readiness.databaseSnapshotOnly,true);
  assert.equal(readiness.manifestStateAvailable,true);
  assert.equal(readiness.ownerReviewSchemaAvailable,true);
  assert.equal(readiness.global.ownerAvReviewedEpisodes,1);
  assert.equal(readiness.global.verifiedAwaitingOwnerAv,0);
  assert.ok(readiness.global.registeredEpisodes>=6);
  assert.ok(readiness.global.registeredSeasons>=3);
  assert.equal(readiness.seasons.find(x=>
   x.seasonKey==='series_987654321_s02').ownerAvReviewedEpisodes,1);
  const seasonReady=readiness.seasons.find(x=>
   x.seasonKey==='series_987654321_s02').privateDeviceTestGate;
  assert.equal(seasonReady.canConsiderPrivateDeviceTest,true);
  assert.equal(seasonReady.customerReleaseApproved,false);
  assert.equal(seasonReady.distributionRightsVerified,false);

  assert.equal(readiness.providerMediaRequests,0);
  assert.equal(readiness.storageRequests,0);
  const repeatedAv=await store.confirmEpisodeAv({runId:avRun});
  assert.equal(repeatedAv.code,'episode_av_owner_review_already_saved');
  assert.equal(String(repeatedAv.confirmedAt),String(confirmedAv.confirmedAt));
  const avPage=await store.seasonDetailPage({
   seasonKey:'series_987654321_s02',page:1});
  assert.equal(avPage.episodes.length,1);
  assert.equal(avPage.episodes[0].verified,true);
  assert.ok(avPage.episodes[0].ownerAvConfirmedAt);
  assert.equal((await pool.query(
   "SELECT state FROM blofy_content_hub_season_queue WHERE run_id=$1",
   [avRun])).rows[0].state,'verified');
  // If an episode ever stops being verified, stored human proof is not
  // shown as current verified media playback proof.
  await pool.query(
   "UPDATE blofy_content_hub_season_queue SET state='paused' WHERE run_id=$1",
   [avRun]);
  assert.equal((await store.episodeAvReviews({runIds:[avRun]})).length,0);
  const afterUnverify=await store.readinessAudit({page:1});
  assert.equal(afterUnverify.global.ownerAvReviewedEpisodes,0);
  // Re-verification after an older A/V review must invalidate that review;
  // stale human approval must never become proof for new media bytes.
  await pool.query(
   "UPDATE blofy_content_hub_season_queue SET state='verified',updated_at=NOW()+INTERVAL '1 minute' WHERE run_id=$1",
   [avRun]);
  assert.equal((await store.episodeAvReviews({runIds:[avRun]})).length,0);
  const stale=await store.readinessAudit({page:1});
  assert.equal(stale.global.storageVerifiedEpisodes,1);
  assert.equal(stale.global.ownerAvReviewedEpisodes,0);
  assert.equal(stale.global.verifiedAwaitingOwnerAv,1);
  const staleGate=stale.seasons.find(x=>
   x.seasonKey==='series_987654321_s02').privateDeviceTestGate;
  assert.equal(staleGate.canConsiderPrivateDeviceTest,false);
  assert.ok(staleGate.blockingReasons.includes('owner_av_review_incomplete'));

  assert.equal((await catalog.find(['series:987654321']))[0].title,
   'Curated Neon Voyage');
  assert.equal((await catalog.save({...metadata,
   key:'series:987654322'})).code,'curated_media_not_registered');
 }finally{
  await catalog.close();await store.close();await pool.end();
 }
});

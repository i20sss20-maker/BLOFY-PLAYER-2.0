import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {createSeasonQueueStore} from '../src/season-queue.mjs';

// Uses only an ephemeral CI Postgres service. No source, S3 or customer data.
test('real PostgreSQL executes reporting and chunk-timing queries safely',{
 skip:!process.env.BLOFY_TEST_PG_URL
},async()=>{
 const url=process.env.BLOFY_TEST_PG_URL;
 const pool=new Pool({connectionString:url});
 const store=createSeasonQueueStore({connectionString:url});
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
 }finally{
  await store.close();await pool.end();
 }
});

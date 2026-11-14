import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeasonAnalytics,seasonTransferReason} from '../src/season-analytics.mjs';

test('uses measured chunk time, not storage size divided by season age',()=>{
 const out=buildSeasonAnalytics({health:{episodeCount:4,verifiedCount:2,
  storedBytes:2000,expectedBytes:4000},metrics:{
  transfer_bytes:'10485760',active_ms:'20000',sample_count:'2',
  first_recorded_at:'2026-11-14T08:00:00Z'},
  seasons:[{season_key:'series_s1',episode_count:'4',verified_count:'2',
   failed_count:'1',queued_count:'1',running_count:'0',paused_count:'0',
   expected_bytes:'4000',stored_bytes:'2000'}]});
 assert.equal(out.totals.averageBytesPerSecond,524288);
 assert.equal(out.totals.transferSamples,2);
 assert.equal(out.seasonSummaries[0].percent,50);
 assert.equal(out.bucketCapacityKnown,false);
 assert.equal(out.providerMediaRequests,0);
 assert.equal(out.readOnly,true);
});
test('unknown speed is null, not falsely zero or an inferred bitrate',()=>{
 const out=buildSeasonAnalytics({health:{episodeCount:2,storedBytes:65536}});
 assert.equal(out.totals.averageBytesPerSecond,null);
 assert.equal(out.totals.speedHistoryIncomplete,true);
 assert.ok(out.diagnostics.some(x=>x.code==='speed_not_measured'));
});
test('alerts and failure stages produce hints without exposing upstream URLs',()=>{
 const out=buildSeasonAnalytics({health:{alerts:[
  {code:'season_checkpoint_no_progress'},
  {code:'season_storage_integrity_mismatch'}]},
  failures:[{code:'episode_source_busy',total:'3'}],
  events:[{runId:'season_abcdefghijkl',seasonKey:'my_show_s1',episodeNumber:3,
   bytes:8388608,durationMs:120000,code:'episode_checkpoint_saved',
   recordedAt:'2026-11-14T08:00:00Z'}]});
 assert.ok(out.diagnostics.some(x=>x.code==='checkpoint_stalled'));
 assert.ok(out.diagnostics.some(x=>x.code==='checksum_failure'));
 assert.ok(out.diagnostics.some(x=>x.code==='slow_recent_chunks'));
 assert.match(seasonTransferReason('episode_source_busy'),/المصدر/);
 assert.equal(out.failureReasons[0].count,3);
 assert.equal(JSON.stringify(out).includes('username='),false);
});

test('stage diagnostics highlight the slowest recorded section, not a guessed provider fault',()=>{
 const out=buildSeasonAnalytics({health:{episodeCount:6},
  metrics:{sample_count:'3',stage_sample_count:'3',
   active_ms:'300000',transfer_bytes:'25165824',
   source_ms:'210000',boundary_ms:'30000',
   upload_ms:'20000',verification_ms:'30000'}});
 assert.equal(out.stageSamples,3);
 assert.equal(out.timingBreakdown.find(x=>x.stage==='source').sharePercent,80);
 assert.ok(out.diagnostics.some(x=>x.code==='dominant_source'));
 assert.equal(out.totals.averageBytesPerSecond,83886);
});

test('existing episode states are explicitly snapshots, not inferred transfer events',()=>{
 const state={runId:'season_0123456789abcdef01234567',
  seasonKey:'series_s02',episodeNumber:7,title:'الحلقة السابعة',
  state:'failed',code:'episode_source_busy',storedBytes:1048576,
  expectedBytes:8388608,percent:12,updatedAt:'2026-11-14T06:44:00Z'};
 const out=buildSeasonAnalytics({episodeStates:[state]});
 assert.equal(out.recentEvents.length,0);
 assert.equal(out.recentEpisodeStates.length,1);
 assert.equal(out.recentEpisodeStates[0].snapshotOnly,true);
 assert.equal(out.recentEpisodeStates[0].state,'failed');
 assert.equal(out.recentEpisodeStates[0].percent,12);
});

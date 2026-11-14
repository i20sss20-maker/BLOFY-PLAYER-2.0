import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeSeasonHealth,seasonStorageSamplePositions,
  auditSeasonEpisodeSample} from '../src/season-health.mjs';
import {createContentHubServer} from '../src/server.mjs';

const runId='saleh_episode_127434_20261114',token='x'.repeat(48);
test('season monitoring distinguishes exact DB bytes from unknown physical bucket free space',()=>{
 const result=summarizeSeasonHealth({stats:{
  episode_count:'4',verified_count:'1',queued_count:'1',running_count:'1',
  paused_count:'0',failed_count:'1',expected_bytes:'1000',
  stored_bytes:'900',verified_bytes:'300'},
  worker:{active:false},storageSoftLimitBytes:'1000',
  audits:[{runId,code:'season_storage_checksum_mismatch',
   checkedParts:2,totalParts:173,checkedBytes:8388608,
   checkedAt:'2026-11-14T00:00:00Z'}],now:0});
 assert.equal(result.ok,true);
 assert.equal(result.episodeCount,4);
 assert.equal(result.verifiedBytes,300);
 assert.equal(result.storedBytes,900);
 assert.equal(result.percent,90);
 assert.equal(result.bucketCapacityKnown,false);
 assert.equal(result.bucketFreeBytes,null);
 assert.deepEqual(result.alerts.map(a=>a.code),[
  'season_episodes_failed','season_worker_interrupted',
  'season_storage_budget_near_threshold',
  'season_storage_integrity_mismatch']);
 assert.equal(result.latestAudits.length,1);
});
test('three distinct sample positions with no full-file assumption',()=>{
 assert.deepEqual(seasonStorageSamplePositions(1),[0]);
 assert.deepEqual(seasonStorageSamplePositions(2),[0,1]);
 assert.deepEqual(seasonStorageSamplePositions(173),[0,86,172]);
 assert.throws(()=>seasonStorageSamplePositions(1025));
 const zero=summarizeSeasonHealth({});
 assert.equal(zero.budgetBytes,null);
 assert.equal(zero.alerts.length,0);
});
function fakeManifest(){
 const parts=Array.from({length:173},(_,i)=>({
  partNumber:i+1,bytes:256,
  key:'saleh/episode/pilot/part_'+i,
  sha256:createHash('sha256').update(String(i)).digest('hex')
 }));
 return {parts};
}
test('manual audit checks <=3 S3 chunks, not the upstream provider or entire file',async()=>{
 const chunks=[],result=await auditSeasonEpisodeSample({runId,
  lease:{getVerifiedEpisodeObject:async()=>fakeManifest()},
  storage:{verify:async({key,expectedBytes,expectedSha256})=>{
   chunks.push(key);return {ok:true,bytes:expectedBytes,sha256:expectedSha256};
  }}});
 assert.equal(result.ok,true);
 assert.equal(result.checkedParts,3);
 assert.equal(result.totalParts,173);
 assert.equal(result.checkedBytes,768);
 assert.equal(result.sampledOnly,true);
 assert.equal(result.fullFileVerifiedNow,false);
 assert.deepEqual(chunks,[
  'saleh/episode/pilot/part_0','saleh/episode/pilot/part_86',
  'saleh/episode/pilot/part_172']);
});
test('mismatch and S3 outage are clearly distinguished',async()=>{
 const lease={getVerifiedEpisodeObject:async()=>fakeManifest()};
 const mismatch=await auditSeasonEpisodeSample({runId,lease,
  storage:{verify:async()=>({ok:false,bytes:256,sha256:'0'.repeat(64)})}});
 assert.equal(mismatch.code,'season_storage_checksum_mismatch');
 const outage=await auditSeasonEpisodeSample({runId,lease,
  storage:{verify:async()=>{throw Error('not found')}}});
 assert.equal(outage.code,'season_storage_read_unavailable');
 assert.notEqual(outage.code,mismatch.code);
 const noManifest=await auditSeasonEpisodeSample({runId,lease:{
  getVerifiedEpisodeObject:async()=>null},storage:{verify:async()=>{}}});
 assert.equal(noManifest.code,'season_storage_manifest_unavailable');
});
test('authenticated health is read-only and audit requires owner confirmation',async()=>{
 const writes=[],store={
  healthStats:async()=>({episode_count:'1',verified_count:'1',
   queued_count:'0',running_count:'0',paused_count:'0',failed_count:'0',
   expected_bytes:'512',stored_bytes:'512',verified_bytes:'512'}),
  recentAudits:async()=>[],
  ownsVerifiedRun:async()=>true,
  saveAudit:async(id,result)=>{writes.push({id,result})}
 };
 const hub=createContentHubServer({token,storage:{verify:async e=>({
  ok:true,bytes:e.expectedBytes,sha256:e.expectedSha256})},
  lease:{getVerifiedEpisodeObject:async()=>fakeManifest()},
  seasonQueueStore:store,pilotEnv:{
   BLOFY_CONTENT_HUB_EPISODE_RUN_ID:runId}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const base='http://127.0.0.1:'+hub.server.address().port;
 const auth={authorization:'Bearer '+token};
 try{
  assert.equal((await fetch(base+'/internal/seasons/health')).status,401);
  const healthy=await fetch(base+'/internal/seasons/health',{headers:auth});
  assert.equal(healthy.status,200);
  assert.equal((await healthy.json()).bucketCapacityKnown,false);
  assert.equal((await fetch(base+'/internal/seasons/audit',{
   method:'POST',headers:{...auth,'content-type':'application/json'},
   body:JSON.stringify({runId,confirmed:true})})).status,403);
  const audited=await fetch(base+'/internal/seasons/audit',{
   method:'POST',headers:{...auth,'content-type':'application/json',
    'x-blofy-season-confirm':'audit-private-verified-chunks'},
   body:JSON.stringify({runId,confirmed:true})});
  assert.equal(audited.status,200);
  assert.equal((await audited.json()).sampledOnly,true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].id,runId);
  assert.equal((await fetch(base+'/internal/seasons/audit',{
   method:'POST',headers:{...auth,'content-type':'application/json',
    'x-blofy-season-confirm':'audit-private-verified-chunks'},
   body:JSON.stringify({runId,confirmed:true})})).status,429);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastSeasonTransfer} from '../src/season-forecast.mjs';
import {buildSeasonReport} from '../src/season-report.mjs';

const CHUNK=8*1024*1024;
const now=Date.parse('2026-11-14T08:00:00Z');
function event(ageMin=0,seconds=20){
 return {bytes:CHUNK,durationMs:seconds*1000,
  recordedAt:new Date(now-ageMin*60000).toISOString(),
  episodeNumber:1,code:'episode_checkpoint_saved'};
}
const base={now,episodeCount:10,verifiedCount:2,failedCount:0,
 expectedBytes:CHUNK*10,storedBytes:CHUNK*3};
test('ETA uses measured recent successful chunk wall-clock only',()=>{
 const result=forecastSeasonTransfer({...base,
  events:[event(2),event(3),event(4)]});
 assert.equal(result.status,'estimate_available');
 assert.equal(result.observedSamples,3);
 assert.equal(result.observedBytes,CHUNK*3);
 assert.equal(result.observedDurationMs,60000);
 assert.equal(result.estimatedActiveSeconds,140);
 assert.equal(result.estimatedCompletionAt,null);
 assert.equal(result.excludesQueueWait,true);
 assert.equal(result.excludesOfflineTime,true);
 assert.equal(result.customerCutover,false);
});
test('no ETA from less than three fresh measured chunks or only old chunks',()=>{
 const small=forecastSeasonTransfer({...base,events:[event(1),event(3)]});
 assert.equal(small.status,'insufficient_recent_samples');
 assert.equal(small.estimatedActiveSeconds,null);
 const old=forecastSeasonTransfer({...base,
  events:[event(1441),event(1445),event(1450)]});
 assert.equal(old.status,'insufficient_recent_samples');
 assert.equal(old.observedSamples,0);
});
test('no ETA from failures, unverified final bytes, completed or zero-sized season',()=>{
 assert.equal(forecastSeasonTransfer({...base,failedCount:1,
  events:[event(1),event(2),event(3)]}).status,'blocked_by_failed_episodes');
 assert.equal(forecastSeasonTransfer({...base,
  verifiedCount:10,events:[]}).status,'completed');
 assert.equal(forecastSeasonTransfer({...base,
  storedBytes:CHUNK*10,verifiedCount:9}).status,'awaiting_full_verification');
 assert.equal(forecastSeasonTransfer({now,episodeCount:0}).status,'empty_season');
});
test('ignore invalid, zero, future, oversized and untrusted durations',()=>{
 const result=forecastSeasonTransfer({...base,
  events:[
   event(1),event(2),event(3),
   {...event(4),bytes:0},
   {...event(4),bytes:CHUNK+1},
   {...event(4),durationMs:0},
   {...event(4),durationMs:3600001},
   {...event(4),recordedAt:'invalid'},
   {...event(4),recordedAt:new Date(now+120000).toISOString()}
  ]});
 assert.equal(result.status,'estimate_available');
 assert.equal(result.observedSamples,3);
});
test('flags a slowdown only with ten valid recent chunks',()=>{
 const slow=Array.from({length:5},(_,i)=>event(i,40));
 const fast=Array.from({length:5},(_,i)=>event(i+6,10));
 const out=forecastSeasonTransfer({...base,events:[...slow,...fast]});
 assert.equal(out.status,'estimate_available');
 assert.equal(out.recentSlowdown,true);
 assert.equal(forecastSeasonTransfer({...base,events:[...slow,...fast.slice(0,4)]})
  .recentSlowdown,false);
});
test('season report surfaces conservative ETA without disclosing source credentials',()=>{
 const report=buildSeasonReport({
  page:{seasonKey:'series_41_s01',number:1,pages:1},
  totals:{episode_count:'10',verified_count:'2',failed_count:'0',
   expected_bytes:String(CHUNK*10),stored_bytes:String(CHUNK*3)},
  episodes:[],
  events:Array.from({length:3},(_,i)=>({
   episodeNumber:3,bytes:CHUNK,durationMs:20000,
   recordedAt:new Date(Date.now()-(i+1)*60000).toISOString(),
   code:'episode_checkpoint_saved'
  }))
 });
 assert.equal(report.forecast.status,'estimate_available');
 assert.ok(report.forecast.estimatedActiveSeconds>0);
 assert.equal(report.forecast.estimatedCompletionAt,null);
 assert.equal(report.providerMediaRequests,0);
 assert.equal(report.bucketFreeBytes,null);
 assert.equal(JSON.stringify(report).includes('password='),false);
});

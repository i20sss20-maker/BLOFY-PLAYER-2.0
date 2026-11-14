import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeasonReport} from '../src/season-report.mjs';
import {createSeasonQueueStore} from '../src/season-queue.mjs';
import {createContentHubServer} from '../src/server.mjs';

const token='p'.repeat(48);
test('per-season report uses durable bytes, bounded snapshots and measured chunks',()=>{
 const out=buildSeasonReport({
  page:{seasonKey:'series_41_s1',number:1,pages:2,
   hasNext:true,hasPrevious:false},
  totals:{episode_count:'51',verified_count:'22',failed_count:'2',
   queued_count:'26',running_count:'1',paused_count:'0',
   expected_bytes:'510000',stored_bytes:'220000'},
  episodes:[{runId:'season_1234567890abcdef',episodeNumber:1,
   title:'Test 1',state:'verified',verified:true,
   expectedBytes:10000,storedBytes:10000,updatedAt:'2026-11-14T07:00:00Z'}],
  events:[{episodeNumber:1,bytes:8388608,durationMs:20000,
   code:'episode_checkpoint_saved',recordedAt:'2026-11-14T07:01:00Z'}],
  worker:{active:false}
 });
 assert.equal(out.readOnly,true);
 assert.equal(out.providerMediaRequests,0);
 assert.equal(out.bucketFreeBytes,null);
 assert.equal(out.totals.percent,43);
 assert.equal(out.episodes[0].percent,100);
 assert.equal(out.episodes[0].sourceVerified,true);
 assert.equal(out.recentEvents[0].bytesPerSecond,419430);
 assert.equal(out.eventHistoryScope,'newest_60_telemetry_rows_for_selected_season');
 assert.ok(out.alerts.some(x=>x.code==='failed_episodes'));
 assert.ok(out.alerts.some(x=>x.code==='worker_status_unknown'));
 assert.equal(JSON.stringify(out).includes('username='),false);
});
test('empty reports do not fabricate throughput or storage capacity',()=>{
 const out=buildSeasonReport({page:{seasonKey:'series_41_s2',number:1,pages:1},
  totals:{episode_count:1,expected_bytes:8388608,stored_bytes:8388608}});
 assert.equal(out.recentEvents.length,0);
 assert.ok(out.alerts.some(x=>x.code==='history_not_recorded'));
 assert.equal(out.bucketFreeBytes,null);
 assert.equal(out.totals.percent,100);
});
test('detail route refuses anonymous, query, invalid season, and write requests',async()=>{
 const hits=[];
 const store={
  seasonDetailPage:async({seasonKey,page})=>{
   hits.push({seasonKey,page});
   if(seasonKey==='series_missing')return null;
   return {page:{seasonKey,number:page,pages:1,hasNext:false,hasPrevious:false},
    totals:{episode_count:'1',expected_bytes:'8388608',stored_bytes:'0',
     queued_count:'1',verified_count:'0',running_count:'0',failed_count:'0',paused_count:'0'},
    episodes:[{runId:'season_1234567890abcdef',episodeNumber:1,title:'Episode',
     state:'queued',expectedBytes:8388608,storedBytes:0}]};
  },
  seasonTransferEvents:async()=>[]
 };
 const hub=createContentHubServer({token,storage:{},lease:{},seasonQueueStore:store});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(ok=>hub.server.once('listening',ok));
 const base='http://127.0.0.1:'+hub.server.address().port;
 const path='/internal/seasons/report/series_41_s1/page/1';
 const headers={authorization:'Bearer '+token};
 try{
  assert.equal((await fetch(base+path)).status,401);
  assert.equal((await fetch(base+path+'?all=true',{headers})).status,400);
  assert.equal((await fetch(base+path,{method:'POST',headers})).status,404);
  assert.equal((await fetch(base+'/internal/seasons/report/invalid%2Fid/page/1',{
   headers})).status,404);
  assert.equal((await fetch(base+'/internal/seasons/report/series_41_s1/page/20001',{
   headers})).status,400);
  assert.equal(hits.length,0);
  const ok=await fetch(base+path,{headers});
  assert.equal(ok.status,200);
  const report=await ok.json();
  assert.equal(report.seasonKey,'series_41_s1');
  assert.equal(report.episodes[0].state,'queued');
  assert.equal(report.snapshotOnly,true);
  assert.deepEqual(hits,[{seasonKey:'series_41_s1',page:1}]);
  assert.equal((await fetch(base+'/internal/seasons/report/series_missing/page/1',{
   headers})).status,404);
 }finally{await new Promise(ok=>hub.server.close(ok))}
});
test('report reads pass season key through SQL params without interpolation',async()=>{
 const seen=[];
 class MockPool{
  async query(sql,params=[]){
   seen.push({sql,params});
   if(sql.startsWith('CREATE TABLE'))return {rows:[]};
   if(sql.includes('AS episode_count'))return {rows:[{
    episode_count:'1',expected_bytes:'8388608',stored_bytes:'0'}]};
   if(sql.includes('FROM blofy_content_hub_season_transfer_metrics'))
    return {rows:[]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 await assert.rejects(store.seasonDetailPage({seasonKey:'drop table users',page:1}),
  /season_report_selection_invalid/);
 const result=await store.seasonDetailPage({seasonKey:'series_41_s1',page:1});
 await store.seasonTransferEvents({seasonKey:'series_41_s1'});
 assert.equal(result.episodes.length,0);
 assert.ok(seen.filter(x=>x.params.includes('series_41_s1')).length>=3);
 assert.ok(seen.filter(x=>x.params.includes('series_41_s1')).every(x=>
  !x.sql.includes('series_41_s1')));
 await store.close();
});

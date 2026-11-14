import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeasonQueueStore} from '../src/season-queue.mjs';
import {createContentHubServer} from '../src/server.mjs';

const runId='season_abcdefgh1234567890';
test('private series details aggregate entire registered seasons with 50-row cap',async()=>{
 const seen=[];
 class MockPool{
  async query(sql,params=[]){
   seen.push({sql,params});
   if(sql.includes('GROUP BY q.season_key')){
    return {rows:[{season_key:'series_42_s01',
     episode_count:'4',verified_count:'3',failed_count:'1',
     queued_count:'0',running_count:'0',paused_count:'0',
     expected_bytes:'40000',stored_bytes:'31000'}]};
   }
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const d=await store.registeredSeriesSummary({seriesId:'42'});
 assert.equal(d.seriesId,'42');
 assert.equal(d.readOnly,true);
 assert.equal(d.providerMediaRequests,0);
 assert.equal(d.storageRequests,0);
 assert.equal(d.hasMoreSeasons,false);
 assert.equal(d.seasonSummaries.length,1);
 assert.equal(d.seasonSummaries[0].episodeCount,4);
 assert.equal(d.seasonSummaries[0].verifiedCount,3);
 assert.equal(d.seasonSummaries[0].percent,77);
 assert.equal(d.seasonSummaries[0].fullyVerifiedInQueue,false);
 const query=seen.find(x=>x.sql.includes('GROUP BY q.season_key'));
 assert.deepEqual(query.params,['series_42_s',51]);
 assert.ok(query.sql.includes('LIMIT $2'));
 assert.equal(query.sql.includes('42_s'),false,'input should be parameterized');
 assert.equal(d.neverRepresentsUpstreamSeriesCompleteness,true);
 for(const id of ['../../','0','42?','0004','42_x','4'.repeat(20)]){
  await assert.rejects(store.registeredSeriesSummary({seriesId:id}),
   /series_detail_invalid_id/);
 }
 await store.close();
});
test('registered series listing falls back safely on missing episode manifests',async()=>{
 let queries=0;
 class MockPool{
  async query(sql){
   if(sql.includes('GROUP BY q.season_key')){
    queries++;
    if(queries===1)throw Object.assign(new Error('undefined table'),{code:'42P01'});
    return {rows:[{season_key:'series_42_s01',
     episode_count:'1',verified_count:'0',expected_bytes:'800',
     stored_bytes:'0',failed_count:'0'}]};
   }
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const d=await store.registeredSeriesSummary({seriesId:'42'});
 assert.equal(d.seasonSummaries[0].verifiedCount,0);
 assert.equal(d.seasonSummaries[0].fullyVerifiedInQueue,false);
 assert.equal(queries,2);
 await store.close();
});
test('registered series internal endpoint requires token and owner read action',async()=>{
 const token='z'.repeat(48),calls=[];
 const hub=createContentHubServer({token,storage:{},lease:{},
  seasonQueueStore:{registeredSeriesSummary:async({seriesId})=>{
   calls.push(seriesId);
   return {seriesId,seasonSummaries:[],hasMoreSeasons:false,
    readOnly:true,privateOnly:true,automaticStart:false};
  }}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/library/series/42';
 const auth={authorization:'Bearer '+token};
 try{
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:auth})).status,403);
  assert.equal((await fetch(url+'?query=x',{headers:{
   ...auth,'x-blofy-owner-action':'view-private-series'}})).status,403);
  assert.equal((await fetch(url,{method:'POST',headers:{
   ...auth,'x-blofy-owner-action':'view-private-series'}})).status,404);
  assert.equal(calls.length,0);
  const r=await fetch(url,{headers:{
   ...auth,'x-blofy-owner-action':'view-private-series'}});
  assert.equal(r.status,200);
  const result=await r.json();
  assert.equal(result.ok,true);
  assert.equal(result.customerCutover,false);
  assert.deepEqual(calls,['42']);
 }finally{
  await new Promise(done=>hub.server.close(done));
 }
});

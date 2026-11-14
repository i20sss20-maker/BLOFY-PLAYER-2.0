import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSeasonAttention} from '../src/season-attention.mjs';
import {createContentHubServer} from '../src/server.mjs';
import {createSeasonQueueStore} from '../src/season-queue.mjs';

const now=Date.parse('2026-11-14T08:00:00Z');
const token='z'.repeat(48);
const id='season_0123456789abcdef01234567';
const row=(change={})=>({runId:id,seasonKey:'series_123_s01',
 episodeNumber:1,state:'failed',code:'episode_source_busy',
 expectedBytes:16777216,storedBytes:8388608,
 manualRetries:0,updatedAt:new Date(now-31*60000).toISOString(),
 ...change});
test('alerts separate eligible transient errors from dangerous failures',()=>{
 const out=buildSeasonAttention({now,rows:[
  row(),row({runId:'season_2222222222222222',code:'episode_private_sha256_mismatch'}),
  row({runId:'season_3333333333333333',manualRetries:2}),
  row({runId:'season_4444444444444444',state:'verified'})
 ]});
 assert.equal(out.ok,true);
 assert.equal(out.providerMediaRequests,0);
 assert.equal(out.automaticRetry,false);
 assert.equal(out.automaticStart,false);
 assert.equal(out.items.length,3);
 assert.equal(out.items.filter(x=>x.retryEligible).length,1);
 const critical=out.items.find(x=>x.code==='episode_private_sha256_mismatch');
 assert.equal(critical.severity,'critical');
 assert.equal(critical.retryEligible,false);
 assert.equal(out.items[0].severity,'critical');
 assert.equal(out.counts.critical,1);
 assert.equal(out.items.some(x=>x.state==='verified'),false);
});
test('stale running status is a hint only, active local worker suppresses it',()=>{
 const old=row({state:'running',code:null,
  updatedAt:new Date(now-21*60000).toISOString()});
 const active=buildSeasonAttention({now,rows:[old],
  worker:{active:true,currentRunId:id}});
 assert.equal(active.items.length,0);
 const inactive=buildSeasonAttention({now,rows:[old],
  worker:{active:false}});
 assert.equal(inactive.items[0].type,'possible_stale_running_state');
 assert.match(inactive.items[0].advice,/قد يعمل عامل آخر/);
});
test('paused and partial queue status are advisory, not unsafe retries',()=>{
 const out=buildSeasonAttention({now,rows:[
  row({state:'paused',code:'season_queue_paused',
   updatedAt:new Date(now-31*60000)}),
  row({state:'queued',code:null,
   runId:'season_9999999999999999',
   updatedAt:new Date(now-61*60000)})
 ]});
 assert.deepEqual(out.items.map(x=>x.type),
  ['paused_for_review','partial_checkpoint_waiting']);
 assert.equal(out.items.every(x=>x.retryEligible===false),true);
 assert.equal(out.items.every(x=>x.checkpointOnly===true),true);
});
test('invalid IDs, unknown states and recent pauses are ignored',()=>{
 const out=buildSeasonAttention({now,rows:[
  row({runId:'not valid'}),row({seasonKey:'../evil'}),
  row({state:'queued',storedBytes:0}),
  row({state:'paused',updatedAt:new Date(now-1000)})
 ]});
 assert.deepEqual(out.items,[]);
});
test('authenticated alert endpoint refuses URL query params and never reads source',async()=>{
 let called=0;
 const store={attentionRows:async({limit})=>{
  called++;assert.equal(limit,51);return [row()];}};
 const hub=createContentHubServer({token,seasonQueueStore:store,
  storage:{},lease:{}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/seasons/attention';
 try{
  assert.equal((await fetch(url)).status,401);
  const headers={authorization:'Bearer '+token};
  assert.equal((await fetch(url+'?all=1',{headers})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers})).status,404);
  assert.equal(called,0);
  const r=await fetch(url,{headers});assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.readOnly,true);
  assert.equal(data.sourceChecked,false);
  assert.equal(data.items[0].retryEligible,true);
  assert.equal(called,1);
 }finally{await new Promise(done=>hub.server.close(done))}
});
test('database triage reads are SQL parameterized and bounded',async()=>{
 const queries=[];
 class MockPool{
  async query(sql,params=[]){
   queries.push({sql,params});
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 await store.attentionRows({limit:10000});
 const sql=queries.find(x=>x.sql.includes('ORDER BY CASE q.state'));
 assert.deepEqual(sql.params,[51]);
 assert.match(sql.sql,/LIMIT \$1/);
 assert.match(sql.sql,/blofy_content_hub_season_queue/);
 assert.doesNotMatch(sql.sql,/https?:\/\//);
 await store.close();
});

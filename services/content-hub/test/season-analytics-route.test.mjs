import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';
import {createSeasonQueueStore} from '../src/season-queue.mjs';

const token='x'.repeat(48);
test('authenticated season analytics returns only Postgres accounting and measured durations',async()=>{
 const store={
  healthStats:async()=>({episode_count:'3',season_count:'1',
   verified_count:'1',failed_count:'1',queued_count:'1',
   running_count:'0',paused_count:'0',
   stored_bytes:'8388608',verified_bytes:'8388608',
   expected_bytes:'25165824'}),
  analyticsStats:async()=>({sample_count:'1',active_ms:'4000',
   transfer_bytes:'8388608'}),
  seasonAnalyticsSummary:async()=>[{season_key:'series_s01',
   episode_count:'3',verified_count:'1',failed_count:'1',
   queued_count:'1',running_count:'0',paused_count:'0',
   expected_bytes:'25165824',stored_bytes:'8388608'}],
  failureReasons:async()=>[{code:'episode_source_busy',total:'1'}],
  recentTransferEvents:async()=>[{
   runId:'season_1234567890abcdef',seasonKey:'series_s01',
   episodeNumber:1,bytes:8388608,durationMs:4000,
   code:'episode_checkpoint_saved',stage:null,
   recordedAt:'2026-11-14T08:00:00Z'}],
  recentAudits:async()=>[],unresolvedAuditCounts:async()=>({mismatch:0,unavailable:0})
 };
 const hub=createContentHubServer({token,storage:{},lease:{},
  seasonQueueStore:store});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const base='http://127.0.0.1:'+hub.server.address().port;
 try{
  assert.equal((await fetch(base+'/internal/seasons/analytics')).status,401);
  assert.equal((await fetch(base+'/internal/seasons/analytics?status=failed',{
   headers:{authorization:'Bearer '+token}})).status,400);
  const resp=await fetch(base+'/internal/seasons/analytics',{
   headers:{authorization:'Bearer '+token}});
  assert.equal(resp.status,200);
  const data=await resp.json();
  assert.equal(data.readOnly,true);
  assert.equal(data.providerMediaRequests,0);
  assert.equal(data.totals.averageBytesPerSecond,2097152);
  assert.equal(data.totals.seasonCount,1);
  assert.equal(data.seasonSummaries[0].failedCount,1);
  assert.equal(data.failureReasons[0].code,'episode_source_busy');
  assert.equal(data.bucketFreeBytes,null);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
test('metric writes are bounded, parameterized and never include source URLs',async()=>{
 const statements=[];
 class MockPool{
  async query(sql,params=[]){
   statements.push({sql,params});
   return {rows:[],rowCount:1};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const runId='season_0123456789abcdef01234567';
 await assert.rejects(store.recordTransferMetric({
  runId,bytes:8388609,durationMs:100,code:'episode_checkpoint_saved'
 }),/season_transfer_metric_invalid/);
 await store.recordTransferMetric({
  runId,bytes:8388608,durationMs:5000,code:'episode_checkpoint_saved'});
 const inserted=statements.find(s=>s.sql.includes('INSERT INTO blofy_content_hub_season_transfer_metrics'));
 assert.deepEqual(inserted.params,[runId,8388608,5000,
  'episode_checkpoint_saved',null]);
 assert.doesNotMatch(inserted.sql,/season_0123456789/);
 await store.close();
});
test('analytics aggregation does not require a pre-existing telemetry table',async()=>{
 class MockPool{
  async query(sql){
   if(sql.startsWith('CREATE TABLE'))return {rows:[]};
   if(sql.includes('FROM blofy_content_hub_season_transfer_metrics')){
    const e=Error('missing metric table');e.code='42P01';throw e;
   }
   throw Error('unexpected read query');
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 assert.deepEqual(await store.analyticsStats(),{});
 assert.deepEqual(await store.recentTransferEvents(),[]);
 await store.close();
});
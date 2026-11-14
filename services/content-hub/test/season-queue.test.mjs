import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createSeasonQueueController,createSeasonQueueStore,seasonQueueReadiness,
 seasonQueueSummary,validateSeasonSelection
} from '../src/season-queue.mjs';
import {createContentHubServer} from '../src/server.mjs';

const token='q'.repeat(48);
const env={
 BLOFY_CONTENT_HUB_SEASON_QUEUE_ENABLED:'1',
 BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'s'.repeat(48)
};
const candidate=id=>({gatewayId:id,mediaKind:'episode',
 sourceName:'saleh',sourceId:'11111111-1111-4111-8111-111111111111',
 mediaId:'media_'+id,extension:'mkv',title:'Pilot episode '+id});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate,limit=1000){
 for(let i=0;i<limit/5;i++){
  if(predicate())return;
  await sleep(5);
 }
 throw Error('condition_timeout');
}
function fakeQueue(){
 const rows=[];
 return {rows,
  async list(){return rows.map(r=>({...r,
    state:r.state,bytesCopied:r.bytesCopied||0,
    expectedBytes:r.expectedBytes,percent:r.bytesCopied?
      Math.floor(r.bytesCopied/r.expectedBytes*100):0}));},
  async enqueue(episodes){rows.push(...episodes.map(r=>({...r,state:'queued',
   retries:0,bytesCopied:0})));return {added:episodes.length,skipped:0}},
  async recoverInterrupted(){for(const r of rows){
   if(r.state==='running'||r.state==='paused')r.state='queued';
  }},
  async claimNext(){
   const row=rows.find(r=>r.state==='queued');
   if(!row)return null;
   row.state='running';return {...row};
  },
  async update(runId,state,{code=null,retry=false}={}){
   const r=rows.find(x=>x.runId===runId);
   assert.equal(r.state,'running');
   r.state=state;r.code=code;
   if(retry)r.retries++;
   if(state==='verified')r.bytesCopied=r.expectedBytes;
  }
 };
}
test('season queues are deny-by-default and never expose bridge tokens',()=>{
 const blocked=seasonQueueReadiness({});
 assert.equal(blocked.ready,false);
 assert.ok(blocked.blockedBy.includes('season_queue_disabled'));
 assert.ok(blocked.blockedBy.includes('episode_copy_disabled'));
 assert.equal(JSON.stringify(seasonQueueReadiness(env)).includes('s'.repeat(48)),false);
 for(const key of Object.keys(env)){
  const one={...env};delete one[key];
  assert.equal(seasonQueueReadiness(one).ready,false,key);
 }
 assert.equal(seasonQueueReadiness(env).automaticStartup,false);
});
test('selection requires exact catalog mapping, bounded sizes, no duplicate episodes',()=>{
 const candidates=[candidate(123),candidate(456)];
 const input={seasonKey:'licensed_s01',episodes:[
  {gatewayId:123,episodeNumber:1,expectedBytes:8388608},
  {gatewayId:456,episodeNumber:2,expectedBytes:16777216}
 ]};
 const jobs=validateSeasonSelection({...input,candidates});
 assert.equal(jobs.length,2);
 assert.match(jobs[0].runId,/^season_[a-f0-9]{24}$/);
 assert.equal(jobs[1].sourceId,candidate(456).sourceId);
 assert.equal(jobs[1].expectedBytes,16777216);
 assert.throws(()=>validateSeasonSelection({...input,
  episodes:[{gatewayId:777,episodeNumber:3,expectedBytes:8388608}],
  candidates}));
 assert.throws(()=>validateSeasonSelection({...input,
  episodes:[{gatewayId:123,episodeNumber:1,expectedBytes:8388607}],
  candidates}));
 assert.throws(()=>validateSeasonSelection({...input,
  episodes:[input.episodes[0],input.episodes[0]],candidates}));
 assert.throws(()=>validateSeasonSelection({...input,
  episodes:[{...input.episodes[0],expectedBytes:2**35}],candidates}));
 assert.throws(()=>validateSeasonSelection({...input,seasonKey:'../unsafe',
  candidates}));
});
test('aggregate season progress weights episode sizes, not average percentages',()=>{
 const seasons=seasonQueueSummary([
  {seasonKey:'s01',state:'verified',expectedBytes:10,bytesCopied:10},
  {seasonKey:'s01',state:'queued',expectedBytes:90,bytesCopied:40},
  {seasonKey:'s02',state:'failed',expectedBytes:10,bytesCopied:0}
 ]);
 assert.equal(seasons[0].percent,50);
 assert.equal(seasons[0].verifiedCount,1);
 assert.equal(seasons[1].failedCount,1);
});
test('controller transfers sequentially, checkpoints and stops when empty',async()=>{
 const store=fakeQueue();
 await store.enqueue([{...validateSeasonSelection({
  seasonKey:'series_one',episodes:[
   {gatewayId:123,episodeNumber:1,expectedBytes:8388608}],
  candidates:[candidate(123)]})[0]}]);
 let calls=0,concurrent=0,maxConcurrent=0;
 const queue=createSeasonQueueController({store,lease:{},storage:{},env,
  delayMs:0,
  runner:async({env:jobEnv})=>{
   concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
   assert.equal(jobEnv.BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID,'123');
   await sleep(1);
   concurrent--;calls++;
   return calls===1?{ok:true,code:'episode_checkpoint_saved',
    bytesCopied:8388608}:{ok:true,code:'episode_fully_verified',
    completed:true};
  }});
 assert.equal(queue.start().ok,true);
 assert.equal(queue.start().code,'season_queue_running');
 await until(()=>queue.status().state==='completed');
 assert.equal(calls,2);
 assert.equal(maxConcurrent,1);
 assert.equal(store.rows[0].state,'verified');
 assert.equal(store.rows[0].retries,0);
});
test('controller pauses on aborted batch and resumes only on explicit start',async()=>{
 const store=fakeQueue();
 await store.enqueue(validateSeasonSelection({seasonKey:'series_two',
  episodes:[{gatewayId:456,episodeNumber:4,expectedBytes:8388608}],
  candidates:[candidate(456)]}));
 let release,invoked=0;
 let batchHold=new Promise(resolve=>{release=resolve});
 const queue=createSeasonQueueController({store,lease:{},storage:{},env,
  delayMs:0,
  runner:async({signal})=>{
   invoked++;
   if(invoked===1){
    await batchHold;
    assert.equal(signal.aborted,true);
    return {ok:false,code:'episode_cancelled'};
   }
   return {ok:true,completed:true,code:'episode_fully_verified'};
  }});
 queue.start();
 await until(()=>invoked===1);
 assert.equal(queue.stop().ok,true);
 release();
 await until(()=>queue.status().state==='paused'&&!queue.status().active);
 assert.equal(store.rows[0].state,'paused');
 assert.equal(invoked,1);
 assert.equal(queue.start().ok,true);
 await until(()=>queue.status().state==='completed');
 assert.equal(invoked,2);
 assert.equal(store.rows[0].state,'verified');
});
test('owner route rejects unauthenticated enqueue and queues only catalog matches',async()=>{
 const store=fakeQueue();
 let copies=0,browserConfirmed=false;
 const lease={
  getEpisodeBrowserPlaybackStatus:async()=>({confirmed:browserConfirmed}),
  getVerifiedEpisodeObject:async()=>({bytes:8388608}),
  confirmEpisodeBrowserPlayback:async()=>{
   browserConfirmed=true;
   return {confirmed:true,confirmedAt:'2026-11-14T00:00:00Z'};
  }
 };
 const hub=createContentHubServer({token,pilotEnv:{...env,
  BLOFY_CONTENT_HUB_EPISODE_RUN_ID:'saleh_episode_127434_20261114',
  BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED:'1',
  BLOFY_CONTENT_HUB_EPISODE_OWNER_PREVIEW_ENABLED:'1'},storage:{},lease,
  seasonQueueStore:store,episodeCandidateInspector:async()=>({
   ok:true,candidates:[candidate(123),candidate(456)]}),
  episodeChunkRunner:async()=>{copies++;
   return {ok:true,completed:true,code:'episode_fully_verified'};}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const base='http://127.0.0.1:'+hub.server.address().port;
 const payload={seasonKey:'season_test_01',episodes:[
  {gatewayId:123,episodeNumber:1,expectedBytes:8388608}]};
 const h={authorization:'Bearer '+token,'content-type':'application/json',
  'x-blofy-season-confirm':'licensed-private-episodes',
  'x-blofy-storage-rights-confirm':'licensed-persistent-copy'};
 try{
  assert.equal((await fetch(base+'/internal/seasons/queue')).status,401);
  assert.equal((await fetch(base+'/internal/seasons/enqueue',{
   method:'POST',headers:{authorization:'Bearer '+token},
   body:JSON.stringify(payload)})).status,403);
  const rejected=await fetch(base+'/internal/seasons/enqueue',{
   method:'POST',headers:h,body:JSON.stringify({...payload,episodes:[
    {gatewayId:999,episodeNumber:1,expectedBytes:8388608}]})});
  assert.equal(rejected.status,400);
  assert.equal(copies,0);
  const saved=await fetch(base+'/internal/seasons/enqueue',{
   method:'POST',headers:h,body:JSON.stringify(payload)});
  assert.equal(saved.status,201);
  assert.equal((await saved.json()).added,1);
  const listed=await fetch(base+'/internal/seasons/queue',{
   headers:{authorization:'Bearer '+token}});
  assert.equal(listed.status,200);
  const body=await listed.json();
  assert.equal(body.seasons[0].episodeCount,1);
  assert.equal(body.episodes[0].state,'queued');
  assert.equal(copies,0);
  assert.equal((await fetch(base+'/internal/seasons/start',{method:'POST',
   headers:{authorization:'Bearer '+token}})).status,403);
  const startHeaders={authorization:'Bearer '+token,
   'x-blofy-season-confirm':'start-private-sequential'};
  const blocked=await fetch(base+'/internal/seasons/start',{
   method:'POST',headers:startHeaders});
  assert.equal(blocked.status,409);
  assert.equal((await blocked.json()).code,
   'owner_episode_browser_playback_not_confirmed');
  const deniedProof=await fetch(base+'/internal/episodes/playback/confirm',{
   method:'POST',headers:{authorization:'Bearer '+token}});
  assert.equal(deniedProof.status,403);
  const accepted=await fetch(base+'/internal/episodes/playback/confirm',{
   method:'POST',headers:{authorization:'Bearer '+token,
   'x-blofy-browser-confirm':'owner-saw-and-heard',
   'x-blofy-video-confirmed':'yes','x-blofy-audio-confirmed':'yes'}});
  assert.equal(accepted.status,200);
  const proof=await fetch(base+'/internal/episodes/playback/confirmation',{
   headers:{authorization:'Bearer '+token}});
  assert.equal((await proof.json()).confirmed,true);
  const started=await fetch(base+'/internal/seasons/start',{
   method:'POST',headers:startHeaders});
  assert.equal(started.status,202);
  await until(()=>copies===1);
  assert.equal(store.rows[0].state,'verified');
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});


test('Postgres enqueue reuses exact previously verified episode and no duplicate S3 object',async()=>{
 const existing={run_id:'saleh_episode_127434_20261114',
  state:'verified',source_id:candidate(123).sourceId,
  media_id:'media_123',extension:'mkv',expected_bytes:'8388608'};
 const observed=[];
 class MockPool{
  async query(sql){assert.match(sql,/CREATE TABLE IF NOT EXISTS/);
   return {rows:[]}}
  async connect(){return {
   release:()=>{},
   query:async(sql,args=[])=>{
    observed.push({sql,args});
    if(sql.includes('to_regclass'))return {rows:[{table_name:'existing'}]};
    if(sql.includes('SELECT run_id,state'))return {rows:[existing]};
    if(sql.includes('INSERT INTO blofy_content_hub_season_queue'))
     return {rowCount:1,rows:[{run_id:args[0]}]};
    return {rowCount:0,rows:[]};
   }
  }}
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const jobs=validateSeasonSelection({seasonKey:'valid_season',
  episodes:[{gatewayId:123,episodeNumber:1,expectedBytes:8388608}],
  candidates:[candidate(123)]});
 const result=await store.enqueue(jobs);
 assert.equal(result.added,1);
 assert.equal(result.reusedExisting,1);
 const insert=observed.find(c=>c.sql.includes(
  'INSERT INTO blofy_content_hub_season_queue'));
 assert.equal(insert.args[0],existing.run_id);
 assert.equal(insert.args[9],'verified');
 await store.close();
});
test('Postgres enqueue fails closed when existing run source or size differs',async()=>{
 let rollback=false;
 class MockPool{
  async query(){return {rows:[]}}
  async connect(){return {release:()=>{},
   query:async(sql)=>{
    if(sql.includes('to_regclass'))return {rows:[{table_name:'existing'}]};
    if(sql.includes('SELECT run_id,state'))return {rows:[{
     run_id:'old_episode_123',state:'verified',
     source_id:candidate(123).sourceId,media_id:'media_123',
     extension:'mkv',expected_bytes:'9999999'}]};
    if(sql==='ROLLBACK')rollback=true;
    return {rows:[],rowCount:0};
   }
  }}
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const jobs=validateSeasonSelection({seasonKey:'valid_season',
  episodes:[{gatewayId:123,episodeNumber:1,expectedBytes:8388608}],
  candidates:[candidate(123)]});
 await assert.rejects(store.enqueue(jobs),/season_existing_episode_scope_conflict/);
 assert.equal(rollback,true);
 await store.close();
});

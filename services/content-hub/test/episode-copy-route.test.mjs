import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';
const token='v'.repeat(48);
const gates={
 BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID:'127434',
 BLOFY_CONTENT_HUB_EPISODE_EXPECTED_BYTES:'1444843431',
 BLOFY_CONTENT_HUB_EPISODE_RUN_ID:'saleh_episode_127434_pilot',
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(48)
};
async function withHub(pilotEnv,episodeChunkRunner,run){
 const hub=createContentHubServer({token,pilotEnv,storage:{},lease:{
  listEpisodeRuns:async()=>[{runId:'saleh_episode_127434_pilot',
   format:'private_episode_chunks',state:'staged',
   expectedBytes:1444843431,bytesCopied:8388608}]
 },episodeChunkRunner});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const base='http://127.0.0.1:'+hub.server.address().port;
  return await run(base);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
}
const requestHeaders={
 authorization:'Bearer '+token,
 'x-blofy-episode-copy-confirm':'approved-single-8mib',
 'x-blofy-episode-gateway-id':'127434'
};
test('episode POST requires exact token, approved ID and dedicated safety flags',async()=>{
 let copied=0;
 await withHub({...gates,BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'0'},
  async()=>{copied++;return {ok:true,code:'episode_checkpoint_saved'}},
  async base=>{
   const url=base+'/internal/episodes/next';
   assert.equal((await fetch(url,{method:'POST'})).status,401);
   assert.equal((await fetch(url,{method:'POST',headers:{
    authorization:'Bearer '+token}})).status,403);
   assert.equal((await fetch(url,{method:'POST',headers:{
    ...requestHeaders,'x-blofy-episode-gateway-id':'555'}})).status,403);
   const blocked=await fetch(url,{method:'POST',headers:requestHeaders});
   assert.equal(blocked.status,409);
   const response=await blocked.json();
   assert.equal(response.code,'episode_safety_gates_off');
   assert.ok(response.episodeCopyReadiness.blockedBy.includes(
    'episode_storage_rights_unconfirmed'));
   assert.equal(copied,0);
  });
});
test('one owner request enqueues just one 8MiB episode chunk; reports PG progress',async()=>{
 let copied=0;
 await withHub(gates,async()=>{copied++;
  return {ok:true,code:'episode_checkpoint_saved',bytesCopied:8388608};
 },async base=>{
  const accepted=await fetch(base+'/internal/episodes/next',
    {method:'POST',headers:requestHeaders});
  assert.equal(accepted.status,202);
  assert.equal((await accepted.json()).code,'episode_batch_accepted');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(copied,1);
  const state=await fetch(base+'/internal/pilots',{headers:{
   authorization:'Bearer '+token}});
  assert.equal(state.status,200);
  const body=await state.json();
  assert.equal(body.episodeCopyReadiness.ready,true);
  assert.equal(body.episodeRuns[0].bytesCopied,8388608);
  assert.equal(body.lastEpisodeCopy.code,'episode_checkpoint_saved');
  assert.equal(body.customerCutover,false);
 });
});
test('simultaneous requests never spawn two source transfers',async()=>{
 let release;
 const done=new Promise(resolve=>{release=resolve});
 let copied=0;
 await withHub(gates,async()=>{copied++;await done;
  return {ok:true,code:'episode_checkpoint_saved'}},async base=>{
  const url=base+'/internal/episodes/next';
  assert.equal((await fetch(url,{method:'POST',headers:requestHeaders})).status,202);
  const concurrent=await fetch(url,{method:'POST',headers:requestHeaders});
  assert.equal(concurrent.status,409);
  assert.equal(copied,1);
  release();
  await new Promise(resolve=>setTimeout(resolve,20));
 });
});

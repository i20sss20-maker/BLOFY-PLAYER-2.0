import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPrivateReadConcurrency,validateConcurrentReadIds}
 from '../src/concurrent-private-read.mjs';
import {createContentHubServer} from '../src/server.mjs';
const token='t'.repeat(48),a='saleh_episode_127434_20261114',
 b='season_0123456789abcdef01234567',hash='f'.repeat(64);
const manifest=id=>({parts:[{partNumber:1,
 key:'saleh/episode/abc/batch_'+id,bytes:8388608,sha256:hash}]});
test('two distinct verified run IDs required',()=>{
 assert.deepEqual(validateConcurrentReadIds([a,b]),[a,b]);
 for(const ids of [[a,a],[a],[a,b,a],['invalid',b]]){
  assert.throws(()=>validateConcurrentReadIds(ids));
 }
});
test('concurrent read canary reads precisely one chunk per run at the same time',async()=>{
 let active=0,peak=0,calls=0;
 const result=await checkPrivateReadConcurrency({
  runIds:[a,b],lease:{getVerifiedEpisodeObject:async id=>manifest(id)},
  storage:{verify:async p=>{
   calls++;active++;peak=Math.max(active,peak);
   await new Promise(resolve=>setTimeout(resolve,12));
   active--;return {ok:true,bytes:p.expectedBytes,sha256:p.expectedSha256};
  }}
 });
 assert.equal(result.ok,true);
 assert.equal(result.concurrentReads,2);
 assert.equal(result.checkedChunks,2);
 assert.equal(result.requestedBytes,16777216);
 assert.equal(peak,2);
 assert.equal(calls,2);
 assert.equal(result.providerMediaRequests,0);
 assert.equal(result.playbackVerified,false);
 assert.equal(result.subscriberCapacityVerified,false);
});
test('canary refuses incomplete manifest before reading any storage',async()=>{
 let calls=0;
 const result=await checkPrivateReadConcurrency({runIds:[a,b],
  lease:{getVerifiedEpisodeObject:async id=>id===a?manifest(id):null},
  storage:{verify:async()=>{calls++;return {ok:true}}}});
 assert.equal(result.code,'private_read_canary_not_verified');
 assert.equal(calls,0);
});
test('operator endpoint requires bearer, confirmation, two known verified runs and cooldown',async()=>{
 let checked=0;
 const hub=createContentHubServer({
  token,storage:{verify:async p=>({ok:true,bytes:p.expectedBytes,sha256:p.expectedSha256})},
  lease:{getVerifiedEpisodeObject:async id=>manifest(id)},
  seasonQueueStore:{ownsVerifiedRun:async id=>{
   checked++;return id===b;
  }},pilotEnv:{BLOFY_CONTENT_HUB_EPISODE_RUN_ID:a}
 });
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/seasons/concurrent-read',auth={authorization:'Bearer '+token,
  'content-type':'application/json',
  'x-blofy-season-confirm':'two-verified-private-s3-reads'},
  body=JSON.stringify({runIds:[a,b],confirmed:true});
 try{
  assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
   body})).status,401);
  assert.equal((await fetch(url,{method:'POST',
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},body})).status,403);
  const invalid=await fetch(url,{method:'POST',headers:auth,
   body:JSON.stringify({runIds:[a,a],confirmed:true})});
  assert.equal(invalid.status,400);
  const res=await fetch(url,{method:'POST',headers:auth,body});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.checkedChunks,2);
  assert.equal(data.customerCutover,false);
  assert.equal(checked,2);
  const cooldown=await fetch(url,{method:'POST',headers:auth,body});
  assert.equal(cooldown.status,429);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

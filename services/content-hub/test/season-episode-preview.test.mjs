import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentHubServer} from '../src/server.mjs';

const token='k'.repeat(48);
const runId='season_0123456789abcdef01234567';
const runPath='/internal/seasons/episodes/'+runId+'/preview';
test('only verified, queued episode run can stream operator MP4 sample',async()=>{
 let buildCalls=0,checked=0,licensed=true;
 const hub=createContentHubServer({token,storage:{},lease:{},
  seasonQueueStore:{ownsVerifiedRun:async id=>{
   checked++;assert.equal(id,runId);return licensed;
  }},
  previewBuilder:async args=>{
   buildCalls++;
   assert.equal(args.runId,runId);
   assert.equal(args.mediaKind,'episode');
   return {ok:true,bytes:Buffer.alloc(4096)};
  },
  pilotEnv:{BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED:'1',
   BLOFY_CONTENT_HUB_EPISODE_OWNER_PREVIEW_ENABLED:'1'}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const url='http://127.0.0.1:'+hub.server.address().port+runPath;
 try{
  let res=await fetch(url,{headers:{
   'x-blofy-owner-preview':'operator-episode-only'}});
  assert.equal(res.status,401);
  res=await fetch(url,{headers:{authorization:'Bearer '+token}});
  assert.equal(res.status,403);
  assert.equal(buildCalls,0);
  const headers={authorization:'Bearer '+token,
   'x-blofy-owner-preview':'operator-episode-only'};
  res=await fetch(url+'?token=bad',{headers});
  assert.equal(res.status,403);
  licensed=false;
  res=await fetch(url,{headers});
  assert.equal(res.status,409);
  assert.equal(buildCalls,0);
  licensed=true;
  res=await fetch(url,{headers});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('content-type'),'video/mp4');
  assert.equal((await res.arrayBuffer()).byteLength,4096);
  assert.equal(buildCalls,1);
  assert.equal(checked,2);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

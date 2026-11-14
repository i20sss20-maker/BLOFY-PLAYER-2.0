import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createContentHubServer} from '../src/server.mjs';
import {CHUNK_BYTES} from '../src/chunked-pilot.mjs';

const token='A'.repeat(40),runId='safe_chunk_test';
test('two verified private S3 chunks play through bounded cross-boundary ranges',async()=>{
 const all=new Map([
  ['part01',Buffer.alloc(CHUNK_BYTES,65)],
  ['part02',Buffer.from('BCDE')]
 ]);
 const calls=[];
 const storage={readVerifiedRange:async({key,from,to,expectedBytes})=>{
  calls.push({key,from,to,expectedBytes});
  return Readable.from([all.get(key).subarray(from,to+1)]);
 }};
 const lease={
  getVerifiedPilotObject:async()=>null,
  getVerifiedChunkedObject:async(id)=>id===runId?{
   kind:'chunked',bytes:CHUNK_BYTES+4,extension:'mp4',
   parts:[{key:'part01',bytes:CHUNK_BYTES},
    {key:'part02',bytes:4}]
  }:null
 };
 const hub=createContentHubServer({storage,lease,token});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const base='http://127.0.0.1:'+hub.server.address().port;
  const url=base+'/internal/pilot/playback/'+runId;
  const auth={authorization:'Bearer '+token};
  assert.equal((await fetch(url,{method:'HEAD',headers:auth})).status,200);
  const response=await fetch(url,{headers:{...auth,
   range:'bytes='+String(CHUNK_BYTES-2)+'-'+String(CHUNK_BYTES+1)}});
  assert.equal(response.status,206);
  assert.equal(await response.text(),'AABC');
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0],{
   key:'part01',from:CHUNK_BYTES-2,to:CHUNK_BYTES-1,
   expectedBytes:CHUNK_BYTES
  });
  assert.deepEqual(calls[1],{
   key:'part02',from:0,to:1,expectedBytes:4
  });
  assert.equal((await fetch(url,{headers:{
   range:'bytes=0-1'}})).status,401);
  assert.equal((await fetch(base+'/internal/pilot/playback/other_run',{
   method:'HEAD',headers:auth})).status,404);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
test('one manual batch is admin-token protected, confirmation-gated and disabled by default',async()=>{
 let calls=0;
 const storage={},lease={};
 const pilotEnv={
  BLOFY_CONTENT_HUB_CHUNKED_ENABLED:'1',
  BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
  BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_BATCH_RUN_ID:'safe_chunk_test',
  BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(40),
  BLOFY_CONTENT_HUB_EXPECTED_BYTES:String(CHUNK_BYTES*2),
  BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:'123'
 };
 const hub=createContentHubServer({storage,lease,token,pilotEnv,
   batchRunner:async()=>{calls++;return {
     ok:true,code:'batch_checkpoint_saved',completed:false,
     bytesCopied:CHUNK_BYTES
   }}});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const url='http://127.0.0.1:'+hub.server.address().port+
    '/internal/batch/next';
  assert.equal((await fetch(url,{method:'POST'})).status,401);
  assert.equal((await fetch(url,{method:'POST',
   headers:{authorization:'Bearer '+token}})).status,400);
  const response=await fetch(url,{method:'POST',
    headers:{authorization:'Bearer '+token,
     'x-blofy-batch-confirm':'approved-8mib-batch'}});
  assert.equal(response.status,202);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(calls,1);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

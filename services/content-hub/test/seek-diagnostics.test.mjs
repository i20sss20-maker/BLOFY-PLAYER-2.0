import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createContentHubServer} from '../src/server.mjs';
import {verifyPrivateSeekRanges} from '../src/seek-diagnostics.mjs';

const SIZE=8*1024*1024+8192,token='K'.repeat(40),runId='private_movie_01';
test('private HTTP first/mid/end/cross-chunk 206 seeks and bearer denial',async()=>{
 const first=Buffer.alloc(8*1024*1024,88),
       last=Buffer.alloc(8192,89);
 const objects=new Map([['one',first],['two',last]]);
 const storage={readVerifiedRange:async({key,from,to,expectedBytes})=>{
   const buf=objects.get(key);assert.equal(buf.length,expectedBytes);
   return Readable.from([buf.subarray(from,to+1)]);
 }};
 const lease={
  getVerifiedPilotObject:async()=>null,
  getVerifiedChunkedObject:async id=>id===runId?{
    kind:'chunked',bytes:SIZE,extension:'mkv',
    parts:[{key:'one',bytes:first.length},{key:'two',bytes:last.length}]
  }:null
 };
 const hub=createContentHubServer({storage,lease,token});
 hub.server.listen(0,'127.0.0.1');
 try{
  await new Promise(resolve=>hub.server.once('listening',resolve));
  const result=await verifyPrivateSeekRanges({runId,bytes:SIZE,
   token,port:hub.server.address().port});
  assert.equal(result.ok,true,result.code);
  assert.equal(result.seeksVerified,4);
  assert.equal(result.unauthorizedDenied,true);
  assert.equal(result.providerRequests,0);
  assert.equal(result.customerCutover,false);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});
test('invalid run, unavailable session, unauthenticated requests never report a playable movie',async()=>{
 assert.equal((await verifyPrivateSeekRanges({
  runId:'bad!',bytes:SIZE,token,port:9000})).ok,false);
 assert.equal((await verifyPrivateSeekRanges({
  runId,bytes:SIZE,token:'',port:9000})).ok,false);
});

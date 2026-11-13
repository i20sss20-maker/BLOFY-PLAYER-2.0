import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {runChunkedMovieBatch,CHUNK_BYTES} from '../src/chunked-pilot.mjs';

const env={
 BLOFY_CONTENT_HUB_CHUNKED_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_BATCH_RUN_ID:'test_batch_001',
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'x'.repeat(40),
 BLOFY_CONTENT_HUB_EXPECTED_BYTES:String(CHUNK_BYTES*2),
 BLOFY_CONTENT_HUB_APPROVED_GATEWAY_ID:'123',
 BLOFY_CONTENT_HUB_CHUNKS_PER_BATCH:'1'
};
function fixture({changeValidator=false,failSecond=false,
 noValidator=false,alterBoundary=false}={}){
 const objects=new Map();
 const db={state:'staged',parts:[],validator:null,sha:null};
 const stats={metadata:0,reads:0,probes:0,aborts:0,locks:0};
 const storage={
  begin:async()=>({uploadId:'safe_upload'}),
  part:async({key,body})=>{
   objects.set(key,Buffer.from(body));return {etag:'"part"'};
  },
  complete:async()=>({ok:true}),
  verify:async({key,expectedBytes,expectedSha256})=>{
   const content=objects.get(key);
   const sha256=content?createHash('sha256').update(content).digest('hex'):'';
   return {ok:content?.length===expectedBytes&&sha256===expectedSha256,
    bytes:content?.length,sha256};
  },
  readVerifiedRange:async({key,from,to,expectedBytes})=>{
   const content=objects.get(key);
   assert.equal(content.length,expectedBytes);
   return Readable.from([content.subarray(from,to+1)]);
  },
  abort:async()=>{stats.aborts++},
  remove:async({key})=>{objects.delete(key)}
 };
 const lease={
  acquire:async()=>{stats.locks++;return {release:async()=>{}}},
  loadChunkedRun:async()=>({
   state:db.state,validator:db.validator,parts:db.parts.map(p=>({...p}))
  }),
  recordChunk:async(id,part)=>{
   assert.equal(id,env.BLOFY_CONTENT_HUB_BATCH_RUN_ID);
   assert.equal(part.partNumber,db.parts.length+1);
   assert.ok(!db.validator||part.validator===db.validator);
   db.validator=part.validator;
   db.parts.push({...part});
   return {key:part.key};
  },
  verifyChunkedRun:async(_,proof)=>{
   db.sha=proof.sha256;db.state='verified';
  },
  failChunkedRun:async()=>{db.state='failed'}
 };
 const fetchImpl=async(url,init)=>{
  if(url.endsWith('/describe')){
   stats.metadata++;
   return Response.json({ok:true,sourceName:'saleh',mediaKind:'movie',
    sourceId:'9adc6472-5d4e-4359-83e4-0298cc038ae3',
    mediaId:'314',gatewayId:123,extension:'mp4'});
  }
  assert.ok(url.endsWith('/source/movie/123'));
  const [start,end]=init.headers.range.slice('bytes='.length)
    .split('-').map(Number);
  const size=end-start+1;
  assert.ok(size<=CHUNK_BYTES);
  if(size===4096)stats.probes++;
  else stats.reads++;
  if(failSecond&&stats.reads===2&&size>4096)
    throw Error('simulated source disconnect');
  const headers={
    'content-range':'bytes '+start+'-'+end+'/'+(CHUNK_BYTES*2),
    'content-length':String(size)
  };
  if(!noValidator)headers.etag=changeValidator&&stats.reads>=2?
    '"changed"':'"same"';
  return new Response(Buffer.alloc(size,alterBoundary&&stats.reads>=1&&
    size===4096?21:start?99:49),{
   status:206,headers
  });
 };
 return {storage,lease,fetchImpl,db,objects,stats};
}
test('disabled by default: zero provider and storage operations',async()=>{
 const f=fixture();
 const result=await runChunkedMovieBatch({...f,env:{}});
 assert.equal(result.ok,false);
 assert.equal(result.code,'batch_safety_gates_off');
 assert.equal(f.stats.reads,0);
 assert.equal(f.stats.metadata,0);
 assert.equal(f.stats.locks,0);
});
test('two operator batches resume from private 8MiB verified checkpoint',async()=>{
 const f=fixture();
 const first=await runChunkedMovieBatch({...f,env});
 assert.equal(first.ok,true,JSON.stringify(first));
 assert.equal(first.code,'batch_checkpoint_saved');
 assert.equal(first.completed,false);
 assert.equal(first.bytesCopied,CHUNK_BYTES);
 assert.equal(f.db.parts.length,1);
 assert.equal(f.stats.reads,1);
 const second=await runChunkedMovieBatch({...f,env});
 assert.equal(second.code,'batch_movie_fully_verified',JSON.stringify(second));
 assert.equal(second.completed,true);
 assert.equal(second.bytes,CHUNK_BYTES*2);
 assert.equal(second.customerCutover,false);
 assert.equal(f.stats.reads,2);
 assert.equal(f.db.parts.length,2);
 assert.equal(f.db.state,'verified');
 const repeat=await runChunkedMovieBatch({...f,env});
 assert.equal(repeat.code,'batch_already_verified');
 assert.equal(f.stats.reads,2);
 assert.equal(f.objects.size,2);
});
test('source ETag changes across batches: fail closed and keep first checkpoint',async()=>{
 const f=fixture({changeValidator:true});
 assert.equal((await runChunkedMovieBatch({...f,env})).ok,true);
 const failed=await runChunkedMovieBatch({...f,env});
 assert.equal(failed.ok,false);
 assert.equal(failed.code,'batch_source_version_changed');
 assert.equal(f.db.state,'failed');
 assert.equal(f.db.parts.length,1);
 assert.equal(f.stats.reads,2);
});
test('transient range failure keeps verified chunks and retries later',async()=>{
 const f=fixture({failSecond:true});
 assert.equal((await runChunkedMovieBatch({...f,env})).ok,true);
 const failure=await runChunkedMovieBatch({...f,env});
 assert.equal(failure.code,'batch_retryable_error');
 assert.equal(f.db.parts.length,1);
 assert.equal(f.db.state,'staged');
 const done=await runChunkedMovieBatch({...f,env});
 assert.equal(done.code,'batch_movie_fully_verified');
 assert.equal(f.stats.reads,3);
});

test('origin without provider ETag resumes via double boundary SHA256 sampling',async()=>{
 const f=fixture({noValidator:true});
 const first=await runChunkedMovieBatch({...f,env});
 assert.equal(first.ok,true,JSON.stringify(first));
 assert.equal(first.code,'batch_checkpoint_saved');
 assert.match(f.db.validator,/^boundary-sha256:[a-f0-9]{64}$/);
 const second=await runChunkedMovieBatch({...f,env});
 assert.equal(second.code,'batch_movie_fully_verified',JSON.stringify(second));
 assert.equal(f.stats.reads,2);
 assert.equal(f.stats.probes,8);
 assert.equal(f.db.state,'verified');
});
test('source boundary changes before next chunk are rejected without mixed film',async()=>{
 const f=fixture({noValidator:true});
 assert.equal((await runChunkedMovieBatch({...f,env})).ok,true);
 // Version drift occurs between batches: mutate source boundary samples.
 const old=f.fetchImpl;
 f.fetchImpl=async(url,opts)=>{
  const response=await old(url,opts);
  if(opts?.headers?.range?.startsWith('bytes=0-4095')&&
     response.status===206)return new Response(Buffer.alloc(4096,77),{
     status:206,headers:response.headers});
  return response;
 };
 const failed=await runChunkedMovieBatch({...f,env});
 assert.equal(failed.ok,false);
 assert.equal(failed.code,'batch_source_fingerprint_changed');
 assert.equal(f.db.parts.length,1);
 assert.equal(f.db.state,'failed');
});

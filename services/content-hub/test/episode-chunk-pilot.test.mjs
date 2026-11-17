import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {episodeCopyReadiness,runOneEpisodeChunk}
 from '../src/episode-chunk-pilot.mjs';
const CHUNK=8*1024*1024;
const UUID='9adc6472-5d4e-4359-83e4-0298cc038ae3';
const candidate={gatewayId:127434,mediaKind:'episode',sourceName:'saleh',
  sourceId:UUID,mediaId:'1349410',extension:'mkv',title:'Example Episode'};
const config=()=>({
 BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_EPISODE_APPROVED_GATEWAY_ID:'127434',
 BLOFY_CONTENT_HUB_EPISODE_EXPECTED_BYTES:String(CHUNK+1024),
 BLOFY_CONTENT_HUB_EPISODE_RUN_ID:'saleh_episode_127434_verified',
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:'a'.repeat(44)
});
function mocks({tamperSource=false}={}){
 const film=Buffer.alloc(CHUNK+1024,88);
 const objects=new Map(),writes=[];
 const run={state:'staged',parts:[],validator:null};
 let lockHeld=false,reads=0,wasVerified=false;
 const fetchImpl=async(url,opts)=>{
  assert.match(String(url),/\/internal\/blofy-content-hub\/source\/episode\/127434$/);
  assert.equal(opts.headers['x-blofy-episode-transfer'],'operator-authorized');
  assert.equal(opts.headers.authorization,'Bearer '+'a'.repeat(44));
  const found=/^bytes=(\d+)-(\d+)$/.exec(opts.headers.range);
  assert.ok(found);
  const from=Number(found[1]),to=Number(found[2]);
  reads++;
  let data=film.subarray(from,to+1);
  if(tamperSource&&reads===5)data=Buffer.alloc(data.length,33);
  return new Response(data,{status:206,headers:{
   'content-length':String(data.length),
   'content-range':`bytes ${from}-${to}/${film.length}`
  }});
 };
 const storage={
  begin:async({key,private:priv})=>{
   assert.equal(priv,true);
   assert.match(key,/^saleh\/episode\/[a-f0-9-]{36}\/batch_[a-f0-9]{24}_part_\d{6}\.mkv$/);
   return {uploadId:'up-'+(writes.length+1)};
  },
  part:async({key,body})=>{
   objects.set(key,Buffer.from(body));return {etag:'etag-1'};
  },
  complete:async({key})=>{writes.push(key)},
  abort:async()=>{},remove:async({key})=>objects.delete(key),
  verify:async({key,expectedBytes,expectedSha256})=>{
   const data=objects.get(key),sha256=createHash('sha256').update(data).digest('hex');
   return {ok:data.length===expectedBytes&&sha256===expectedSha256,
    bytes:data.length,sha256};
  },
  readVerifiedRange:async({key,from,to,expectedBytes})=>{
   const buf=objects.get(key);assert.equal(buf.length,expectedBytes);
   return Readable.from([buf.subarray(from,to+1)]);
  }
 };
 const lease={
  acquire:async name=>{
   assert.equal(name,'saleh');
   if(lockHeld)return null;
   lockHeld=true;return {release:async()=>{lockHeld=false}};
  },
  loadEpisodeRun:async()=>({...run,parts:run.parts.map(x=>({...x}))}),
  recordEpisodeChunk:async(id,part)=>{
   assert.equal(id,'saleh_episode_127434_verified');
   assert.equal(part.partNumber,run.parts.length+1);
   if(run.validator)assert.equal(run.validator,part.validator);
   run.validator=part.validator;run.parts.push({
    partNumber:part.partNumber,key:part.key,
    bytes:part.bytes,sha256:part.sha256
   });return {key:part.key};
  },
  verifyEpisodeRun:async(_, {sha256})=>{
   assert.equal(sha256,createHash('sha256').update(film).digest('hex'));
   run.state='verified';wasVerified=true;
  },
  failEpisodeRun:async()=>{run.state='failed'}
 };
 return {storage,lease,fetchImpl,objects,film,run,
  getReads:()=>reads,getWrites:()=>writes.length,
  verified:()=>wasVerified};
}
test('episode copying is disabled by default and needs explicit rights',()=>{
 const readiness=episodeCopyReadiness({});
 assert.equal(readiness.ready,false);
 assert.ok(readiness.blockedBy.includes('episode_copy_disabled'));
 assert.ok(readiness.blockedBy.includes('episode_storage_rights_unconfirmed'));
 assert.ok(readiness.blockedBy.includes('source_idle_unconfirmed'));
});
test('one source-id-scoped chunk per request; resume from S3, then full SHA verification',async()=>{
 const m=mocks();
 const opts={...m,env:config(),candidateInspector:async()=>({
   ok:true,candidates:[candidate]})};
 const first=await runOneEpisodeChunk(opts);
 assert.equal(first.ok,true,first.code);
 assert.equal(first.code,'episode_checkpoint_saved');
 assert.equal(first.completed,false);
 assert.equal(first.bytesCopied,CHUNK);
 assert.equal(first.chunksSaved,1);
 assert.equal(m.getWrites(),1);
 assert.equal(m.run.parts.length,1);
 const second=await runOneEpisodeChunk(opts);
 assert.equal(second.ok,true,second.code);
 assert.equal(second.code,'episode_fully_verified');
 assert.equal(second.bytes,CHUNK+1024);
 assert.equal(m.run.parts.length,2);
 assert.equal(m.getWrites(),2);
 assert.equal(m.verified(),true);
 assert.equal(m.getReads(),10); // 2 boundary pairs + 1 source per batch
 const replay=await runOneEpisodeChunk(opts);
 assert.equal(replay.ok,true);
 assert.equal(replay.code,'episode_already_verified');
 assert.equal(m.getWrites(),2);
});
test('wrong gateway never opens provider Range or writes S3',async()=>{
 const m=mocks();
 const result=await runOneEpisodeChunk({
  ...m,env:config(),candidateInspector:async()=>({
   ok:true,candidates:[{...candidate,gatewayId:12}]})
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'episode_mapping_not_approved');
 assert.equal(m.getReads(),0);
 assert.equal(m.getWrites(),0);
});
test('changing source boundaries rejects transfer before S3 write',async()=>{
 const m=mocks({tamperSource:true});
 const result=await runOneEpisodeChunk({...m,env:config(),
  candidateInspector:async()=>({ok:true,candidates:[candidate]})});
 assert.equal(result.ok,false);
 assert.equal(result.code,'episode_source_fingerprint_changed');
 assert.equal(m.run.state,'failed');
 assert.equal(m.getWrites(),0);
});

test('rejects misleading text/JSON/compressed provider 206 before any S3 object exists',async()=>{
 const badHeaders=[
  {'content-type':'text/html'},
  {'content-type':'text/plain; charset=utf-8'},
  {'content-type':'application/json'},
  {'content-type':'application/problem+json'},
  {'content-type':'application/vnd.apple.mpegurl'},
  {'content-encoding':'gzip'},
  {'content-encoding':'br'}
 ];
 for(const extra of badHeaders){
  const m=mocks();
  let providerCalls=0;
  const response=async(url,req)=>{
   providerCalls++;
   const [,lo,hi]=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
   const from=Number(lo),to=Number(hi);
   return new Response(Buffer.alloc(to-from+1,0x41),{
    status:206,headers:{
     'content-range':'bytes '+from+'-'+to+'/'+m.film.length,
     'content-length':String(to-from+1),...extra}
   });
  };
  const r=await runOneEpisodeChunk({...m,env:config(),
   candidateInspector:async()=>({ok:true,candidates:[candidate]}),
   fetchImpl:response});
  assert.equal(r.ok,false,JSON.stringify(extra));
  assert.equal(r.code,'episode_retryable_error');
  assert.equal(r.errorStage,'boundary_precheck');
  assert.equal(m.getWrites(),0);
  assert.equal(m.run.parts.length,0);
  assert.equal(providerCalls,1);
 }
});
test('rejects chunked 206 that sends extra bytes beyond requested range',async()=>{
 const m=mocks();
 let count=0;
 const fetchImpl=async(url,req)=>{
  count++;
  const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
  const from=Number(a),to=Number(b),requested=to-from+1;
  const body=new ReadableStream({start(controller){
   controller.enqueue(new Uint8Array(requested).fill(0x5a));
   controller.enqueue(Uint8Array.of(0xab));
   controller.close();
  }});
  return new Response(body,{
   status:206,headers:{
    'content-range':`bytes ${from}-${to}/${m.film.length}`,
    'content-type':'application/octet-stream'}
  });
 };
 const r=await runOneEpisodeChunk({...m,env:config(),
  candidateInspector:async()=>({ok:true,candidates:[candidate]}),
  fetchImpl});
 assert.equal(r.ok,false);
 assert.equal(r.errorStage,'boundary_precheck');
 assert.equal(count,1);
 assert.equal(m.getWrites(),0);
 assert.equal(m.run.parts.length,0);
});
test('rejects chunked 206 with early EOF instead of persisting incomplete private chunks',async()=>{
 const m=mocks();
 const fetchImpl=async(url,req)=>{
  const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
  const from=Number(a),to=Number(b),requested=to-from+1;
  const body=new ReadableStream({start(controller){
   controller.enqueue(new Uint8Array(requested-1).fill(0x5a));
   controller.close();
  }});
  return new Response(body,{status:206,headers:{
   'content-range':`bytes ${from}-${to}/${m.film.length}`,
   'content-type':'video/x-matroska'}});
 };
 const r=await runOneEpisodeChunk({...m,env:config(),
  candidateInspector:async()=>({ok:true,candidates:[candidate]}),
  fetchImpl});
 assert.equal(r.ok,false);
 assert.equal(r.errorStage,'boundary_precheck');
 assert.equal(m.getWrites(),0);
});
test('valid lengthless chunked 206 ranges remain usable for one exact verified episode',async()=>{
 const m=mocks(),requests=[];
 const fetchImpl=async(url,opts)=>{
  const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(opts.headers.range);
  const from=Number(a),to=Number(b);
  requests.push([from,to]);
  const body=new ReadableStream({start(controller){
   const bytes=m.film.subarray(from,to+1);
   controller.enqueue(bytes.subarray(0,Math.min(128,bytes.length)));
   if(bytes.length>128)controller.enqueue(bytes.subarray(128));
   controller.close();
  }});
  return new Response(body,{status:206,headers:{
   'content-range':`bytes ${from}-${to}/${m.film.length}`,
   'content-type':'application/octet-stream'}
  });
 };
 const opts={...m,env:config(),fetchImpl,
  candidateInspector:async()=>({ok:true,candidates:[candidate]})};
 const first=await runOneEpisodeChunk(opts);
 assert.equal(first.ok,true,first.code);
 assert.equal(first.code,'episode_checkpoint_saved');
 const next=await runOneEpisodeChunk(opts);
 assert.equal(next.ok,true,next.code);
 assert.equal(next.code,'episode_fully_verified');
 assert.equal(m.getWrites(),2);
 assert.equal(m.verified(),true);
 assert.equal(requests.length,10);
});

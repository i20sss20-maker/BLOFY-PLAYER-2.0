// End-to-end offline QA: exercise actual 8MiB movie + episode workers
// with a synthetic, license-cleared origin and in-memory private S3.
// This is NOT real provider/media/device validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {runChunkedMovieBatch} from '../src/chunked-pilot.mjs';
import {runOneEpisodeChunk} from '../src/episode-chunk-pilot.mjs';
import {runOneApprovedMirrorMovieChunk} from '../src/xtream-mirror-movie-transfer.mjs';
import {runOneApprovedMirrorEpisodeChunk} from '../src/xtream-mirror-episode-transfer.mjs';

const ID='123e4567-e89b-42d3-a456-426614174000';
const RUN_ID='mirror_'+'f'.repeat(40);
const FILE_BYTES=8*1024*1024; // one complete, nonvideo synthetic chunk
const SAMPLE=Buffer.alloc(FILE_BYTES,0x41);
const SHA=createHash('sha256').update(SAMPLE).digest('hex');
const NOW=new Date('2026-11-15T01:15:00.000Z');
const KEY='T'.repeat(40);
const base={
 BLOFY_CONTENT_HUB_BRIDGE_TOKEN:KEY,
 BLOFY_CONTENT_HUB_MIRROR_INDIVIDUAL_RIGHTS_AUDITED:'1',
 BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
 BLOFY_XTREAM_DAILY_CATALOG_SOURCE_ID:ID
};

function fakePrivateStorage(){
 const saved=new Map();const pending=new Map();
 const ops=[];
 return {
  saved,ops,
  health:async()=>({ok:true}),
  async begin({key,private:priv}){
   assert.equal(priv,true);assert.ok(key.startsWith('saleh/'));
   const uploadId='upload_'+(pending.size+1);
   pending.set(uploadId,{key,part:null});ops.push('begin');
   return {uploadId};
  },
  async part({key,uploadId,partNumber,body}){
   assert.equal(partNumber,1);
   const entry=pending.get(uploadId);
   assert.equal(entry?.key,key);
   assert.equal(body.byteLength,FILE_BYTES);
   entry.part=Buffer.from(body);
   ops.push('part');
   return {etag:'mock-private-s3-etag'};
  },
  async complete({key,uploadId,parts}){
   const entry=pending.get(uploadId);
   assert.equal(entry?.key,key);
   assert.ok(entry?.part);
   assert.equal(parts.length,1);
   saved.set(key,entry.part);
   pending.delete(uploadId);
   ops.push('complete');
   return {ok:true};
  },
  async verify({key,expectedBytes,expectedSha256}){
   const b=saved.get(key);
   ops.push('verify');
   return b?{ok:b.length===expectedBytes&&SHA===expectedSha256,
    bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')}:
    {ok:false};
  },
  async readVerifiedRange({key,from,to,expectedBytes}){
   const b=saved.get(key);
   assert.ok(b,'private S3 part must exist');
   assert.equal(expectedBytes,b.length);
   assert.equal(from,0);assert.equal(to,b.length-1);
   ops.push('readVerifiedRange');
   return Readable.from([b.subarray(from,to+1)]);
  },
  async abort({uploadId}){pending.delete(uploadId)},
  async remove({key}){saved.delete(key)}
 };
}
function fakeLease(kind){
 let run=null,lockCount=0;
 return {
  get state(){return run},
  get lockCount(){return lockCount},
  async acquire(source){
   assert.equal(source,'saleh');
   lockCount++;
   return {release:async()=>{lockCount--}};
  },
  async loadChunkedRun(args){
   assert.equal(kind,'movie');
   if(!run)run={...args,state:'staged',parts:[],validator:null};
   return {...run,parts:run.parts.slice()};
  },
  async loadEpisodeRun(args){
   assert.equal(kind,'episode');
   if(!run)run={...args,state:'staged',parts:[],validator:null};
   return {...run,parts:run.parts.slice()};
  },
  async recordChunk(id,part){
   assert.equal(id,RUN_ID);
   assert.equal(part.bytes,FILE_BYTES);
   assert.match(part.key,/\/batch_[a-f0-9]{24}_part_000001\./);
   run.parts.push(part);run.validator=part.validator;
   return {key:part.key};
  },
  async recordEpisodeChunk(id,part){
   assert.equal(id,RUN_ID);
   assert.equal(part.bytes,FILE_BYTES);
   assert.match(part.key,/\/batch_[a-f0-9]{24}_part_000001\./);
   run.parts.push(part);run.validator=part.validator;
  },
  async verifyChunkedRun(id,{sha256}){
   assert.equal(id,RUN_ID);assert.equal(sha256,SHA);
   run.state='verified';run.sha256=sha256;
  },
  async verifyEpisodeRun(id,{sha256}){
   assert.equal(id,RUN_ID);assert.equal(sha256,SHA);
   run.state='verified';run.sha256=sha256;
  },
  async failChunkedRun(){run.state='failed'},
  async failEpisodeRun(){run.state='failed'},
  async getVerifiedChunkedObject(id){
   assert.equal(kind,'movie');assert.equal(id,RUN_ID);
   if(run?.state!=='verified')return null;
   return {bytes:FILE_BYTES,sha256:SHA,parts:run.parts,
    extension:run.extension};
  },
  async getVerifiedEpisodeObject(id){
   assert.equal(kind,'episode');assert.equal(id,RUN_ID);
   if(run?.state!=='verified')return null;
   return {bytes:FILE_BYTES,sha256:SHA,parts:run.parts,
    extension:run.extension};
  }
 };
}
function fakeProvider(mediaKind,gatewayId,extension){
 const paths=[],requests=[];
 const fetchImpl=async(url,opts)=>{
  const path=new URL(url).pathname;paths.push(path);
  requests.push({path,range:opts.headers?.range,
   episodeGuard:opts.headers?.['x-blofy-episode-transfer']});
  assert.equal(opts.headers?.authorization,'Bearer '+KEY);
  const prefix='/internal/blofy-content-hub/mirror/'+mediaKind+'/'+gatewayId;
  assert.ok(path===prefix+'/source'||path===prefix+'/describe',
   'must never touch old fixed or public Xtream route: '+path);
  if(path.endsWith('/describe')){
   assert.equal(opts.method,'GET');
   return new Response(JSON.stringify({
    ok:true,sourceName:'saleh',sourceId:ID,
    mediaId:mediaKind==='movie'?'test-movie':'test-episode',
    gatewayId,mediaKind,extension
   }),{status:200,headers:{'content-type':'application/json'}});
  }
  assert.equal(opts.method,'GET');
  if(mediaKind==='episode')
   assert.equal(opts.headers?.['x-blofy-episode-transfer'],
    'operator-authorized');
  const range=/^bytes=(\d+)-(\d+)$/.exec(opts.headers?.range||'');
  assert.ok(range,'bounded Range required');
  const from=Number(range[1]),to=Number(range[2]);
  assert.ok(from>=0&&to<FILE_BYTES&&to>=from);
  const response=new Response(SAMPLE.subarray(from,to+1),{
   status:206,headers:{
    'content-range':'bytes '+from+'-'+to+'/'+FILE_BYTES,
    'content-length':String(to-from+1),'etag':'"fixture-version-1"'
   }
  });
  return response;
 };
 return {fetchImpl,paths,requests};
}
function fakeQueueJob(mediaKind,gatewayId){
 const finish=[],job={ok:true,sourceId:ID,gatewayId,
  mediaId:mediaKind==='movie'?'test-movie':'test-episode',
  extension:'mp4',expectedBytes:FILE_BYTES,runId:RUN_ID,
  previousParts:0};
 return {job,finish,store:{
  async claim(){return job},
  async finish(j,status){assert.equal(j,job);finish.push(status);return {ok:true}}
 }};
}

test('ACTUAL movie 8MiB HTTP 206 -> S3 SHA proof -> verified queue, no external origin',async()=>{
 const mediaKind='movie',gatewayId=60;
 const queue=fakeQueueJob(mediaKind,gatewayId),storage=fakePrivateStorage(),
  lease=fakeLease(mediaKind),upstream=fakeProvider(mediaKind,gatewayId,'mp4');
 const env={...base,
  BLOFY_CONTENT_HUB_MIRROR_MOVIE_DISPATCH_ENABLED:'1',
  BLOFY_CONTENT_HUB_CHUNKED_ENABLED:'1'
 };
 let workerResult;
 const done=await runOneApprovedMirrorMovieChunk({
  env,now:NOW,store:queue.store,storage,lease,
  runner:async opts=>{
   workerResult=await runChunkedMovieBatch({...opts,fetchImpl:upstream.fetchImpl});
   return workerResult;
  }
 });
 assert.equal(done.ok,true,JSON.stringify({done,workerResult,
  operations:storage.ops,sourceRequests:upstream.requests}));
 assert.equal(done.code,'mirror_movie_private_sha_verified');
 assert.equal(done.verified,true);
 assert.equal(done.customerCutover,false);
 assert.equal(queue.finish.length,1);
 assert.equal(queue.finish[0].status,'verified');
 assert.equal(queue.finish[0].sha256,SHA);
 assert.equal(storage.saved.size,1);
 assert.ok(storage.ops.includes('readVerifiedRange'));
 assert.equal(lease.lockCount,0);
 assert.ok(upstream.paths.every(x=>x.startsWith(
  '/internal/blofy-content-hub/mirror/movie/60/')));
 assert.ok(upstream.requests.some(x=>x.range==='bytes=0-8388607'));
});

test('ACTUAL episode 8MiB HTTP 206 -> private S3 SHA -> verified queue, no catalog change',async()=>{
 const mediaKind='episode',gatewayId=71;
 const queue=fakeQueueJob(mediaKind,gatewayId),storage=fakePrivateStorage(),
  lease=fakeLease(mediaKind),upstream=fakeProvider(mediaKind,gatewayId,'mp4');
 const env={...base,
  BLOFY_CONTENT_HUB_MIRROR_EPISODE_DISPATCH_ENABLED:'1',
  BLOFY_CONTENT_HUB_MIRROR_EPISODE_AV_SAMPLE_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_EPISODE_COPY_ENABLED:'1',
  BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED:'1'
 };
 let workerResult;
 const done=await runOneApprovedMirrorEpisodeChunk({
  env,now:NOW,store:queue.store,storage,lease,
  runner:async opts=>{
   workerResult=await runOneEpisodeChunk({...opts,fetchImpl:upstream.fetchImpl});
   return workerResult;
  }
 });
 assert.equal(done.ok,true,JSON.stringify({done,workerResult,
  operations:storage.ops,sourceRequests:upstream.requests}));
 assert.equal(done.code,'mirror_episode_private_sha_verified');
 assert.equal(done.verified,true);
 assert.equal(done.customerCutover,false);
 assert.equal(queue.finish[0].state,'verified');
 assert.equal(queue.finish[0].sha256,SHA);
 assert.equal(storage.saved.size,1);
 assert.ok(storage.ops.includes('readVerifiedRange'));
 assert.equal(lease.lockCount,0);
 assert.ok(upstream.paths.every(x=>x.startsWith(
  '/internal/blofy-content-hub/mirror/episode/71/')));
 assert.ok(upstream.requests.some(x=>x.episodeGuard==='operator-authorized'));
 assert.ok(upstream.requests.some(x=>x.range==='bytes=0-8388607'));
});

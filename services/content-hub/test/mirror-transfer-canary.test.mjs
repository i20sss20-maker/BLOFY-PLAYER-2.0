import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {diagnoseVerifiedMovie} from '../src/playback-diagnostics.mjs';

const CHUNK=8*1024*1024;
const RUN='mirror_'+'a'.repeat(32);
function fixture({verified=true,corrupt=false,tracks=true}={}){
 const bytes=Buffer.alloc(CHUNK,0x42);
 const hash=createHash('sha256').update(bytes).digest('hex');
 let reads=0,decodes=0,sourceRequests=0;
 const key='saleh/movie/123e4567-e89b-42d3-a456-426614174000/batch_'+'a'.repeat(24)+'_part_000001.mkv';
 const lease={
  getVerifiedChunkedObject:async runId=>{
   assert.equal(runId,RUN);
   return verified?{bytes:CHUNK,sha256:hash,extension:'mkv',
     parts:[{partNumber:1,key,bytes:CHUNK,sha256:hash}]}:null
  }
 };
 const storage={
  readVerifiedRange:async({key:got,from,to,expectedBytes})=>{
   assert.equal(got,key);assert.equal(from,0);
   assert.equal(to,CHUNK-1);assert.equal(expectedBytes,CHUNK);
   reads++;
   return Readable.from([corrupt?Buffer.alloc(CHUNK,0x43):bytes]);
  }
 };
 const diagnosticRunner=async(program,args)=>{
  decodes++;
  if(program==='ffprobe')return {stdout:JSON.stringify({
   streams:tracks?[{codec_type:'video',codec_name:'h264',width:1920,
     height:1080},{codec_type:'audio',codec_name:'aac'}]:[],
   format:{duration:'10'}
  })};
  assert.equal(program,'ffmpeg');
  if(args.includes('0:v:0')||args.includes('0:a:0'))
   return {stdout:'0, 12345\n'};
  throw Error('unexpected invocation');
 };
 return {lease,storage,diagnosticRunner,get usage(){
  return {reads,decodes,sourceRequests};
 }};
}
test('offline private S3 canary actually checks video and audio decode paths',async()=>{
 const f=fixture();
 const result=await diagnoseVerifiedMovie({
  runId:RUN,storage:f.storage,lease:f.lease,
  diagnosticRunner:f.diagnosticRunner});
 assert.equal(result.ok,true);
 assert.equal(result.code,'canary_audio_video_decoded');
 assert.equal(result.videoTracks,1);assert.equal(result.audioTracks,1);
 assert.ok(result.videoFramesDecoded>=1);
 assert.ok(result.audioFramesDecoded>=1);
 assert.equal(result.customerCutover,false);
 assert.equal(result.providerRequests,0);
 assert.deepEqual(f.usage,{reads:1,decodes:3,sourceRequests:0});
});
test('no verified manifest means zero S3 or decoder work',async()=>{
 const f=fixture({verified:false});
 const result=await diagnoseVerifiedMovie({
  runId:RUN,storage:f.storage,lease:f.lease,
  diagnosticRunner:f.diagnosticRunner});
 assert.equal(result.ok,false);
 assert.equal(result.code,'canary_movie_not_verified');
 assert.equal(f.usage.reads,0);assert.equal(f.usage.decodes,0);
 assert.equal(result.providerRequests,0);
});
test('corrupted S3 chunk never reaches decoder',async()=>{
 const f=fixture({corrupt:true});
 const result=await diagnoseVerifiedMovie({
  runId:RUN,storage:f.storage,lease:f.lease,
  diagnosticRunner:f.diagnosticRunner});
 assert.equal(result.ok,false);
 assert.equal(result.code,'canary_private_sha256_mismatch');
 assert.equal(f.usage.decodes,0);
 assert.equal(result.providerRequests,0);
});
test('missing media tracks fail private A/V validation',async()=>{
 const f=fixture({tracks:false});
 const result=await diagnoseVerifiedMovie({
  runId:RUN,storage:f.storage,lease:f.lease,
  diagnosticRunner:f.diagnosticRunner});
 assert.equal(result.ok,false);
 assert.equal(result.code,'canary_missing_audio_or_video_track');
 assert.equal(result.providerRequests,0);
});
test('Hub mirror canary requires private Bearer and exact owner action',async()=>{
 const source=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 for(const snippet of [
  "path==='/internal/mirror/copy/canary'",
  "req.headers['x-blofy-owner-action']!=='verify-private-mirror-audio-video'",
  '!/^mirror_[a-f0-9]{32}$/.test(runId)',
  'await diagnoseVerifiedMovie({',
  "if(result.code==='canary_private_sha256_mismatch')",
  'await lease.quarantineMirrorRun({runId,kind:mediaKind})',
  'quarantinedOnHashMismatch:quarantined',
  'providerRequests:0,audioVideoDecoded:result.ok===true',
  'mirrorCanaryBusy',
  'lastMirrorCanary'
 ])assert.ok(source.includes(snippet),snippet);
});

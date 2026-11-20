import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {
 TIMELINE_SECONDS,validateTimelineSegment,makeTimelinePlan,
 inspectPrivateTimeline,buildPrivateTimelineSegment
} from '../src/private-timeline.mjs';

const CHUNK=8*1024*1024;
const RUN='licensed_movie_timeline_001';
const file={kind:'chunked',extension:'mkv',
 sha256:'c'.repeat(64),bytes:CHUNK+4096,parts:[
  {partNumber:1,key:'test-private-movie-1',bytes:CHUNK,sha256:'a'.repeat(64)},
  {partNumber:2,key:'test-private-movie-2',bytes:4096,sha256:'b'.repeat(64)}
 ]};
const lease={
 getVerifiedChunkedObject:async id=>id===RUN?file:null,
 getVerifiedEpisodeObject:async id=>id===RUN?file:null
};
function storage(){
 const requests=[];
 return {requests,readVerifiedRange:async req=>{
   requests.push(req);
   return Readable.from([Buffer.alloc(req.to-req.from+1,7)]);
 }};
}
test('timeline plans are bounded, strictly indexed and end-segment aware',()=>{
 assert.equal(TIMELINE_SECONDS,30);
 assert.deepEqual(makeTimelinePlan(91),{
  durationSeconds:91,segmentSeconds:30,segmentCount:4});
 assert.equal(makeTimelinePlan(36001),null);
 assert.equal(makeTimelinePlan(0),null);
 assert.equal(validateTimelineSegment('0',4),0);
 assert.equal(validateTimelineSegment('3',4),3);
 for(const bad of ['-1','04','4','1000','3.0','3/../','+1','1?x=2'])
  assert.equal(validateTimelineSegment(bad,4),null,bad);
});
test('private metadata probes verified S3 via localhost and caches exact run SHA',async()=>{
 const s=storage();let probes=0;
 const metadata=await inspectPrivateTimeline({mediaKind:'movie',runId:RUN,
  lease,storage:s,durationProbe:async url=>{
   probes++;assert.match(url,/^http:\/\/127\.0\.0\.1:\d+\/private\/[a-f0-9]+$/);
   const res=await fetch(url,{headers:{range:'bytes=0-63'}});
   assert.equal(res.status,206);
   assert.equal((await res.arrayBuffer()).byteLength,64);
   return 91;
  }});
 assert.equal(metadata.ok,true,metadata.code);
 assert.equal(metadata.segmentCount,4);
 assert.equal(metadata.segmentSeconds,30);
 assert.equal(metadata.fullFilePlaybackVerified,false);
 assert.equal(metadata.providerRequests,0);
 assert.equal(s.requests.length,1);
 const cached=await inspectPrivateTimeline({mediaKind:'movie',runId:RUN,
  lease,storage:s,durationProbe:async()=>{throw Error('no reprobe')}});
 assert.equal(cached.ok,true);assert.equal(cached.cacheHit,true);
 assert.equal(probes,1);
});
test('30-second middle timeline MP4 is rendered from verified S3, never Xtream',async()=>{
 const s=storage();
 const result=await buildPrivateTimelineSegment({
  mediaKind:'movie',runId:RUN,segment:'1',lease,storage:s,
  durationProbe:async()=>91,
  transcoder:async({url,output,startSeconds,durationSeconds})=>{
   assert.equal(startSeconds,30);assert.equal(durationSeconds,30);
   const res=await fetch(url,{headers:{range:'bytes=1048576-1048591'}});
   assert.equal(res.status,206);assert.equal((await res.arrayBuffer()).byteLength,16);
   const bytes=Buffer.alloc(4096);bytes.write('ftyp',4,'ascii');
   await writeFile(output,bytes);
  }});
 assert.equal(result.ok,true,result.code);
 assert.equal(result.startSeconds,30);
 assert.equal(result.segmentIndex,1);
 assert.equal(result.segmentDurationSeconds,30);
 assert.equal(result.originalDurationSeconds,91);
 assert.equal(result.originalFileBytes,file.bytes);
 assert.equal(result.providerRequests,0);
 assert.equal(result.fullFilePlaybackVerified,false);
 assert.equal(result.customerCutover,false);
 assert.equal(result.privateS3RangeRequests,1);
 assert.equal(result.bytes.length,4096);
});
test('timeline final MP4 window is 1 second and out-of-range is rejected',async()=>{
 const s=storage();
 let clipped=0;
 const result=await buildPrivateTimelineSegment({
  mediaKind:'movie',runId:RUN,segment:'3',lease,storage:s,
  durationProbe:async()=>91,
  transcoder:async({output,durationSeconds,startSeconds})=>{
   clipped=durationSeconds;
   assert.equal(startSeconds,90);
   const bytes=Buffer.alloc(4096);bytes.write('ftyp',4,'ascii');
   await writeFile(output,bytes);
  }});
 assert.equal(result.ok,true,result.code);assert.equal(clipped,1);
 const bad=await buildPrivateTimelineSegment({
  mediaKind:'movie',runId:RUN,segment:'4',lease,storage:s,
  durationProbe:async()=>91,
  transcoder:async()=>{throw Error('should not run')}});
 assert.equal(bad.ok,false);
 assert.equal(bad.code,'private_timeline_segment_invalid');
 const noFile=await inspectPrivateTimeline({mediaKind:'movie',
  runId:'another_run_000000',lease,storage:s,
  durationProbe:async()=>{throw Error('should not probe')}});
 assert.equal(noFile.ok,false);
 assert.equal(noFile.code,'private_timeline_not_verified');
});
test('hub guards timeline behind exact pinned run and owner rights switch',async()=>{
 const {readFile}=await import('node:fs/promises');
 const src=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 for(const required of ['BLOFY_CONTENT_HUB_WEBSITE_TIMELINE_ENABLED',
  'BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED',
  'BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED',
  'private-verified-s3-timeline','runId!==String(kind',
  'timelineRendering=true','customerCutover:false']){
  assert.ok(src.includes(required),required);
 }
 assert.match(src,/site-qa\\\/timeline/);
 assert.match(src,/buildPrivateTimelineSegment/);
});

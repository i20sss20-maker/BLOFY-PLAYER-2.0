import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {writeFile} from 'node:fs/promises';
import {
 buildStoredMovieSeekPreview,
 createLoopbackVerifiedMovieReader
} from '../src/private-seek-preview.mjs';

const CHUNK=8*1024*1024;
const RUN='stored_movie_00000001';
const PARTS=[
 {partNumber:1,key:'movie-safe-part-1',bytes:CHUNK,sha256:'a'.repeat(64)},
 {partNumber:2,key:'movie-safe-part-2',bytes:8192,sha256:'b'.repeat(64)}
];
const movie={kind:'chunked',extension:'mkv',
 bytes:CHUNK+8192,sha256:'c'.repeat(64),parts:PARTS};
const mkStorage=()=>({
 requests:[],
 async readVerifiedRange(input){
  this.requests.push(input);
  return Readable.from([Buffer.alloc(input.to-input.from+1,1)]);
 }
});
const lease={
 getVerifiedChunkedObject:async id=>id===RUN?movie:null,
 getVerifiedEpisodeObject:async()=>null
};
test('private 127.0.0.1 S3 range proxy crosses verified chunk boundaries',async()=>{
 const storage=mkStorage();
 const proxy=await createLoopbackVerifiedMovieReader({manifest:movie,storage});
 try{
  assert.match(proxy.url,/^http:\/\/127\.0\.0\.1:\d+\/private\/[a-f0-9]{48}$/);
  const response=await fetch(proxy.url,{headers:{
   range:'bytes='+String(CHUNK-3)+'-'+String(CHUNK+2)}});
  assert.equal(response.status,206);
  assert.equal(response.headers.get('content-range'),
   'bytes '+String(CHUNK-3)+'-'+String(CHUNK+2)+'/'+movie.bytes);
  assert.equal((await response.arrayBuffer()).byteLength,6);
  assert.equal(storage.requests.length,2);
  assert.equal(storage.requests[0].key,'movie-safe-part-1');
  assert.equal(storage.requests[0].from,CHUNK-3);
  assert.equal(storage.requests[1].key,'movie-safe-part-2');
  assert.equal(storage.requests[1].from,0);
  assert.equal(storage.requests[1].to,2);
  assert.equal(proxy.stats().readBytes,6);
 }finally{await proxy.close()}
});
test('private local reader refuses multiple range requests and oversized totals',async()=>{
 const storage=mkStorage();
 const proxy=await createLoopbackVerifiedMovieReader({manifest:movie,storage});
 try{
  const invalid=await fetch(proxy.url,{headers:{range:'bytes=0-1,2-3'}});
  assert.equal(invalid.status,416);
  const bad=await fetch(proxy.url,{headers:{range:'bytes='+String(movie.bytes)+'-'}});
  assert.equal(bad.status,416);
  assert.equal(storage.requests.length,0);
  const noRoute=await fetch(proxy.url.replace('/private/','/other/'));
  assert.equal(noRoute.status,404);
 }finally{await proxy.close()}
});
test('owner middle/end clip generator accesses verified S3 only via loopback and emits 10-second MP4',async()=>{
 const storage=mkStorage();
 const probes=[],transcodes=[];
 const sample=await buildStoredMovieSeekPreview({
  runId:RUN,mediaKind:'movie',position:'middle',storage,lease,
  durationProbe:async url=>{
   probes.push(url);
   const result=await fetch(url,{headers:{range:'bytes=64-79'}});
   assert.equal(result.status,206);
   assert.equal((await result.arrayBuffer()).byteLength,16);
   return 120;
  },
  transcoder:async({url,output,seconds})=>{
   transcodes.push({url,seconds});
   assert.equal(url,probes[0]);
   assert.equal(seconds,55);
   const r=await fetch(url,{headers:{range:'bytes=1048576-1048579'}});
   assert.equal(r.status,206);
   assert.equal((await r.arrayBuffer()).byteLength,4);
   const data=Buffer.alloc(4096);
   data.write('ftyp',4,'ascii');
   await writeFile(output,data);
  }
 });
 assert.equal(sample.ok,true,sample.code);
 assert.equal(sample.position,'middle');
 assert.equal(sample.clipStartsAtSeconds,55);
 assert.equal(sample.clipDurationSeconds,10);
 assert.equal(sample.privateSourceBytesRead,20);
 assert.equal(sample.privateRangeRequests,2);
 assert.equal(sample.providerRequests,0);
 assert.equal(sample.customerCutover,false);
 assert.equal(sample.originalFullFilePlaybackVerified,false);
 assert.equal(sample.sourceCopiedAgain,false);
 assert.equal(probes.length,1);
 assert.equal(transcodes.length,1);
});
test('owner near-end clip position and fail-closed unverified manifest',async()=>{
 const storage=mkStorage();
 let target;
 const sample=await buildStoredMovieSeekPreview({
  runId:RUN,position:'near_end',storage,lease,
  durationProbe:async()=>200,
  transcoder:async({seconds,output})=>{
   target=seconds;const bytes=Buffer.alloc(4096);
   bytes.write('ftyp',4,'ascii');await writeFile(output,bytes);
  }
 });
 assert.equal(sample.ok,true);
 assert.equal(target,175);
 const denied=await buildStoredMovieSeekPreview({
  runId:'unknown_run_test',position:'middle',storage,lease,
  durationProbe:async()=>{throw Error('should_not_probe')}
 });
 assert.equal(denied.ok,false);
 assert.equal(denied.code,'site_qa_seek_unverified_file');
});
test('seek previews are opt-in and never grant customer playback',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(source,/BLOFY_CONTENT_HUB_WEBSITE_SEEK_PREVIEW_ENABLED/);
 assert.match(source,/BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED/);
 assert.match(source,/BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED/);
 assert.match(source,/private-verified-s3-seek-clip/);
 assert.match(source,/siteQa/);
 assert.match(source,/site_qa_seek_private_clip_ready|buildStoredMovieSeekPreview/);
});

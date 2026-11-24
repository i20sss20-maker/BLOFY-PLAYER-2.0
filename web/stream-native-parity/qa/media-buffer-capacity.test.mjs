import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {streamMediaFile} from '../stream-media-file.mjs';

const worker=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const workerDocker=readFileSync(new URL('../Dockerfile.media',import.meta.url),'utf8');

function fakeFile(contents,exists=true){
 const blob=new Blob([contents]);
 blob.exists=async()=>exists;
 return blob
}

test('completed large 4K TS file is served as a streamed Blob rather than full readFileSync buffer',async()=>{
 const bytes=new Uint8Array(8*1024*1024);bytes[0]=0x47;bytes[bytes.length-1]=0x47;
 const asset=fakeFile(bytes);
 let requestedPath='';
 const response=await streamMediaFile('/tmp/blofy-encoder/seg-000004.ts','video/mp2t','no-store, private',
  {'X-Blofy-Video-Mode':'source_copy','X-Blofy-Source-Resolution':'3840x2160'},
  p=>{requestedPath=p;return asset});
 assert.equal(response.status,200);
 assert.equal(requestedPath,'/tmp/blofy-encoder/seg-000004.ts');
 assert.equal(response.headers.get('content-type'),'video/mp2t');
 assert.equal(response.headers.get('cache-control'),'no-store, private');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('x-blofy-video-mode'),'source_copy');
 assert.equal(response.headers.get('x-blofy-source-resolution'),'3840x2160');
 assert.ok(response.body instanceof ReadableStream);
 const reader=response.body.getReader();
 const first=await reader.read();
 assert.equal(first.done,false);
 assert.equal(first.value[0],0x47);
 assert.ok(first.value.byteLength<bytes.byteLength,
  'a large segment should use multiple chunks with backpressure, not one giant Response buffer');
 await reader.cancel()
});

test('seekable VOD keeps bounded private caching and streams missing/empty segments defensively',async()=>{
 const ok=await streamMediaFile('/tmp/seek/seg-000006.ts','video/mp2t','private, max-age=3600',
  {},()=>fakeFile(new Uint8Array([0x47,0x00,0x00,0x10])));
 assert.equal(ok.status,200);
 assert.equal(ok.headers.get('cache-control'),'private, max-age=3600');
 assert.equal((await ok.arrayBuffer()).byteLength,4);
 const invalid=await Promise.all([
  streamMediaFile('/tmp/missing','video/mp2t','no-store, private',{},()=>fakeFile([1],false)),
  streamMediaFile('/tmp/zero','video/mp2t','no-store, private',{},()=>fakeFile(new Uint8Array(0))),
  streamMediaFile('/tmp/wrong','application/javascript','no-store, private',{},()=>fakeFile([1])),
  streamMediaFile('','video/mp2t','no-store, private',{},()=>fakeFile([1])),
  streamMediaFile('/tmp/throw','video/mp2t','no-store, private',{},()=>{throw Error('file vanished')})
 ]);
 for(const value of invalid)assert.equal(value,null,'unavailable media must not be served as a successful 200 response');
});

test('all worker TS delivery paths use file streaming, but manifest parsing still reads only small playlists',()=>{
 assert.match(worker,/import\s+\{streamMediaFile\}\s+from '\.\/stream-media-file\.mjs'/);
 const hls=worker.slice(worker.indexOf('async function hlsRequest('),worker.indexOf('/* Web VOD seek experiment'));
 const vod=worker.slice(worker.indexOf('async function vodRequest('),worker.indexOf('/* Full-length VOD:'));
 const full=worker.slice(worker.indexOf('async function fullVodRequest('),worker.indexOf('/* Validate full-VOD seek'));
 assert.match(hls,/streamMediaFile\(path,'video\/mp2t','no-store, private',statusHeaders\)/);
 assert.match(vod,/streamMediaFile\(path,'video\/mp2t','no-store, private'\)/);
 assert.match(full,/streamMediaFile\(filename,'video\/mp2t','private, max-age=3600'\)/);
 assert.match(hls,/readFileSync\(path\)/,'bounded live playlists may still be parsed');
 assert.match(workerDocker,/COPY stream-media-file\.mjs \/app\/stream-media-file\.mjs/);
});

test('production API forwards ONLY numeric private-worker Retry-After between 1 and 30 seconds',()=>{
 const begin=server.indexOf('function verifiedWorkerRetryHeaders('),
  end=server.indexOf('\nfunction noCache(',begin);
 assert.ok(begin>=0&&end>begin);
 const fn=vm.runInNewContext(server.slice(begin,end)+';verifiedWorkerRetryHeaders',{Number});
 const get=x=>fn(new Headers({'retry-after':String(x)}));
 assert.equal(get('5')['Retry-After'],'5');
 assert.equal(get('30')['Retry-After'],'30');
 for(const invalid of ['0','31','999','3.5','NaN','5\nX-Auth:password','foo']){
  assert.equal(Object.keys(get(invalid)).length,0,'reject invalid worker retry hint '+invalid)
 }
 assert.equal(Object.keys(fn(null)).length,0);
 assert.equal((server.match(/verifiedWorkerRetryHeaders\(response\.headers\)/g)||[]).length,2);
});

test('encoder 429 has bounded retry advice, VOD client backs off without retry storms',()=>{
 assert.match(worker,/if\(start\.error\)return hlsError\(start\.status,start\.error,start\.status===429\?5:0\)/);
 assert.match(worker,/if\(created\.error\)return created\.status===429\?hlsError\(429,created\.error,5\)/);
 assert.match(worker,/if\(started\.error\)return started\.status===429\?hlsError\(429,started\.error,5\)/);
 const full=app.slice(app.indexOf('function playFullVod('),app.indexOf('function playVodSegments('));
 assert.match(full,/rec\.capacityRetries=\(rec\.capacityRetries\|\|0\)\+1/);
 assert.match(full,/if\(rec\.capacityRetries<=2\)/);
 assert.match(full,/rec\.capacityRetries===1\?5000:8500/);
 assert.match(full,/if\(rec\.retryTimer\)clearTimeout\(rec\.retryTimer\)/);
 assert.match(full,/hls\.on\(window\.Hls\.Events\.FRAG_LOADED,function\(\)/);
 assert.match(full,/rec\.capacityRetries=0/);
 assert.match(full,/playerStatus\('محرك الفيديو مشغول مؤقتًا/);
});

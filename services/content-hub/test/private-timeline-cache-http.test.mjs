import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createContentHubServer} from '../src/server.mjs';

const TOKEN='O'.repeat(40);
const RUN='licensed_movie_timeline_001';
const SHA='a'.repeat(64);
const URLPATH='/internal/site-qa/timeline/movie/'+RUN+'/clip/';
const env={
 BLOFY_CONTENT_HUB_WEBSITE_TIMELINE_ENABLED:'1',
 BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
 BLOFY_CONTENT_HUB_OWNER_PREVIEW_ENABLED:'1',
 BLOFY_CONTENT_HUB_BATCH_RUN_ID:RUN
};
const meta={ok:true,durationSeconds:91,segmentSeconds:30,segmentCount:4};
async function makeServer(){
 let renders=0,lookups=0,sha=SHA;
 const lease={
  async getVerifiedChunkedObject(){lookups++;return {
    kind:'chunked',sha256:sha,bytes:2934023949}}
 };
 const server=createContentHubServer({
  token:TOKEN,storage:{},lease,pilotEnv:{...env},
  timelineInspector:async()=>meta,
  timelineRenderer:async({runId,mediaKind,segment})=>{
   renders++;
   const i=Number(segment);
   const bytes=Buffer.alloc(4096);bytes.write('ftyp',4,'ascii');
   return {ok:true,mediaKind,runId,segmentIndex:i,
    startSeconds:i*30,segmentDurationSeconds:30,
    originalFileBytes:2934023949,bytes};
  }
 }).server;
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 async function read(index,options={}){
  return fetch(origin+URLPATH+index+'.mp4',{
   headers:{authorization:'Bearer '+TOKEN,
    'x-blofy-owner-action':'private-verified-s3-timeline'},
   ...options
  });
 }
 return {server,read,lease,get renders(){return renders},
  get lookups(){return lookups},
  setSha(s){sha=s},close:()=>new Promise(resolve=>server.close(resolve))};
}
test('authenticated repeated window is served from memory after verifying the latest manifest',async()=>{
 const h=await makeServer();
 try{
  let r=await h.read(1);
  assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,4096);
  r=await h.read(1);
  assert.equal(r.status,200);assert.equal((await r.arrayBuffer()).byteLength,4096);
  assert.equal(h.renders,1);
  assert.equal(h.lookups,2,'a fresh verified manifest query precedes every cache hit');
  assert.equal(r.headers.get('cache-control'),'private,no-store');
  assert.equal(r.headers.get('x-blofy-timeline-source'),'verified-private-s3');
  h.setSha('b'.repeat(64));
  r=await h.read(1);
  assert.equal(r.status,200);
  assert.equal(h.renders,2,'SHA changed, so the old clip was not reused');
 }finally{await h.close()}
});
test('owner timeline LRU evicts old windows, never serves cross-run or unauthenticated clips',async()=>{
 const h=await makeServer();
 try{
  for(const i of [0,1,2])assert.equal((await h.read(i)).status,200);
  assert.equal(h.renders,3);
  assert.equal((await h.read(0)).status,200);
  assert.equal(h.renders,4,'oldest clip evicted by max-two bound');
  const unauthorized=await fetch(
   'http://127.0.0.1:'+h.server.address().port+URLPATH+'0.mp4');
  assert.equal(unauthorized.status,401);
  assert.equal(h.renders,4);
  const unknown=await fetch(
   'http://127.0.0.1:'+h.server.address().port+
     '/internal/site-qa/timeline/movie/other_movie_run_001/clip/0.mp4',{
      headers:{authorization:'Bearer '+TOKEN,
       'x-blofy-owner-action':'private-verified-s3-timeline'}});
  assert.equal(unknown.status,404);
  assert.equal(h.renders,4);
 }finally{await h.close()}
});

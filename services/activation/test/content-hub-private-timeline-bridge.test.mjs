import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {forwardPrivateTimeline} from '../src/content-hub-private-timeline-bridge.mjs';

const RUN='licensed_movie_timeline_001',TOKEN='T'.repeat(40);
async function server({segment=null,fetchImpl,mediaKind='movie'}){
 const app=http.createServer((req,res)=>void forwardPrivateTimeline({
  req,res,segment,mediaKind,runId:RUN,hubToken:TOKEN,fetchImpl}));
 app.listen(0,'127.0.0.1');await once(app,'listening');
 return {url:'http://127.0.0.1:'+app.address().port,
  close:()=>new Promise(resolve=>app.close(resolve))};
}
function meta(){
 return Response.json({ok:true,mediaKind:'movie',runId:RUN,
   durationSeconds:91,segmentSeconds:30,segmentCount:4,
   customerCutover:false,fullFilePlaybackVerified:false});
}
function clip(index=1){
 const b=Buffer.alloc(4096);b.write('ftyp',4,'ascii');
 return new Response(b,{status:200,headers:{
  'content-type':'video/mp4','content-length':String(b.length),
  'x-blofy-timeline-index':String(index),
  'x-blofy-timeline-offset':String(index*30),
  'x-blofy-timeline-duration':'30',
  'x-blofy-timeline-source':'verified-private-s3'}});
}
test('portal exposes bounded private S3 timeline metadata with no secrets',async()=>{
 const calls=[];
 const s=await server({fetchImpl:async(url,args)=>{
  calls.push({url,args});return meta()}});
 try{
  const r=await fetch(s.url);
  assert.equal(r.status,200);const b=await r.json();
  assert.equal(b.segmentCount,4);assert.equal(b.segmentSeconds,30);
  assert.equal(b.customerCutover,false);assert.equal(b.fullFilePlaybackVerified,false);
  assert.equal(calls.length,1);
  assert.ok(calls[0].url.endsWith('/internal/site-qa/timeline/movie/'+RUN+'/meta'));
  assert.equal(calls[0].args.headers.authorization,'Bearer '+TOKEN);
  assert.equal(calls[0].args.headers['x-blofy-owner-action'],'private-verified-s3-timeline');
 }finally{await s.close()}
});
test('portal relays MP4 window only with exact verified private proof headers',async()=>{
 const s=await server({segment:'1',fetchImpl:async()=>clip(1)});
 try{
  const r=await fetch(s.url);assert.equal(r.status,200);
  assert.equal(r.headers.get('x-blofy-timeline-index'),'1');
  assert.equal(r.headers.get('x-blofy-timeline-offset'),'30');
  assert.equal(r.headers.get('cache-control'),'private,no-store');
  assert.equal((await r.arrayBuffer()).byteLength,4096);
 }finally{await s.close()}
});
test('portal rejects counterfeit timeline indexes and invalid metadata',async()=>{
 const x=await server({segment:'1',fetchImpl:async()=>clip(2)});
 try{
  const r=await fetch(x.url);
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'private_timeline_video_proof_invalid');
 }finally{await x.close()}
 const y=await server({fetchImpl:async()=>Response.json({
  ok:true,mediaKind:'movie',runId:RUN,segmentSeconds:30,
  segmentCount:10,durationSeconds:91,
  customerCutover:false,fullFilePlaybackVerified:false})});
 try{assert.equal((await fetch(y.url)).status,503)}
 finally{await y.close()}
});
test('portal rejects query and methods before private egress',async()=>{
 let count=0;
 const s=await server({fetchImpl:async()=>{count++;return meta()}});
 try{
  assert.equal((await fetch(s.url+'?unsafe=1')).status,405);
  assert.equal((await fetch(s.url,{method:'HEAD'})).status,405);
  assert.equal(count,0);
 }finally{await s.close()}
});

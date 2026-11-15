import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {forwardPrivateSeekPreview} from '../src/content-hub-private-seek-bridge.mjs';

const RUN='stored_movie_00000001',TOKEN='x'.repeat(40);
async function serve(fetchImpl,{mediaKind='movie',position='middle',runId=RUN,hubToken=TOKEN}={}){
 const s=http.createServer((req,res)=>void forwardPrivateSeekPreview({
  req,res,mediaKind,position,runId,hubToken,fetchImpl}));
 s.listen(0,'127.0.0.1');await once(s,'listening');
 return {url:'http://127.0.0.1:'+s.address().port,
  close:()=>new Promise(resolve=>s.close(resolve))};
}
test('private Portal sends fixed S3 seek sample and preserves proof headers',async()=>{
 const requests=[];
 const clip=Buffer.alloc(4096);clip.write('ftyp',4,'ascii');
 const server=await serve(async(url,req)=>{
  requests.push({url,req});
  return new Response(clip,{status:200,headers:{
   'content-type':'video/mp4','content-length':String(clip.length),
   'x-blofy-clip-position':'middle',
   'x-blofy-clip-start-seconds':'2124',
   'x-blofy-clip-source':'verified-private-s3'}});
 });
 try{
  const r=await fetch(server.url);
  assert.equal(r.status,200);
  assert.equal(r.headers.get('content-type'),'video/mp4');
  assert.equal(r.headers.get('x-blofy-clip-position'),'middle');
  assert.equal(r.headers.get('x-blofy-clip-start-seconds'),'2124');
  assert.equal((await r.arrayBuffer()).byteLength,clip.length);
  assert.equal(requests.length,1);
  assert.equal(requests[0].req.headers.authorization,'Bearer '+TOKEN);
  assert.equal(requests[0].req.headers['x-blofy-owner-action'],
    'private-verified-s3-seek-clip');
  assert.ok(requests[0].url.endsWith(
   '/internal/site-qa/seek-preview/movie/'+RUN+'/middle'));
 }finally{await server.close()}
});
test('private Portal rejects wrong content type, missing proof, unauthorised selection',async()=>{
 const clip=Buffer.alloc(4096);
 const server=await serve(async()=>new Response(clip,{status:200,headers:{
  'content-type':'video/mp4','content-length':'4096',
  'x-blofy-clip-position':'near_end',
  'x-blofy-clip-start-seconds':'1',
  'x-blofy-clip-source':'verified-private-s3'}}));
 try{
  assert.equal((await fetch(server.url)).status,503);
  assert.equal((await fetch(server.url,{method:'HEAD'})).status,405);
  assert.equal((await fetch(server.url+'?source=http://malicious')).status,405);
 }finally{await server.close()}
 const bad=await serve(async()=>{throw Error('must not call')},{runId:'../secret'});
 try{assert.equal((await fetch(bad.url)).status,400)}
 finally{await bad.close()}
});
test('private Portal maps disabled Hub route to 404, does not generate client secrets',async()=>{
 const server=await serve(async()=>new Response(null,{status:404}));
 try{
  const r=await fetch(server.url);
  assert.equal(r.status,404);
  const body=await r.json();
  assert.equal(body.code,'site_qa_seek_not_available');
  assert.doesNotMatch(JSON.stringify(body),/secret|sourceUrl|provider/i);
 }finally{await server.close()}
});

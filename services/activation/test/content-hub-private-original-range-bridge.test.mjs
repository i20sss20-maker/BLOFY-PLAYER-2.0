import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {forwardPrivateOriginalRange} from '../src/content-hub-private-original-range-bridge.mjs';
const RUN='saleh_movie_1349410_20261114',TOKEN='T'.repeat(36);
const TOTAL=2934023949;
async function served(fetchImpl){
 const server=http.createServer((req,res)=>void forwardPrivateOriginalRange({
   req,res,hubToken:TOKEN,mediaKind:'movie',runId:RUN,fetchImpl}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {url:'http://127.0.0.1:'+server.address().port,
   close:()=>new Promise(resolve=>server.close(resolve))};
}
test('site QA portal relay emits an exact capped original S3 Range, no provider credentials',async()=>{
 const incoming=[];
 const server=await served(async(url,opt)=>{
  incoming.push({url,opt});
  if(opt.method==='HEAD')return new Response(null,{status:200,
   headers:{'content-type':'video/x-matroska','content-length':String(TOTAL)}});
  return new Response(Buffer.alloc(6,12),{status:206,
   headers:{'content-type':'video/x-matroska','content-length':'6',
    'content-range':'bytes 2048-2053/'+TOTAL}});
 });
 try{
  const head=await fetch(server.url,{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal(head.headers.get('content-length'),String(TOTAL));
  const res=await fetch(server.url,{headers:{range:'bytes=2048-2053'}});
  assert.equal(res.status,206);assert.equal(res.headers.get('content-length'),'6');
  assert.equal((await res.arrayBuffer()).byteLength,6);
  assert.equal(incoming.length,2);
  assert.equal(incoming[1].opt.headers.range,'bytes=2048-2053');
  assert.equal(incoming[1].opt.headers['x-blofy-owner-action'],'private-original-range-qa');
  assert.ok(incoming[1].url.endsWith('/internal/site-qa/files/movie/'+RUN));
  assert.equal(res.headers.get('cache-control'),'private,no-store');
 }finally{await server.close()}
});
test('site QA blocks malicious oversized, multi-range and mismatched origin responses',async()=>{
 let requests=0;
 const server=await served(async()=>{
  requests++;
  return new Response(Buffer.alloc(4),{status:206,
   headers:{'content-type':'video/mp4','content-length':'4',
    'content-range':'bytes 2-5/'+TOTAL}});
 });
 try{
  const invalid=await fetch(server.url,{headers:{range:'bytes=0-1,4-5'}});
  assert.equal(invalid.status,416);assert.equal(requests,0);
  const response=await fetch(server.url,{headers:{range:'bytes=0-3'}});
  assert.equal(response.status,503);
 }finally{await server.close()}
});
test('site QA returns 404 when private Hub blocks opt-in route',async()=>{
 const server=await served(async()=>new Response('not found',{status:404}));
 try{
  const response=await fetch(server.url,{headers:{range:'bytes=0-15'}});
  assert.equal(response.status,404);
  assert.equal((await response.json()).code,'site_qa_original_unavailable');
 }finally{await server.close()}
});

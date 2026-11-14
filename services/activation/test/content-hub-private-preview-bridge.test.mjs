import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {forwardPrivatePreview} from '../src/content-hub-private-preview-bridge.mjs';

const token='private-hub-operator-token-1234567890';
async function withServer(fetchImpl,handler){
 const server=http.createServer((req,res)=>void forwardPrivatePreview({
  req,res,hubToken:token,fetchImpl
 }));
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 try{return await handler('http://127.0.0.1:'+server.address().port)}
 finally{await new Promise(resolve=>server.close(resolve))}
}
test('internal STREAM bridge sends bearer secret ONLY to private Hub and streams a capped MP4',async()=>{
 const mp4=Buffer.concat([Buffer.alloc(4),Buffer.from('ftyp'),Buffer.alloc(2300)]);
 const calls=[];
 await withServer(async(url,opts)=>{
  calls.push({url,opts});
  return new Response(mp4,{status:200,
   headers:{'content-type':'video/mp4','content-length':String(mp4.length)}});
 },async base=>{
  const res=await fetch(base+'/internal/blofy-stream/content-hub/preview');
  assert.equal(res.status,200);
  assert.equal(res.headers.get('content-type'),'video/mp4');
  assert.equal(res.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()),mp4);
 });
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/^http:\/\/blofy-content-hub\.railway\.internal:3000\/internal\/playback\/preview$/);
 assert.equal(calls[0].opts.headers.authorization,'Bearer '+token);
 assert.equal(calls[0].opts.headers['x-blofy-owner-preview'],'operator-only');
});
test('forwarder denies query tricks, POST and untrusted video response',async()=>{
 let calls=0;
 await withServer(async()=>{
  calls++;
  return new Response(JSON.stringify({error:'not found'}),{
   status:404,headers:{'content-type':'application/json'}});
 },async base=>{
  const a=await fetch(base+'/internal/blofy-stream/content-hub/preview?url=evil');
  assert.equal(a.status,400);
  const b=await fetch(base+'/internal/blofy-stream/content-hub/preview',{
   method:'POST'});
  assert.equal(b.status,405);
  const c=await fetch(base+'/internal/blofy-stream/content-hub/preview');
  assert.equal(c.status,503);
  assert.equal((await c.json()).code,'owner_preview_not_ready');
 });
 assert.equal(calls,1);
});
test('overlarge MP4 is refused without forwarding bytes to stream',async()=>{
 await withServer(async()=>new Response(Buffer.alloc(2300),{
  status:200,headers:{'content-type':'video/mp4',
   'content-length':String(13*1024*1024)}}),async base=>{
  const r=await fetch(base+'/internal/blofy-stream/content-hub/preview');
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'owner_preview_upstream_size_invalid');
 });
});

test('private episode preview uses separate fixed path and episode-only owner assertion',async()=>{
 const mp4=Buffer.concat([Buffer.alloc(4),Buffer.from('ftyp'),Buffer.alloc(3000)]);
 const requests=[];
 const server=http.createServer((req,res)=>void forwardPrivatePreview({
  req,res,hubToken:token,mediaKind:'episode',
  fetchImpl:async(url,init)=>{
   requests.push({url,init});
   return new Response(mp4,{status:200,headers:{
    'content-type':'video/mp4','content-length':String(mp4.length)}});
  }
 }));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 try{
  const url='http://127.0.0.1:'+server.address().port+
   '/internal/blofy-stream/content-hub/episodes/preview';
  const response=await fetch(url);
  assert.equal(response.status,200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),mp4);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,
   'http://blofy-content-hub.railway.internal:3000/internal/episodes/playback/preview');
  assert.equal(requests[0].init.headers['x-blofy-owner-preview'],
   'operator-episode-only');
  assert.equal(requests[0].init.headers.authorization,'Bearer '+token);
 }finally{await new Promise(resolve=>server.close(resolve))}
});

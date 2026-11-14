import test from 'node:test';
import assert from 'node:assert/strict';
import {probePrivateEpisodeRange} from '../src/xtream-content-hub-episode-probe.mjs';
test('episode size proof reads exactly one 4KiB request, no file copy',async()=>{
 let count=0;
 const result=await probePrivateEpisodeRange({
  url:new URL('https://example.invalid/series/demo/123.mkv'),
  fetchImpl:async(url,opts)=>{
   count++;
   assert.equal(opts.headers.range,'bytes=0-4095');
   assert.equal(opts.redirect,'manual');
   return new Response(Buffer.alloc(4096),{status:206,headers:{
    'content-range':'bytes 0-4095/1938473000',
    'content-length':'4096',etag:'"stable"'}});
  }
 });
 assert.equal(result.ok,true);
 assert.equal(result.expectedBytes,1938473000);
 assert.equal(result.validatorPresent,true);
 assert.equal(result.probeBytes,4096);
 assert.equal(result.stored,false);
 assert.equal(result.customerCutover,false);
 assert.equal(count,1);
});
test('provider that ignores byte ranges is rejected without full download',async()=>{
 let response;
 const result=await probePrivateEpisodeRange({
  url:'https://example.invalid/episode',
  fetchImpl:async()=>{response=new Response(Buffer.alloc(4096),{
   status:200,headers:{'content-length':'4096'}});return response}
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'episode_source_range_invalid');
 assert.equal(result.probeBytes,0);
});
test('provider short response or spoofed Content-Range fails closed',async()=>{
 const cases=[
  {status:206,headers:{'content-range':'bytes 8-4103/123456',
    'content-length':'4096'},len:4096},
  {status:206,headers:{'content-range':'bytes 0-4095/123456',
    'content-length':'4096'},len:1024},
  {status:206,headers:{'content-range':'bytes 0-4095/999999999999',
    'content-length':'4096'},len:4096}
 ];
 for(const c of cases){
  const result=await probePrivateEpisodeRange({
   url:'https://example.invalid/episode',
   fetchImpl:async()=>new Response(Buffer.alloc(c.len),
    {status:c.status,headers:c.headers})
  });
  assert.equal(result.ok,false);
  assert.equal(result.stored,false);
 }
});

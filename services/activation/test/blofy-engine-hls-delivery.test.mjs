import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createEngineHlsDelivery,validateEngineManifest} from '../src/blofy-engine-hls-delivery.mjs';
const g='a'.repeat(32),a='b'.repeat(32),mac='c'.repeat(64);
const playlist='#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:0\n'+[0,1,2].map(i=>'#EXTINF:2.000000,\nseg-'+String(i).padStart(9,'0')+'.ts\n').join('');
const payload=Buffer.alloc(188*3,0x47);
test('worker manifest accepts only consecutive local media and no external URIs',()=>{
 assert.equal(validateEngineManifest(playlist),playlist);
 for(const bad of [playlist.replace('seg-000000001.ts','https://elsewhere.example/a.ts'),playlist.replace('seg-000000001.ts','../a.ts'),playlist.replace('seg-000000001.ts','seg-000000003.ts'),playlist.replace('#EXT-X-VERSION:3','#EXT-X-KEY:METHOD=AES-128,URI="secret"'),playlist.replace('seg-000000002.ts','')])assert.equal(validateEngineManifest(bad),null);
});
test('long DVR manifest needs explicit operator opt-in and rejects oversized windows',()=>{
 const make=n=>'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n'+Array.from({length:n},(_,i)=>'#EXTINF:2.000000,\nseg-'+String(i).padStart(9,'0')+'.ts\n').join('');
 assert.equal(validateEngineManifest(make(75)),null);
 assert.equal(validateEngineManifest(make(75),{timeshift:true}),make(75));
 assert.equal(validateEngineManifest(make(76),{timeshift:true}),null);
 assert.equal(validateEngineManifest(make(75).replace('seg-000000010.ts','https://example.com/a.ts'),{timeshift:true}),null);
});
test('stable same-origin HLS authorizes each request and renews expiring private worker grants',async()=>{
 let now=1700000000000,allowed=true,grantHost='media2.blofyplayer.com',grantGeneration=g,grantLifetime=60,authorizations=0,upstreams=[];
 const deliver=createEngineHlsDelivery({enabled:true,clock:()=>now,authorizeGrant:async context=>{
  authorizations++;assert.equal(context.accountId,'server-owned-account');
  if(!allowed)return {ok:false};
  return {ok:true,mediaHost:grantHost,path:'/v1/'+grantGeneration+'/'+a+'/'+(now/1000+grantLifetime)+'/'+mac+'/index.m3u8'};
 },fetchImpl:async(url,options)=>{
  assert.equal(options.redirect,'error');
  upstreams.push(url);
  return url.endsWith('index.m3u8')?new Response(playlist,{headers:{'content-type':'application/vnd.apple.mpegurl'}}):new Response(payload,{headers:{'content-type':'video/mp2t','content-length':String(payload.length)}});
 }});
 const server=http.createServer((req,res)=>void deliver(req,res,{accountId:'server-owned-account',generation:g,name:req.url.slice(1)}));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port+'/';
 try{
  const r=await fetch(base+'index.m3u8');assert.equal(r.status,200);assert.equal(await r.text(),playlist);
  now+=61000;
  const s=await fetch(base+'seg-000000001.ts');assert.equal(s.status,200);assert.deepEqual(Buffer.from(await s.arrayBuffer()),payload);
  assert.notEqual(new URL(upstreams[0]).pathname.split('/')[4],new URL(upstreams[1]).pathname.split('/')[4]);assert.equal(authorizations,2);
  allowed=false;assert.equal((await fetch(base+'seg-000000002.ts')).status,403);assert.equal(upstreams.length,2);
  allowed=true;grantHost='elsewhere.example';assert.equal((await fetch(base+'index.m3u8')).status,403);
  grantHost='media2.blofyplayer.com';grantGeneration='f'.repeat(32);assert.equal((await fetch(base+'index.m3u8')).status,503);
  grantGeneration=g;grantLifetime=0;assert.equal((await fetch(base+'index.m3u8')).status,503);
  assert.equal((await fetch(base+'status.json')).status,404);
  assert.equal(upstreams.length,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});

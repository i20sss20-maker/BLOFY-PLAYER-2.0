import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamFeedCanary} from './stream-feed-cache.mjs';
const valid={release:{app:{packageName:'tv.blofy.player.v2.stream',
 versionCode:2000117,versionName:'2.0.0-rc07.56.0.2-STREAM',
 sha256:'a'.repeat(64),apkSizeBytes:135787039,
 downloadUrl:'https://updates.blofyplayer.com/d/blofy-stream'}}};
const response=(value,status=200)=>new Response(JSON.stringify(value),{
 status,headers:{'content-type':'application/json'}});
test('cache last verified public updater metadata when origin becomes unavailable',async()=>{
 let t=1000,calls=0;
 const cache=createStreamFeedCanary({now:()=>t,freshMs:10,staleMs:100,
 fetchImpl:async()=>{calls++;if(calls>1)throw Error('offline');return response(valid);}});
 const first=await cache.read();
 assert.equal(first.stale,false);
 t+=20;
 const saved=await cache.read();
 assert.equal(saved.stale,true);
 assert.equal(saved.body,first.body);
 t+=101;
 assert.equal(await cache.read(),null);
});
test('invalid metadata and mismatched package never enter cache',async()=>{
 const cache=createStreamFeedCanary({fetchImpl:async()=>response({
  release:{app:{...valid.release.app,packageName:'another.package'}}
 })});
 assert.equal(await cache.read(),null);
 assert.equal(cache.status().hasCache,false);
});
test('refresh successfully replaces the cached verified metadata',async()=>{
 let t=100,seq=0;
 const cache=createStreamFeedCanary({now:()=>t,freshMs:5,
 fetchImpl:async()=>response({release:{app:{...valid.release.app,versionCode:++seq}}})});
 assert.equal(JSON.parse((await cache.read()).body).release.app.versionCode,1);
 t+=10;
 assert.equal(JSON.parse((await cache.read()).body).release.app.versionCode,2);
});

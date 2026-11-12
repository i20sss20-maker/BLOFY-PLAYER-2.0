import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createXtreamJsonArrayWriter} from '../src/xtream-json-array-writer.mjs';
import {createXtreamPublicInfoCache} from '../src/xtream-public-info-cache.mjs';

/**
 * Deterministic 20-client synthetic stress run. Never requests a real Xtream
 * provider, a paid source, or even a Railway endpoint: authorization and
 * upstream connection limits are preserved.
 */
test('20 concurrent clients receive full large movie/live/series catalogs in bounded chunks',async()=>{
 const rows=Array.from({length:7500},(_,index)=>({
   stream_id:index+1,name:'Arabic film '+index,
   category_id:String(index%28),stream_type:index%3?'movie':'live'
 }));
 const runs=Array.from({length:20},async(_,client)=>{
   const chunks=[],start=performance.now();
   const writer=createXtreamJsonArrayWriter(
     async chunk=>{chunks.push(chunk);await Promise.resolve()},
     {maxChars:65536,maxItems:128});
   for(const item of rows){
     const pending=writer.append(item);
     if(pending)await pending;
   }
   await writer.finish();
   const actual=JSON.parse(chunks.join(''));
   assert.equal(actual.length,rows.length);
   assert.equal(actual[0].stream_id,1);
   assert.equal(actual.at(-1).stream_id,rows.length);
   assert.ok(chunks.length<rows.length/12,'catalog sent in batches not per-row writes');
   assert.ok(chunks.every(x=>x.length<70000),'bounded serialized chunks');
   return {client,ms:Math.round(performance.now()-start),chunks:chunks.length};
 });
 const results=await Promise.all(runs);
 assert.equal(results.length,20);
 const times=results.map(x=>x.ms).sort((a,b)=>a-b);
 console.log(JSON.stringify({test:'synthetic-catalog-20-clients',clients:20,itemsPerClient:rows.length,medianMs:times[10],p90Ms:times[18],realProviderCalls:0}));
});

test('50 simultaneous authorized metadata lookups coalesce per series and do not mix sources',async()=>{
 const cache=createXtreamPublicInfoCache({ttlMs:60000,maxEntries:8,maxValueBytes:10000,maxTotalBytes:100000});
 let calls=0;
 const loader=async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {episodes:{'1':[{id:'6001'}]}}};
 const values=await Promise.all(Array.from({length:50},()=>cache.get('series:provider-a:700',loader)));
 assert.equal(calls,1);
 assert.ok(values.every(x=>x===values[0]));
 const other=await cache.get('series:provider-b:700',async()=>({episodes:{'1':[{id:'8001'}]}}));
 assert.notDeepEqual(other,values[0]);
 console.log(JSON.stringify({test:'synthetic-series-singleflight',clients:50,sourceFetches:1,realProviderCalls:0}));
});

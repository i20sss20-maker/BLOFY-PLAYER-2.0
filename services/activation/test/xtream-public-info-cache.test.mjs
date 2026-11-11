import test from 'node:test';
import assert from 'node:assert/strict';
import {createXtreamPublicInfoCache} from '../src/xtream-public-info-cache.mjs';

test('same public series concurrent fetches are coalesced and cached briefly',async()=>{
 let at=1000,fetches=0;
 const cache=createXtreamPublicInfoCache({now:()=>at,ttlMs:200,maxEntries:3,maxValueBytes:1000,maxTotalBytes:3000});
 const loader=async()=>{fetches++;await new Promise(resolve=>setTimeout(resolve,15));return {episodes:{'1':[{id:'1001'}]}}};
 const results=await Promise.all(Array.from({length:20},()=>cache.get('series:one',loader)));
 assert.equal(fetches,1);
 assert.deepEqual(results[0],results.at(-1));
 await cache.get('series:one',loader);
 assert.equal(fetches,1);
 at+=201;
 await cache.get('series:one',loader);
 assert.equal(fetches,2);
});
test('provider fetch errors are not cached and do not poison subsequent requests',async()=>{
 const cache=createXtreamPublicInfoCache();
 let n=0;
 await assert.rejects(cache.get('series:two',()=>{n++;throw Error('upstream unavailable')}),/upstream/);
 assert.deepEqual(await cache.get('series:two',()=>{n++;return {ok:true}}),{ok:true});
 assert.equal(n,2);
});
test('large provider metadata bypasses cache and old entries are evicted',async()=>{
 let n=0;
 const cache=createXtreamPublicInfoCache({ttlMs:99999,maxEntries:1,maxValueBytes:80,maxTotalBytes:80});
 const load=()=>{n++;return {a:'x'.repeat(90)}};
 await cache.get('a',load);
 await cache.get('a',load);
 assert.equal(n,2,'oversized object must not be retained');
 const small=key=>cache.get(key,()=>{n++;return {key}});
 await small('b');await small('c');await small('b');
 assert.equal(n,5,'bounded cache evicts least recent entries');
});
test('cache source scope is explicit in key and allows no cross-source data',async()=>{
 let n=0;
 const cache=createXtreamPublicInfoCache();
 const one=await cache.get('series:source1:100',()=>({value:++n}));
 const two=await cache.get('series:source2:100',()=>({value:++n}));
 assert.notDeepEqual(one,two);
 assert.deepEqual(await cache.get('series:source1:100',()=>({value:++n})),one);
});

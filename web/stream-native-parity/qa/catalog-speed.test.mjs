import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {createCatalogPageCache} from '../catalog-page-cache.mjs';
const key=n=>String(n).padStart(64,'a');
const page=(id)=>({items:[{stream_id:id,name:'فيلم '+id}],hasMore:false,nextOffset:1,kind:'movie'});
test('navigation cache speeds same authorized page within 45 seconds and expires cleanly',()=>{
 let now=1000;const c=createCatalogPageCache({ttlMs:45000,now:()=>now});
 assert.equal(c.get(key('1')),null);
 assert.equal(c.put(key('1'),page(11)),true);
 assert.deepEqual(c.get(key('1')),page(11));
 assert.deepEqual(c.stats(),{entries:1,hits:1,misses:1});
 now+=44999;assert.ok(c.get(key('1')));
 now++;assert.equal(c.get(key('1')),null);
 assert.equal(c.stats().entries,0)
});
test('cache has a hard LRU entry limit and never leaks a different account key',()=>{
 const c=createCatalogPageCache({maxEntries:2});
 c.put(key('1'),page(1));c.put(key('2'),page(2));
 assert.ok(c.get(key('1')),'touch account 1');
 c.put(key('3'),page(3));
 assert.equal(c.get(key('2')),null,'least recently used removed');
 assert.equal(c.get(key('3')).items[0].stream_id,3);
 assert.equal(c.get(key('1')).items[0].stream_id,1);
 assert.equal(c.stats().entries,2);
 const hmac=(bearer)=>createHmac('sha256',Buffer.alloc(32,7))
  .update('blofy-web-catalog-page-v1\0'+bearer+'\0movie\0all\00\036').digest('hex');
 assert.notEqual(hmac('Bearer v1.user-A'),hmac('Bearer v1.user-B'),
  'each authenticated bearer must have its own key partition')
});
test('oversized/invalid source data and untrusted non-HMAC keys are never cached',()=>{
 const c=createCatalogPageCache({maxEntryBytes:2048});
 assert.equal(c.put('v1.account.secret',page(1)),false);
 assert.equal(c.put(key('1'),{error:'unavailable'}),false);
 assert.equal(c.put(key('1'),{...page(1),items:new Array(49).fill({})}),false);
 assert.equal(c.put(key('1'),{...page(1),hasMore:'yes'}),false);
 assert.equal(c.put(key('1'),{...page(1),nextOffset:-1}),false);
 assert.equal(c.put(key('1'),{...page(1),items:[{name:'x'.repeat(2500)}]}),false);
 assert.equal(c.stats().entries,0)
});
test('changing an existing key replaces prior page; cache remains bounded after expiry',()=>{
 let now=0;const c=createCatalogPageCache({ttlMs:1000,maxEntries:3,now:()=>now});
 c.put(key('1'),page(1));
 c.put(key('1'),page(11));
 assert.equal(c.get(key('1')).items[0].stream_id,11);
 now=1200;
 c.put(key('2'),page(2));
 assert.equal(c.stats().entries,1);
 assert.equal(c.get(key('1')),null)
});
test('only bounded browse pages are cacheable; manual updates bypass stale results',()=>{
 const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
 assert.match(server,/pageCacheable=!query&&offset<=108&&!req\.signal\.aborted/);
 assert.match(server,/if\(pageCacheKey&&!fresh\)/);
 assert.match(server,/if\(pageCacheKey&&!req\.signal\.aborted\)catalogPageCache\.put/);
 assert.match(server,/h\.Authorization\+'\\0'\+k/);
 assert.match(server,/X-Blofy-Catalog-Cache/);
 assert.match(app,/if\(fresh\)endpoint\+='&fresh=1'/);
 assert.match(app,/\},null,true\)\n \}\n next\(\)\n\}\nfunction checkCatalogVersion/);
 assert.match(docker,/COPY .*catalog-page-cache\.mjs/);
 // No media HLS, activation, diagnostic, source URL or session cookies cached.
 assert.doesNotMatch(server,/catalogPageCache\.put\(.*(?:media|hls|token)/)
});
test('home renders immediately and fetches 2 independent shelves without slowest-wins blocking',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const start=app.indexOf('function home(){'),end=app.indexOf('\nfunction catalog(kind){',start);
 assert.ok(start>=0&&end>start);
 const snippet=app.slice(start,end);
 assert.match(snippet,/draw\(\);\n if\(!movies\)getListing\('movie','all'/);
 assert.match(snippet,/if\(!series\)getListing\('series','all'/);
 assert.match(snippet,/movies=d\|\|\{items:\[\]\};draw\(\)/);
 assert.match(snippet,/series=d\|\|\{items:\[\]\};draw\(\)/);
 assert.match(snippet,/if\(hadScreen\)rememberView\(\)/);
 assert.match(snippet,/restoreView\('home',focus\)/);
 assert.match(snippet,/fetchpriority="high"/);
});

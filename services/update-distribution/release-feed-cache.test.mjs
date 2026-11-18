import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  createReleaseFeedCache, PUBLIC_STREAM_RELEASE_CACHE_CONTROL
} from './release-feed-cache.mjs';

test('one DB read for a simultaneous burst of public updater calls', async () => {
  let t=1_000, reads=0, finish;
  const feed=createReleaseFeedCache({ttlMs:10_000,now:()=>t});
  const load=()=>{
    reads++;
    return new Promise(resolve=>{finish=resolve});
  };
  const requests=Array.from({length:200},()=>feed.get(load));
  assert.equal(reads,1,'only one load starts before any response completes');
  const release={ok:true,versionCode:56,downloadUrl:'https://updates.blofyplayer.com/files/releases/release-56.apk'};
  finish(release);
  const result=await Promise.all(requests);
  assert.equal(reads,1);
  assert.ok(result.every(x=>x===release));
  t+=9_000;
  assert.deepEqual(await feed.get(load),release);
  assert.equal(reads,1);
});

test('refreshes after TTL; admin unpublish null invalidates verified older release',async()=>{
  let t=2_000,reads=0;
  const feed=createReleaseFeedCache({ttlMs:10_000,now:()=>t});
  const first={versionCode:56};
  assert.equal(await feed.get(async()=>{reads++;return first;}),first);
  t+=10_001;
  assert.equal(await feed.get(async()=>{reads++;return null;}),null);
  assert.equal(reads,2);
  t+=12_000;
  await assert.rejects(feed.get(async()=>{throw Error('db_offline')}),/db_offline/);
  t+=1_000;
  const after={versionCode:57};
  assert.equal(await feed.get(async()=>{reads++;return after;}),after);
});

test('database errors briefly reuse only the last verified positive release, never invent the first',async()=>{
  let t=5_000,reads=0;
  const feed=createReleaseFeedCache({ttlMs:8_000,staleIfErrorMs:30_000,now:()=>t});
  await assert.rejects(feed.get(async()=>{throw Error('offline')}),/offline/);
  const signed={versionName:'56.0',apk:'owner-signed'};
  assert.equal(await feed.get(async()=>{reads++;return signed;}),signed);
  t+=8_001;
  assert.equal(await feed.get(async()=>{reads++;throw Error('dns_down')}),signed);
  assert.equal(reads,2);
  t+=1_000;
  assert.equal(await feed.get(async()=>{reads++;throw Error('offline')}),signed);
  assert.equal(reads,2,'stale fallback throttles repeated failures briefly');
  t+=30_000;
  await assert.rejects(feed.get(async()=>{reads++;throw Error('still_offline')}),/still_offline/);
});

test('cache invalidation and bounded limits',async()=>{
  let t=10;const feed=createReleaseFeedCache({ttlMs:1_000,staleIfErrorMs:10_000,now:()=>t});
  await feed.get(async()=>({versionCode:1}));
  feed.clear();
  await assert.rejects(feed.get(async()=>{throw Error('failed')}),/failed/);
  assert.throws(()=>createReleaseFeedCache({ttlMs:0}),/invalid_release_feed_cache_configuration/);
  assert.throws(()=>createReleaseFeedCache({staleIfErrorMs:999}),/invalid_release_feed_cache_configuration/);
  assert.throws(()=>createReleaseFeedCache({ttlMs:Infinity}),/invalid_release_feed_cache_configuration/);
  await assert.rejects(feed.get(null),/invalid_release_feed_loader/);
});

test('cache response directives are scoped to anonymous updater feed only',async()=>{
  const src=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
  assert.match(src,/const publicStreamReleaseFeed = createReleaseFeedCache\(\)/);
  assert.match(src,/publicStreamReleaseFeed\.get\(/);
  assert.match(src,/PUBLIC_STREAM_RELEASE_CACHE_CONTROL/);
  assert.match(src,/cache-control': 'no-store, max-age=0'/);
  assert.match(PUBLIC_STREAM_RELEASE_CACHE_CONTROL,/s-maxage=15/);
  assert.match(PUBLIC_STREAM_RELEASE_CACHE_CONTROL,/stale-if-error=120/);
  assert.match(PUBLIC_STREAM_RELEASE_CACHE_CONTROL,/max-age=0/);
  assert.ok(src.includes("pathname === '/stream/release.json'"));
});

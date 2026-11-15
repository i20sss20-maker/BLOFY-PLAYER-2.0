import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPrivateTimelineClipCache} from '../src/private-timeline-cache.mjs';
const MiB=1024*1024;
const runId='licensed_movie_timeline_001';
const sha='a'.repeat(64);
const base={mediaKind:'movie',runId,sha256:sha,
 originalFileBytes:2934023949};
function selection(n){return {...base,segment:n}}
function clip(n,length=4096){const bytes=Buffer.alloc(length);
 bytes.write('ftyp',4,'ascii');
 return {ok:true,mediaKind:'movie',runId,bytes,
   originalFileBytes:base.originalFileBytes,
   segmentIndex:n,startSeconds:n*30,
   segmentDurationSeconds:30};
}
test('owner cache serves only the exact verified file SHA and segment',()=>{
 let clock=100;
 const cache=createPrivateTimelineClipCache({clock:()=>clock,ttlMs:5000});
 assert.equal(cache.put(selection(2),clip(2)),true);
 const got=cache.get(selection(2));
 assert.equal(got?.segmentIndex,2);
 assert.equal(got?.cachedInPrivateMemory,true);
 assert.equal(cache.get({...selection(2),sha256:'b'.repeat(64)}),null);
 assert.equal(cache.get({...selection(2),runId:'other_verified_movie'}),null);
 assert.equal(cache.get(selection(3)),null);
 clock=5100;assert.equal(cache.get(selection(2)),null);
 assert.equal(cache.status().bytes,0);
});
test('owner cache is bounded to two clips and rejects fabricated MP4 metadata',()=>{
 const c=createPrivateTimelineClipCache({maxEntries:2,
  maxBytes:20*MiB,ttlMs:2000});
 assert.equal(c.put(selection(0),clip(0,9*MiB)),true);
 assert.equal(c.put(selection(1),clip(1,9*MiB)),true);
 assert.equal(c.put(selection(2),clip(2,9*MiB)),true);
 assert.equal(c.get(selection(0)),null,'oldest was evicted');
 assert.ok(c.get(selection(1)));
 assert.ok(c.get(selection(2)));
 assert.ok(c.status().bytes<=20*MiB);
 assert.equal(c.put(selection(4),{...clip(4),startSeconds:0}),false);
 assert.equal(c.put(selection(5),{...clip(5),originalFileBytes:12}),false);
 assert.equal(c.put(selection(6),{...clip(6),mediaKind:'episode'}),false);
 assert.equal(c.put(selection(7),{...clip(7),runId:'other_movie'}),false);
 assert.equal(c.put(selection(8),clip(8,19*MiB)),false);
 assert.equal(c.put({...selection(9),sha256:'bad'},clip(9)),false);
});
test('Hub checks rights and exact verified run before reusing cached MP4',async()=>{
 const src=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 const start=src.indexOf('  const timelineRoute=');
 const end=src.indexOf('  // Short MP4 preview exclusively',start);
 assert.ok(start>0&&end>start);
 const route=src.slice(start,end);
 for(const required of [
  "BLOFY_CONTENT_HUB_WEBSITE_TIMELINE_ENABLED",
  "BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED",
  "BLOFY_CONTENT_HUB_EPISODE_RIGHTS_CONFIRMED",
  "runId!==String(kind",
  "getVerifiedChunkedObject",
  "getVerifiedEpisodeObject",
  "timelineClipCache.get(cacheSelection)",
  "timelineClipCache.put(cacheSelection,segment)",
  "private-verified-s3-timeline"
 ])assert.ok(route.includes(required),required);
 assert.ok(route.indexOf('BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED')<
  route.indexOf('timelineClipCache.get(cacheSelection)'));
});

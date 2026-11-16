import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readMirrorHistory,summarizeMirrorHistory}
 from '../src/mirror-transfer-history.mjs';

const id='mirror_'+'a'.repeat(32);
const now=new Date('2026-11-16T01:00:00Z');
test('only mirror checkpoint runs count, not old pilots or season queue',()=>{
 const response=summarizeMirrorHistory([
  {runId:id,state:'verified',expectedBytes:8388608,
   bytesCopied:8388608,partsCopied:1,mediaKind:'movie',
   startedAt:now,finishedAt:now},
  {runId:'movie_pilot_123456789',state:'failed',
   expectedBytes:10,bytesCopied:2,partsCopied:1},
  {runId:'season_e123',state:'verified',
   expectedBytes:25,bytesCopied:25,partsCopied:1},
  {runId:'mirror_'+'b'.repeat(32),state:'failed',mediaKind:'episode',
   expectedBytes:16777216,bytesCopied:8388608,partsCopied:1,
   code:'mirror_source_validator_changed',startedAt:now}
 ]);
 assert.equal(response.ok,true);
 assert.equal(response.itemCount,2);
 assert.equal(response.counts.verified,1);
 assert.equal(response.counts.failed,1);
 assert.equal(response.verifiedBytes,8388608);
 assert.equal(response.storedBytes,16777216);
 assert.equal(response.providerRequests,0);
 assert.equal(response.mediaBytesTransferred,0);
 assert.equal(response.customerCutover,false);
 assert.equal(response.physicalS3CurrentlyChecked,false);
 assert.equal(response.items[1].failureCode,'mirror_source_validator_changed');
});
test('private DB-only history never reaches the original Xtream origin',async()=>{
 let movies=0,episodes=0;
 const out=await readMirrorHistory({
  listChunkedRuns:async({limit})=>{
   assert.equal(limit,50);movies++;
   return [{runId:id,state:'staged',expectedBytes:8388608,
    bytesCopied:4194304,partsCopied:1,startedAt:now}];
  },
  listEpisodeRuns:async({limit})=>{
   assert.equal(limit,25);episodes++;
   return [];
  }
 });
 assert.equal(out.ok,true);
 assert.equal(out.itemCount,1);
 assert.equal(out.items[0].percent,50);
 assert.equal(out.items[0].kind,'movie');
 assert.equal(movies,1);assert.equal(episodes,1);
});
test('missing PG tables fail safely and response never shows S3 object keys',async()=>{
 const result=await readMirrorHistory({listChunkedRuns:async()=>{
  throw Error('database unavailable');
 },listEpisodeRuns:async()=>[]});
 assert.equal(result.ok,false);
 assert.equal(result.code,'mirror_history_unavailable');
 assert.equal(result.customerCutover,false);
 const sanitized=summarizeMirrorHistory([{
  runId:id,mediaKind:'movie',state:'verified',expectedBytes:8,
  bytesCopied:8,key:'saleh/movie/secret/private_file.mkv',
  credentials:'password'
 }]);
 assert.ok(!JSON.stringify(sanitized).includes('password'));
 assert.ok(!JSON.stringify(sanitized).includes('private_file.mkv'));
});
test('history Hub route is token protected and owner-action gated',async()=>{
 const src=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.ok(src.includes("path==='/internal/mirror/copy/history'"));
 assert.ok(src.includes("'private-mirror-copy-history'"));
 assert.ok(src.includes('readMirrorHistory(lease,{limit:24})'));
});

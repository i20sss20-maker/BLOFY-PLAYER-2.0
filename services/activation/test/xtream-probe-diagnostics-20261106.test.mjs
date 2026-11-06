import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamEpisodePlaybackCandidates,xtreamEpisodeSamples,xtreamProbeMessage}
  from '../src/xtream-series-probe.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('episode candidates cover multiple seasons and end-of-season files rather than only episode one',()=>{
  const payload={episodes:{
    '1':[{id:10,container_extension:'mp4'},{id:11,container_extension:'mkv'},
      {id:12,container_extension:'ts'},{id:13,container_extension:'mp4'}],
    '2':[{id:20,container_extension:'mkv'},{id:21,container_extension:'mp4'}]
  }};
  assert.deepEqual(xtreamEpisodePlaybackCandidates(payload,3),[
    {id:'10',extension:'mp4'},{id:'20',extension:'mkv'},{id:'13',extension:'mp4'}
  ]);
  assert.deepEqual(xtreamEpisodePlaybackCandidates(payload,0),[]);
  // The existing metadata counter and first-two sample API is backwards compatible.
  assert.equal(xtreamEpisodeSamples(payload,2).episodeCount,6);
  assert.deepEqual(xtreamEpisodeSamples(payload,2).samples,[
    {id:'10',extension:'mp4'},{id:'11',extension:'mkv'}
  ]);
});

test('candidate collection excludes unsafe ids and normalizes untrusted file extensions',()=>{
  const payload={episodes:{'1':[{id:'../bad',container_extension:'mp4'},
    {id:200,container_extension:'foo/bar'},{id:201,container_extension:'.mkv'}]}};
  const rows=xtreamEpisodePlaybackCandidates(payload,5);
  assert.deepEqual(rows,[{id:'201',extension:'mkv'},{id:'200',extension:'mp4'}]);
  assert.equal(xtreamEpisodePlaybackCandidates(null).length,0);
});

test('source diagnostics accurately explain nonstandard 456 without claiming provider root cause',()=>{
  const message=xtreamProbeMessage({ok:false,checks:[{httpStatus:456,password:'no-leak'}]},'episode');
  assert.match(message,/HTTP 456/);
  assert.match(message,/غير قياسي/);
  assert.doesNotMatch(message,/no-leak/);
  const partial=xtreamProbeMessage({ok:true,checks:[{ok:false,httpStatus:404},{ok:true,httpStatus:206}]},'episode');
  assert.match(partial,/تعثر 1/);
  assert.match(partial,/HTTP 206/);
});

test('live and movie source sampling is larger and the episode probe retries safe candidates',async()=>{
  const source=await read('src/xtream-admin-hook.mjs');
  assert.match(source,/xtreamEpisodePlaybackCandidates\(payload,3\)/);
  assert.match(source,/ORDER BY name ASC LIMIT 4/);
  assert.match(source,/\[401,403,456\]\.includes\(playback\.httpStatus\)/);
  assert.match(source,/shouldRetryXtreamWithoutRange/);
});

test('gateway manual diagnostics use the same first-byte Range fallback as real playback',async()=>{
  const source=await read('src/xtream-gateway-hook.mjs');
  const start=source.indexOf('async function probeGatewayMedia(');
  const end=source.indexOf('function playerServerInfo(',start);
  const piece=source.slice(start,end);
  assert.match(piece,/shouldRetryXtreamWithoutRange/);
  assert.match(piece,/delete probeHeaders\.range/);
  assert.match(piece,/rangeFallbackUsed/);
  assert.doesNotMatch(piece,/\/video\//);
});

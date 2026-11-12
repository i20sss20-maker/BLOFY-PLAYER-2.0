import test from 'node:test';
import assert from 'node:assert/strict';
import {xtreamEpisodeSamples,xtreamEpisodePlaybackCandidates}
  from '../src/xtream-series-probe.mjs';
import {collectSourceEpisodes} from '../src/xtream-series-resolver.mjs';

test('wrapped seasons and alternate episode identifiers match playable gateway records',()=>{
  const payload={episodes:{
    '1':{episodes:[
      {id:0,episode_id:'551',container_extension:'.mkv',direct_source:'https://secret.example/u/p'},
      {stream_id:552,container_extension:'mp4'}
    ]},
    '2':{episodes:[{id:'553',container_extension:'avi'}]}
  }};
  const mapped=collectSourceEpisodes(payload.episodes);
  assert.deepEqual(mapped.map(x=>x.sourceId),['551','552','553']);
  const samples=xtreamEpisodeSamples(payload,6);
  assert.equal(samples.seasonCount,2);
  assert.equal(samples.episodeCount,3);
  assert.deepEqual(samples.samples.map(x=>x.id),mapped.map(x=>x.sourceId));
  assert.equal(samples.samples[0].extension,'mkv');
  const playback=xtreamEpisodePlaybackCandidates(payload,3,{withPositions:true});
  assert.equal(playback.length,3);
  assert.deepEqual(playback.map(x=>x.id),['551','553','552']);
  assert.deepEqual(playback.map(x=>x.seasonNumber),[1,2,1]);
  assert.equal(playback[0].directSourceAdvertised,true);
  assert.doesNotMatch(JSON.stringify(playback),/secret.example|\/u\/p/);
});
test('flat episode arrays respect explicit seasons and skip nonexistent or unsafe IDs',()=>{
  const payload={episodes:[
    {id:0,episode_id:'761',season:3,episode_num:2},
    {id:'762',season_number:4,episode_num:1},
    {id:'../unsafe',episode_id:0,season:4},
    {id:0,stream_id:0,season:5},
    {id:'761',season:3}
  ]};
  const a=xtreamEpisodeSamples(payload,6);
  assert.equal(a.seasonCount,3);
  assert.equal(a.episodeCount,2);
  assert.deepEqual(a.samples.map(x=>x.id),['761','762']);
  const candidates=xtreamEpisodePlaybackCandidates(payload,6,{withPositions:true});
  assert.deepEqual(candidates.map(x=>[x.id,x.seasonNumber,x.episodeNumber]),
    [['761',3,2],['762',4,1]]);
  assert.deepEqual(xtreamEpisodePlaybackCandidates({episodes:{}},3),[]);
});
test('duplicate provider episode IDs are only probed once across seasons',()=>{
  const d={episodes:{'1':[{id:55},{id:56}],'2':[{id:55},{id:57}]}};
  assert.equal(xtreamEpisodeSamples(d).episodeCount,3);
  const result=xtreamEpisodePlaybackCandidates(d,6);
  assert.equal(new Set(result.map(x=>x.id)).size,result.length);
  assert.ok(result.length<=3);
});

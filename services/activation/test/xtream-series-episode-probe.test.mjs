import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamEpisodeSamples,xtreamEpisodePlaybackCandidates,xtreamProbeMessage} from '../src/xtream-series-probe.mjs';
import {controlPage,CONTROL_PATH} from '../src/xtream-native-controls.mjs';

const read = path => readFile(new URL('../'+path,import.meta.url),'utf8');

test('series info extracts real season/episode identifiers without credentials',()=>{
  const payload={info:{name:'Demo'},episodes:{
    '1':[{id:1921,episode_num:1,container_extension:'mp4'},{id:'1922',container_extension:'mkv'}],
    '2':[{id:'bad/unsafe',container_extension:'avi'},{id:'1923',container_extension:'.ts'}]
  }};
  const info=xtreamEpisodeSamples(payload,2);
  assert.equal(info.seasonCount,2);
  assert.equal(info.episodeCount,3);
  assert.deepEqual(info.samples,[{id:'1921',extension:'mp4'},{id:'1922',extension:'mkv'}]);
  assert.ok(!JSON.stringify(info).includes('Demo'));
});

test('empty or invalid series details do not falsely claim playable episodes',()=>{
  assert.deepEqual(xtreamEpisodeSamples(null),{seasonCount:0,episodeCount:0,samples:[]});
  assert.equal(xtreamEpisodeSamples({episodes:{'1':[]}}).episodeCount,0);
  assert.equal(xtreamEpisodeSamples({episodes:[{id:555,container_extension:'foo/bar'}]}).samples[0].extension,'mp4');
  assert.equal(xtreamEpisodeSamples({episodes:{'1':[{id:'123'}]}}).samples.length,1);
});

test('operator sees real playback HTTP diagnostics instead of opaque playback_failed',()=>{
  assert.match(xtreamProbeMessage({ok:false,checks:[{httpStatus:403}]},'movie'),/HTTP 403/);
  assert.match(xtreamProbeMessage({ok:false,checks:[{httpStatus:404}]},'episode'),/HTTP 404/);
  assert.match(xtreamProbeMessage({ok:false,checks:[{error:'xtream_http_404'}]},'series'),/HTTP 404/);
  assert.match(xtreamProbeMessage({ok:false,reason:'no_imported_items',checks:[]},'series'),/لا توجد عناصر/);
  assert.match(xtreamProbeMessage({ok:true,checks:[{ok:true,httpStatus:206,episodeCount:15}]},'episode'),/15/);
  const result=xtreamProbeMessage({ok:false,checks:[{httpStatus:403,password:'SECRET'}]},'movie');
  assert.ok(!result.includes('SECRET'));
});

test('source-native form includes separate series API and playable episode tests',()=>{
  const id='1195bcd7-44ba-4710-af22-cb4237dc4aa1';
  const page=controlPage({items:[{id,name:'Test',baseUrl:'https://example.org',
    counts:{live:1,movie:2,series:3,total:6},enabled:true,publishCatalog:true}]});
  for(const name of ['probe-live','probe-movie','probe-series','probe-episode'])
    assert.ok(page.includes(CONTROL_PATH+'/'+id+'/'+name),name);
  const failure=controlPage({items:[],error:'probe:فشل فحص الفيلم: HTTP 403'});
  assert.match(failure,/نتيجة الفحص/);
  assert.match(failure,/HTTP 403/);
  assert.doesNotMatch(failure,/playback_failed/);
});

test('production source probing uses actual get_series_info and first episode bytes with safe routes',async()=>{
  const [backend,ui]=await Promise.all([read('src/xtream-admin-hook.mjs'),read('web/sources-admin.js')]);
  const start=backend.indexOf('async function probeXtreamEpisodeMedia(');
  const end=backend.indexOf('// Short, explicit playback probe:',start);
  const series=backend.slice(start,end);
  assert.match(series,/get_series_info/);
  assert.match(series,/series_id:String\(series.source_id\)/);
  assert.match(series,/xtreamEpisodeSamples\(payload,2\)/);
  assert.match(series,/path=\['series',creds.username,creds.password,String\(episode.id\)\]/);
  assert.match(series,/reader\.read\(\)/);
  assert.match(series,/await assertPublicXtreamUrl\(target.origin\)/);
  assert.match(series,/9500/);
  assert.match(series,/series_response_too_large/);
  assert.match(series,/ORDER BY name ASC LIMIT \$2/);
  assert.ok(backend.includes("'probe-series','probe-episode'"));
  assert.match(backend,/probe-live\|probe-movie\|probe-series\|probe-episode/);
  assert.match(backend,/xtreamProbeMessage\(result,mediaType\)/);
  assert.match(ui,/\['اختبار بيانات مسلسل', 'probe-series'/);
  assert.match(ui,/\['اختبار تشغيل حلقة', 'probe-episode'/);
  assert.match(ui,/code\.startsWith\('xtream_http_'\)/);
});

test('movie, channel and episode probes never return raw credential-bearing network errors',async()=>{
  const admin=await read('src/xtream-admin-hook.mjs');
  const start=admin.indexOf('async function probeXtreamEpisodeMedia(');
  const end=admin.indexOf('async function fetchAccount(',start);
  const probe=admin.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.doesNotMatch(probe,/errorCode=controller\.signal\.aborted\?'timeout':redactXtreamError\(error\)/);
  assert.match(probe,/xtream_private_host_blocked/);
  assert.match(probe,/upstream_unreachable/);
  assert.doesNotMatch(probe,/console\.warn\([^\n]*target\.href/);
});

test('failed episode candidates carry safe season/episode positions, never a media URL',()=>{
 const source={episodes:{
  '1':[{id:'101',episode_num:1,container_extension:'mkv'},
       {id:'102',episode_num:2,container_extension:'mp4'},
       {id:'103',episode_num:3,container_extension:'mp4'}],
  '2':[{id:'201',episode_num:1,container_extension:'mp4'}]
 }};
 const found=xtreamEpisodePlaybackCandidates(source,3,{withPositions:true});
 assert.deepEqual(found.map(x=>[x.id,x.seasonNumber,x.episodeNumber]),
   [['101',1,1],['201',2,1],['103',1,3]]);
 assert.ok(found.every(x=>!('sourceUrl' in x)&&!('password' in x)));
 assert.equal(xtreamEpisodePlaybackCandidates({episodes:{
  'Season one':[{id:'7',episode_num:0}] }},1,{withPositions:true})[0].seasonNumber,null);
});
test('admin episode sample title adds position without exposing provider identifiers',async()=>{
 const s=await read('src/xtream-admin-hook.mjs');
 const a=s.indexOf('async function probeXtreamSeries(');
 const b=s.indexOf('async function persistSourceMediaProbe(',a);
 const block=s.slice(a,b);
 assert.match(block,/episode\.seasonNumber/);
 assert.match(block,/episode\.episodeNumber/);
 assert.match(block,/title:cleanText\(series.name,120\)\+position/);
});

test('episode candidate can report direct_source presence without exposing signed provider URL',()=>{
 const direct='https://cdn.example/file.mkv?token=SUPERSECRET';
 const rows=xtreamEpisodePlaybackCandidates({episodes:{'1':[
   {id:'999',container_extension:'mkv',direct_source:direct}
 ]}},1,{withPositions:true});
 assert.equal(rows[0].directSourceAdvertised,true);
 assert.doesNotMatch(JSON.stringify(rows),/SUPERSECRET|cdn\.example|file\.mkv|direct_source/);
 const legacy=xtreamEpisodePlaybackCandidates({episodes:{'1':[
   {id:'999',container_extension:'mkv',direct_source:direct}
 ]}},1);
 assert.ok(!('directSourceAdvertised' in legacy[0]));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sameEpisodeContainerCandidates} from '../src/xtream-episode-repair.mjs';
import {
  authoritativeXtreamMediaCandidates,
  providerHasExactXtreamMediaItem
} from '../src/xtream-authoritative-media.mjs';

async function loadRealLookup({payload,workingExtension='mkv',sourceId='207458',kind='movie'}={}){
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const first=src.indexOf('async function verifiedOfficialMediaAlternative(');
  const last=src.indexOf('// The only identifiers revealed',first);
  assert.ok(first>=0&&last>first);
  const tried=[];
  const mocks={
    fetchUpstreamApi:async(row,action,params)=>{
      assert.equal(action,kind==='movie'?'get_vod_info':'get_series_info');
      assert.equal(params[kind==='movie'?'vod_id':'series_id'],kind==='movie'?sourceId:'10007');
      return payload;
    },
    providerHasExactXtreamMediaItem,
    authoritativeXtreamMediaCandidates,
    sameEpisodeContainerCandidates,
    mediaUpstreamUrl:(row,type,id,ext)=>{
      assert.equal(type,kind);
      assert.equal(id,sourceId,'must never change the episode or film ID');
      return new URL('https://example.test/'+type+'/'+id+'.'+ext);
    },
    confirmProviderMediaUrl:async url=>{
      tried.push(url.toString());
      return url.pathname.endsWith('.'+workingExtension);
    },
    issuanceErrorReason:()=> 'source_unreachable',
    console:{info:()=>{},warn:()=>{}}
  };
  const fn=new Function(...Object.keys(mocks),
    src.slice(first,last)+';return verifiedOfficialMediaAlternative;')(...Object.values(mocks));
  return {
    result:await fn({base_url:'https://example.test'},kind,sourceId,'mp4',{
      seriesSourceId:kind==='series'?'10007':null,
      providerPayload:kind==='series'?payload:null,
      deadline:Date.now()+20000
    }),tried
  };
}

test('movie source 207458 with stale mp4 uses verified same-ID mkv only',async()=>{
  const {result,tried}=await loadRealLookup({
    payload:{movie_data:{stream_id:207458,container_extension:'mp4'}},
    workingExtension:'mkv'
  });
  assert.equal(result?.mode,'same_id_container');
  assert.equal(result?.verified,true);
  assert.deepEqual(tried,['https://example.test/movie/207458.mkv']);
  assert.equal(result.url.toString(),tried[0]);
});

test('episode 294466 from series 10007 uses same exact ID, no different series',async()=>{
  const {result,tried}=await loadRealLookup({
    kind:'series',sourceId:'294466',
    payload:{episodes:{'1':[
      {id:'294466',episode_num:1,container_extension:'mp4'},
      {id:'294467',episode_num:2,container_extension:'mkv'}
    ]}}
  });
  assert.equal(result?.mode,'same_id_container');
  assert.equal(result.url.pathname,'/series/294466.mkv');
  assert.deepEqual(tried,['https://example.test/series/294466.mkv']);
});

test('absent or mismatched upstream IDs may never trigger a guessed file suffix',async()=>{
  assert.equal(providerHasExactXtreamMediaItem({movie_data:{}},{kind:'movie',itemId:'207458'}),false);
  assert.equal(providerHasExactXtreamMediaItem({
    movie_data:{stream_id:207459,container_extension:'mp4'}},{kind:'movie',itemId:'207458'}),false);
  assert.equal(providerHasExactXtreamMediaItem({
    episodes:{'1':[{id:294467,container_extension:'mkv'}]}},{kind:'series',itemId:'294466'}),false);
  const movie=await loadRealLookup({
    payload:{movie_data:{stream_id:207459,container_extension:'mkv'}}
  });
  assert.equal(movie.result,null);
  assert.deepEqual(movie.tried,[]);
});

test('preflight trusts already verified bytes rather than re-fetching a 404 after a 6.5s deadline',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=src.indexOf('async function probeIssuanceMedia(');
  const end=src.indexOf('// One additional, bounded check',start);
  assert.ok(start>=0&&end>start);
  let upstreamCalls=0,alternatives=0,cancels=0;
  const mocks={
    mediaUpstreamUrl:()=>new URL('https://example.test/movie/207458.mp4'),
    checkedFetch:async()=>{upstreamCalls++;return {ok:false,status:404,body:{cancel:async()=>{cancels++}}};},
    shouldRetryXtreamWithoutRange:()=>false,
    verifiedHybridM3uFallback:async()=>null,
    verifiedOfficialMediaAlternative:async()=>{
      alternatives++;
      return {url:new URL('https://example.test/movie/207458.mkv'),
        verified:true,mode:'same_id_container'};
    },
    issuanceErrorReason:()=> 'source_unreachable',
    inspectXtreamMediaChunk:()=>{throw Error('should never re-read first 404 media')},
    Buffer,
    AbortSignal
  };
  const fn=new Function(...Object.keys(mocks),
    src.slice(start,end)+';return probeIssuanceMedia;')(...Object.values(mocks));
  const result=await fn({},'movie','207458','mp4',Date.now()+25000);
  assert.deepEqual(result,{
    kind:'movie',ok:true,reason:null,format:'provider_verified',
    repaired:true,recoveryMode:'same_id_container'
  });
  assert.equal(upstreamCalls,1);
  assert.equal(alternatives,1);
  assert.equal(cancels,1);
});

test('preflight does not greenlight 404 unless fallback was verified',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=src.indexOf('async function probeIssuanceMedia(');
  const end=src.indexOf('// One additional, bounded check',start);
  let upstreamCalls=0;
  const mocks={
    mediaUpstreamUrl:()=>new URL('https://example.test/movie/207458.mp4'),
    checkedFetch:async()=>{upstreamCalls++;return {ok:false,status:404,body:{cancel:async()=>{}}};},
    shouldRetryXtreamWithoutRange:()=>false,
    verifiedHybridM3uFallback:async()=>null,
    verifiedOfficialMediaAlternative:async()=>null,
    issuanceErrorReason:()=> 'source_unreachable',
    inspectXtreamMediaChunk:()=>{throw Error('must not validate 404 as media')},
    Buffer,
    AbortSignal
  };
  const fn=new Function(...Object.keys(mocks),
    src.slice(start,end)+';return probeIssuanceMedia;')(...Object.values(mocks));
  const result=await fn({},'movie','207458','mp4',Date.now()+25000);
  assert.equal(result.ok,false);
  assert.equal(result.httpStatus,404);
  assert.equal(upstreamCalls,1);
});

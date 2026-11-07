import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHybridM3uMediaUrl,verifiedHybridRow} from '../src/xtream-hybrid-m3u.mjs';

const source={
  server_id:'11111111-1111-4111-8111-111111111111',
  m3u_index_generation:'22222222-2222-4222-8222-222222222222',
  base_url:'http://provider.example:8080'
};
const url='http://provider.example:8080/movie/u/p/207458.mkv';
async function instantiate({row,probeStatus,verified=false}={}){
  const code=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=code.indexOf('async function verifiedHybridM3uFallback(');
  const end=code.indexOf('async function verifiedOfficialMediaAlternative(',start);
  assert.ok(start>=0&&end>start);
  const mocks={
    pool:{query:async()=>({rows:row===undefined?[{
      generation:source.m3u_index_generation,
      stream_url_secret:'encrypted',
      ambiguous:false
    }]:row===null?[]:[row]})},
    verifiedHybridRow,parseHybridM3uMediaUrl,
    decryptServerCredentials:()=>({username:'u',password:'p'}),
    decryptXtreamSecret:()=>url,KEY_HEX:'cc'.repeat(32),
    confirmProviderMediaUrl:async(mediaUrl,{diagnostic})=>{
      assert.equal(mediaUrl.toString(),url);
      if(diagnostic)diagnostic.status=probeStatus||'verified';
      return verified;
    },
    console:{info:()=>{}}
  };
  return new Function(...Object.keys(mocks),
    code.slice(start,end)+';return verifiedHybridM3uFallback;')(...Object.values(mocks));
}

test('missing M3U index reports not ready, missing exact movie reports not in playlist',async()=>{
  const fn=await instantiate({row:null});
  const first={};
  assert.equal(await fn({...source,m3u_index_generation:null},'movie','207458',{diagnostic:first}),null);
  assert.equal(first.status,'index_not_ready');
  const second={};
  assert.equal(await fn(source,'movie','207458',{diagnostic:second}),null);
  assert.equal(second.status,'id_not_in_m3u');
});

test('conflicting M3U links never choose one without verified exact identity',async()=>{
  const fn=await instantiate({row:{generation:source.m3u_index_generation,
    stream_url_secret:'encrypted',ambiguous:true}});
  const diagnostic={};
  assert.equal(await fn(source,'movie','207458',{diagnostic}),null);
  assert.equal(diagnostic.status,'multiple_conflicting_m3u_links');
});

test('found linked M3U movie that itself returns source 404 is still a failed 404',async()=>{
  const fn=await instantiate({probeStatus:'provider_404'});
  const diagnostic={};
  assert.equal(await fn(source,'movie','207458',{diagnostic}),null);
  assert.equal(diagnostic.status,'provider_404');
  assert.equal(JSON.stringify(diagnostic).includes('provider.example'),false);
});

test('real verified first video bytes alone are sufficient to classify M3U recovery',async()=>{
  const fn=await instantiate({probeStatus:'verified',verified:true});
  const diagnostic={};
  const result=await fn(source,'movie','207458',{diagnostic});
  assert.equal(diagnostic.status,'verified');
  assert.equal(result.mode,'m3u');
  assert.equal(result.verified,true);
});

test('pre-issuance 404 includes sanitized M3U reason while still blocking account creation',async()=>{
  const code=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const start=code.indexOf('async function probeIssuanceMedia(');
  const end=code.indexOf('// One additional, bounded check',start);
  const mocks={
    mediaUpstreamUrl:()=>new URL('https://example.invalid/movie/207458.mp4'),
    checkedFetch:async()=>({ok:false,status:404,body:{cancel:async()=>{}}}),
    shouldRetryXtreamWithoutRange:()=>false,
    verifiedHybridM3uFallback:async(row,kind,id,{diagnostic})=>{
      diagnostic.status='id_not_in_m3u';return null;
    },
    verifiedOfficialMediaAlternative:async()=>null,
    inspectXtreamMediaChunk:()=>{throw Error('not video')},
    issuanceErrorReason:()=> 'source_unreachable',
    AbortSignal,Buffer
  };
  const fn=new Function(...Object.keys(mocks),
    code.slice(start,end)+';return probeIssuanceMedia;')(...Object.values(mocks));
  const result=await fn({},'movie','207458','mp4',Date.now()+12000);
  assert.equal(result.ok,false);
  assert.equal(result.httpStatus,404);
  assert.equal(result.m3uRecoveryStatus,'id_not_in_m3u');
});

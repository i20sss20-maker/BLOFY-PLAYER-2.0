import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  authorizedXtreamDirectUrl,
  authoritativeXtreamMediaCandidates
} from '../src/xtream-authoritative-media.mjs';

const base='http://provider.example:8080';
const options={kind:'movie',itemId:'710997',baseUrl:base,currentExtension:'mp4'};

test('only the actual movie from get_vod_info may supply a fallback media URL',()=>{
  const info={movie_data:{stream_id:710997,container_extension:'mkv',
    direct_source:'https://cdn.provider.example/video/movie710997.mkv?token=once'}};
  assert.deepEqual(authoritativeXtreamMediaCandidates(info,options),[
    {kind:'provider_direct',url:'https://cdn.provider.example/video/movie710997.mkv?token=once'},
    {kind:'provider_extension',extension:'mkv'}
  ]);
  assert.deepEqual(authoritativeXtreamMediaCandidates({movie_data:{...info.movie_data,stream_id:123}},options),[]);
  assert.deepEqual(authoritativeXtreamMediaCandidates({movie_data:{}},options),[]);
});

test('episode candidates must match an exact original episode ID, never another season or item',()=>{
  const data={episodes:{'1':[
    {id:'415',container_extension:'mp4',direct_source:'http://provider.example:8080/series/415.mp4'},
    {id:'416',container_extension:'mkv',direct_source:'https://cdn.provider.example/416.mkv'}]}};
  const correct=authoritativeXtreamMediaCandidates(data,{
    kind:'series',itemId:'415',baseUrl:base,currentExtension:'mp4'});
  assert.deepEqual(correct,[{kind:'provider_direct',url:'http://provider.example:8080/series/415.mp4'}]);
  assert.deepEqual(authoritativeXtreamMediaCandidates(data,{
    kind:'series',itemId:'419',baseUrl:base,currentExtension:'mp4'}),[]);
  assert.deepEqual(authoritativeXtreamMediaCandidates({
    episodes:{'1':[data.episodes['1'][0]],'2':[data.episodes['1'][0]]}},{
      kind:'series',itemId:'415',baseUrl:base,currentExtension:'mp4'}),[]);
});

test('source API cannot induce plaintext cross-origin, redirects, private loopbacks or credential leaks',()=>{
  const rejects=[
    'ftp://cdn.example/video','file:///etc/passwd','http://external.example/stream',
    'http://localhost:8080/stream','https://metadata.local/stream',
    'http://user:pass@provider.example:8080/movie/710997.mp4',
    'https://evil.example/stream#fragment','https://evil.example:443/path'.repeat(200)
  ];
  for(const url of rejects)assert.equal(authorizedXtreamDirectUrl(url,base),null,url.slice(0,120));
  assert.equal(authorizedXtreamDirectUrl('http://provider.example:8080/stream',base),
    'http://provider.example:8080/stream');
  assert.equal(authorizedXtreamDirectUrl('https://cdn.example/stream',base),
    'https://cdn.example/stream');
  const invalid={movie_data:{stream_id:710997,container_extension:'../../.exe',
    direct_source:'http://different.example/video'}};
  assert.deepEqual(authoritativeXtreamMediaCandidates(invalid,options),[]);
});

test('all actual fallback probes use checked public-URL fetch and validate real media before relay',async()=>{
  const hook=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const lookup=hook.slice(hook.indexOf('async function verifiedOfficialMediaAlternative('),
    hook.indexOf('async function preflightSource('));
  const verifier=hook.slice(hook.indexOf('async function confirmProviderMediaUrl('),
    hook.indexOf('async function verifiedOfficialMediaAlternative('));
  assert.match(lookup,/authoritativeXtreamMediaCandidates\(payload/);
  assert.match(lookup,/get_vod_info/);
  assert.match(lookup,/get_series_info/);
  assert.match(lookup,/confirmProviderMediaUrl\(url,\{deadline\}\)/);
  assert.match(verifier,/checkedFetch\(url,\{method:'GET',headers,signal\}\)/);
  assert.match(verifier,/inspection.valid&&inspection.format!=='unknown'/);
  const preflight=hook.slice(hook.indexOf('async function probeIssuanceMedia('),
    hook.indexOf('async function preflightSource('));
  assert.match(preflight,/response.status===404&&kind!=='live'/);
  assert.match(preflight,/verifiedOfficialMediaAlternative\(row,kind,id,extension/);
  assert.match(hook,/verifiedOfficialMediaAlternative\(row,'movie'/);
  assert.match(hook,/verifiedOfficialMediaAlternative\(row,'series'/);
  assert.match(hook,/kind==='movie'&&response.status===404/);
  assert.match(hook,/kind==='series' && response.status===404/);
  assert.match(hook,/upstream=repaired.url\|\|mediaUpstreamUrl\(row,kind,sourceId,repaired.extension\)/);
  assert.doesNotMatch(lookup,/xtreamApiUrl\(.*get_vod_streams/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {xtreamM3uUrl,xtreamApiUrl} from '../src/xtream-core.mjs';
import {parseXtreamM3uCatalog} from '../src/xtream-m3u-catalog.mjs';

test('official get.php uses same source base path as player_api.php',()=>{
  for(const base of ['http://example.test:8080/panel','https://example.test/a/b/']){
    const api=xtreamApiUrl(base,'user','pass');
    const m3u=xtreamM3uUrl(base,'user','pass');
    assert.equal(m3u.pathname,api.pathname.replace(/player_api\.php$/,'get.php'));
    assert.equal(m3u.searchParams.get('username'),'user');
    assert.equal(m3u.searchParams.get('password'),'pass');
    assert.equal(m3u.searchParams.get('type'),'m3u_plus');
    assert.equal(m3u.searchParams.get('output'),'ts');
  }
  assert.equal(xtreamM3uUrl('http://example.test:80','a','b').pathname,'/get.php');
  assert.throws(()=>xtreamM3uUrl('file:///private','u','p'),/xtream_protocol_invalid/);
});

test('M3U catalog parser accepts configured nested paths without accepting unrelated prefixes',()=>{
  const base='http://example.test:8080/iptv/panel';
  const playlist=[
    '#EXTM3U',
    '#EXTINF:-1 group-title="Live",Nested channel',
    base+'/live/demo-user/demo-pass/21.ts',
    '#EXTINF:-1 group-title="Live",Root channel',
    'http://example.test:8080/live/demo-user/demo-pass/22.ts',
    '#EXTINF:-1 group-title="Live",Unrelated host path',
    'http://example.test:8080/other/live/demo-user/demo-pass/23.ts',
    '#EXTINF:-1 group-title="Live",Different subscriber',
    base+'/live/another-user/demo-pass/24.ts',
    '#EXTINF:-1 group-title="Films",Nested movie',
    base+'/movie/demo-user/demo-pass/77.mp4',
    '#EXTINF:-1 group-title="Series",Nested episode must not import as series',
    base+'/series/demo-user/demo-pass/99.mp4'
  ].join('\n');
  const result=parseXtreamM3uCatalog(playlist,{baseUrl:base,username:'demo-user',password:'demo-pass'});
  assert.deepEqual(result.records.live.map(i=>i.sourceId),['21','22']);
  assert.deepEqual(result.records.movie.map(i=>i.sourceId),['77']);
  assert.deepEqual(result.records.series,[]);
  assert.equal(result.categories.live.length,1);
});

test('M3U download and diagnostic share the safe path builder and release denials',async()=>{
  const a=await readFile(new URL('../src/xtream-m3u-catalog.mjs',import.meta.url),'utf8');
  const b=await readFile(new URL('../src/xtream-m3u-availability.mjs',import.meta.url),'utf8');
  assert.match(a,/const url=xtreamM3uUrl\(baseUrl,username,password\)/);
  assert.match(b,/const url=xtreamM3uUrl\(baseUrl,username,password\)/);
  assert.match(a,/await assertPublicXtreamUrl\(url\.origin\)/);
  assert.match(a,/if\(!response\.ok\)\{\s*await response\.body\?\.cancel\(\)\.catch\(\(\)=>\{\}\)/);
  assert.doesNotMatch(a,/new URL\('\/get\.php'/);
  assert.doesNotMatch(b,/new URL\('\/get\.php'/);
});

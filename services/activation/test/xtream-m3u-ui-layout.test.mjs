import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseXtreamM3uCatalog } from '../src/xtream-m3u-catalog.mjs';

const credentials={baseUrl:'https://media.example:8443',username:'subscriber',password:'test-password'};
test('imports Xtream live and movie items with stable group categories',()=>{
  const playlist=[
    '#EXTM3U',
    '#EXTINF:-1 tvg-logo="https://media.example/icon.png" tvg-id="news" group-title="News",News HD',
    'https://media.example:8443/live/subscriber/test-password/111.ts',
    '#EXTINF:-1 group-title="Cinema",Movie One',
    'https://media.example:8443/movie/subscriber/test-password/222.mp4',
    '#EXTINF:-1 group-title="Drama",Episode 1',
    'https://media.example:8443/series/subscriber/test-password/333.mkv',
    '#EXTINF:-1 group-title="Movie",Wrong account',
    'https://media.example:8443/movie/other/test-password/334.mp4',
    '#EXTINF:-1 group-title="Movie",Wrong host',
    'https://external.example/movie/subscriber/test-password/335.mp4',
    '#EXTINF:-1 group-title="Movie",Query string',
    'https://media.example:8443/movie/subscriber/test-password/336.mp4?token=hidden'
  ].join('\n');
  const result=parseXtreamM3uCatalog(playlist,credentials);
  assert.equal(result.records.live.length,1);
  assert.equal(result.records.movie.length,1);
  assert.equal(result.records.series.length,0);
  assert.equal(result.records.live[0].sourceId,'111');
  assert.equal(result.records.movie[0].sourceId,'222');
  assert.equal(result.categories.live.length,1);
  assert.equal(result.categories.live[0].name,'News');
  assert.equal(result.records.movie[0].categoryId,result.categories.movie[0].sourceCategoryId);
  assert.deepEqual(result,parseXtreamM3uCatalog(playlist,credentials));
});
test('does not accept non-playlists or attempts to inject third-party sources',()=>{
  assert.throws(()=>parseXtreamM3uCatalog('<html>Login</html>',credentials),/xtream_m3u_invalid_header/);
  const result=parseXtreamM3uCatalog('#EXTM3U\n#EXTINF:-1,Local\nhttp://127.0.0.1/live/subscriber/test-password/1.ts',credentials);
  assert.equal(result.records.live.length,0);
});
test('dashboard stylesheet cannot turn the entire main content area into a horizontal source card',async()=>{
  const css=await readFile(new URL('../web/sources-admin.css',import.meta.url),'utf8');
  const script=await readFile(new URL('../web/sources-admin.js',import.meta.url),'utf8');
  assert.match(css,/\.source-shell\s*>\s*main\.source-main\s*\{display:block!important/);
  assert.match(css,/\.source-card-main\s*\{display:flex/);
  assert.doesNotMatch(css,/\.source-main\s*\{display:flex/);
  assert.match(script,/make\('div', 'source-card-main'\)/);
});

import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {loadApprovedM3u,approvedXtreamPlaylistUrl} from '../approved-m3u-loader.mjs';
const url='https://provider.example/catalog.m3u?token=fixture',approvedOrigins=['https://provider.example'];
test('browser playlist loader fetches approved catalog with no cookies, referrer or redirects',async()=>{
 let count=0;
 const result=await loadApprovedM3u(url,{approvedOrigins,fetchImpl:async(target,init)=>{
  count++;assert.equal(target,url);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.mode,'cors');assert.equal(init.referrerPolicy,'no-referrer');
  return new Response('#EXTM3U\n#EXTINF:-1,Fixture\n/live/a.m3u8');
 }});
 assert.equal(count,1);assert.equal(result.items.length,1);assert.equal(result.items[0].url,'https://provider.example/live/a.m3u8');
});
test('unapproved origin is denied before fetching and oversized responses fail closed',async()=>{
 let count=0;
 await assert.rejects(loadApprovedM3u('https://evil.example/a',{approvedOrigins,fetchImpl:async()=>{count++;throw Error('unexpected')}}),/provider_not_approved/);
 assert.equal(count,0);
 await assert.rejects(loadApprovedM3u(url,{approvedOrigins,fetchImpl:async()=>new Response('x',{headers:{'content-length':'99999999'}})}),/playlist_too_large/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(loadApprovedM3u(url,{approvedOrigins,signal:controller.signal,fetchImpl:async()=>{throw Error('unexpected')}}),/playlist_aborted/);
});

test('external Xtream uses approved HTTPS export and correctly encodes credentials',()=>{
 const target=new URL(approvedXtreamPlaylistUrl({host:'https://provider.example',username:'a&b',password:'p+q'},approvedOrigins));
 assert.equal(target.origin,'https://provider.example');assert.equal(target.pathname,'/get.php');
 assert.equal(target.searchParams.get('username'),'a&b');assert.equal(target.searchParams.get('password'),'p+q');
 assert.equal(target.searchParams.get('output'),'m3u8');
 for(const host of ['https://evil.example','http://provider.example','https://provider.example/admin','https://provider.example/?a=1','https://user:pass@provider.example'])assert.throws(()=>approvedXtreamPlaylistUrl({host,username:'a',password:'b'},approvedOrigins));
});

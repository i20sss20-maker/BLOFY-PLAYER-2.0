import {test} from 'bun:test';
import assert from 'node:assert/strict';
import {parseApprovedM3u} from '../approved-m3u-catalog.mjs';
const baseUrl='https://provider.example/catalog.m3u',approvedOrigins=['https://provider.example','https://media.example'];
const config={baseUrl,approvedOrigins};
test('generic M3U imports groups, relative paths and quoted commas from approved origins',()=>{
 const text='\uFEFF#EXTM3U\r\n#EXTINF:-1 group-title="Sports, HD" tvg-id="fixture" tvg-logo="https://media.example/logo.png",Channel One\r\n/live/a.m3u8\r\n#EXTINF:-1 group-title="Films",Movie\r\nhttps://media.example/movie.mp4\r\n';
 const result=parseApprovedM3u(text,config);
 assert.equal(result.items.length,2);assert.equal(result.items[0].group,'Sports, HD');assert.equal(result.items[0].name,'Channel One');assert.equal(result.items[0].url,'https://provider.example/live/a.m3u8');assert.equal(result.items[1].name,'Movie');
});
test('rejects arbitrary hosts, mixed content, credentials in authority and player directives',()=>{
 const invalid=['http://provider.example/a','https://provider.example.evil.test/a','https://127.0.0.1/a','https://user:password@provider.example/a','https://provider.example:8080/a','https://provider.example/a#fragment'];
 const bad=invalid.map((url,i)=>'#EXTINF:-1,Fixture '+i+'\n'+url).join('\n');
 const text='#EXTM3U\n'+bad+'\n#EXTINF:-1,Invalid header\n#EXTVLCOPT:http-referrer=https://evil.test\nhttps://provider.example/blocked.m3u8\n#EXTINF:-1,Allowed\n/allowed.m3u8';
 const result=parseApprovedM3u(text,config);assert.equal(result.items.length,1);assert.equal(result.items[0].name,'Allowed');assert.ok(result.rejected>=invalid.length);
});
test('rejects HLS manifests and excessive entry counts without partial success',()=>{
 assert.throws(()=>parseApprovedM3u('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2,Test\n/a.ts',config),/hls_is_not_a_catalog/);
 assert.throws(()=>parseApprovedM3u('#EXTM3U\n#EXTINF:-1,One\n/a\n#EXTINF:-1,Two\n/b',{...config,maxEntries:1}),/playlist_entry_limit/);
 assert.throws(()=>parseApprovedM3u('#EXTM3U\n#EXTINF:-1,One\n/a',{...config,approvedOrigins:[]}),/provider_not_approved/);
 assert.throws(()=>parseApprovedM3u('#EXTM3U\n'+('x'.repeat(8*1024*1024)),config),/playlist_too_large/);
});
test('deduplicates URLs without inventing items from unlabelled entries',()=>{
 const result=parseApprovedM3u('#EXTM3U\n/unlabelled\n#EXTINF:-1,One\n/a\n#EXTINF:-1,Duplicate\n/a\n#EXTINF:-1,Two\n/b',config);
 assert.equal(result.items.length,2);assert.equal(result.items[0].name,'One');
});

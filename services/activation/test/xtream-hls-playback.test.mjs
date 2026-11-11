import test from 'node:test';
import assert from 'node:assert/strict';
import {sealXtreamHlsTicket,unsealXtreamHlsTicket,
  rewriteXtreamHlsManifest,readXtreamHlsManifest} from '../src/xtream-hls-playback.mjs';

const keyHex='a'.repeat(64);
const accountId='550e8400-e29b-41d4-a716-446655440000';
const sourceId='660e8400-e29b-41d4-a716-446655440000';
const gatewayId='1312444';
const args={keyHex,accountId,sourceId,gatewayId,username:'AbCd1234',
  password:'abcDEF123456',publicOrigin:'https://bfy.up.railway.app'};
const now=Date.parse('2026-11-11T06:15:00Z');

test('HLS media playlist rewrites provider segment paths with authenticated opaque URLs',()=>{
  const original='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\n/hls/secret-source/5511_1.ts\n#EXTINF:10,\n../hls/secret-source/5511_2.ts\n';
  const rewritten=rewriteXtreamHlsManifest({...args,now,depth:0,manifest:original,
    playlistUrl:'http://provider.example.com/live/provider/secret/1312444.m3u8'});
  assert.match(rewritten,/^#EXTM3U/);
  assert.equal((rewritten.match(/https:\/\/bfy\.up\.railway\.app\/hls\//g)||[]).length,2);
  assert.doesNotMatch(rewritten,/provider\.example\.com|secret-source/);
  const tickets=[...rewritten.matchAll(/\/hls\/AbCd1234\/abcDEF123456\/1312444\/([A-Za-z0-9_-]+)/g)].map(x=>x[1]);
  const first=unsealXtreamHlsTicket(tickets[0],{now,keyHex});
  assert.equal(first.a,accountId);
  assert.equal(first.s,sourceId);
  assert.equal(first.g,gatewayId);
  assert.equal(first.d,1);
  assert.equal(new URL(first.u).pathname,'/hls/secret-source/5511_1.ts');
});
test('rewrites nested playlists, alternate audio and encrypted key URIs',()=>{
  const manifest=['#EXTM3U','#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="../audio/main.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=1280000','variant_1.m3u8',''].join('\n');
  const next=rewriteXtreamHlsManifest({...args,now,manifest,
    playlistUrl:'https://cdn.example.net/live/index.m3u8'});
  assert.doesNotMatch(next,/keys\/key.bin|audio\/main\.m3u8|variant_1\.m3u8/);
  assert.equal((next.match(/\/hls\/AbCd1234/g)||[]).length,3);
});
test('HLS tickets reject tampering and expire without revealing provider addresses',()=>{
  const ticket=sealXtreamHlsTicket({keyHex,accountId,sourceId,gatewayId,depth:1,now,
    url:'https://cdn.example.com/s/video.ts?signature=topsecret'});
  assert.doesNotMatch(ticket,/topsecret|cdn\.example/);
  assert.equal(unsealXtreamHlsTicket(ticket,{keyHex,now:now+1000}).g,gatewayId);
  const offset=Math.floor(ticket.length/2);
  const altered=ticket.slice(0,offset)+(ticket[offset]==='A'?'B':'A')+ticket.slice(offset+1);
  assert.equal(unsealXtreamHlsTicket(altered,{keyHex,now}),null);
  assert.equal(unsealXtreamHlsTicket(ticket,{keyHex,now:now+13*60*1000}),null);
});
test('HLS playlists cannot point to localhost, file URLs or unbounded loops',()=>{
  const base={...args,now,manifest:'#EXTM3U\nfile:///etc/passwd',
    playlistUrl:'https://cdn.example.net/a.m3u8'};
  assert.throws(()=>rewriteXtreamHlsManifest(base),/hls_destination_denied/);
  assert.throws(()=>rewriteXtreamHlsManifest({...base,manifest:'#EXTM3U\nhttp://localhost/foo.ts'}),/hls_destination_denied/);
  assert.throws(()=>rewriteXtreamHlsManifest({...base,depth:5,manifest:'#EXTM3U\nhttps://cdn.example.net/a.ts'}),/hls_manifest_depth_exceeded/);
});
test('HLS bounded reader accepts UTF-8 chunks',async()=>{
  const stream=new ReadableStream({start(c){
    c.enqueue(new TextEncoder().encode('#EXTM3U\nsegment.ts\n'));c.close();
  }});
  const result=await readXtreamHlsManifest(stream.getReader());
  assert.equal(result,'#EXTM3U\nsegment.ts\n');
});

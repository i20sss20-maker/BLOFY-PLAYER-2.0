import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHybridM3uMediaUrl,scanHybridM3uMedia,verifiedHybridRow} from '../src/xtream-hybrid-m3u.mjs';
const args={baseUrl:'http://provider.example:8080',username:'u',password:'p'};
test('M3U recognizes only exact same-account movies and series episodes',()=>{
  const movie='http://provider.example:8080/movie/u/p/207458.mkv';
  assert.equal(parseHybridM3uMediaUrl(movie,args)?.sourceId,'207458');
  assert.equal(parseHybridM3uMediaUrl('https://cdn.example/series/u/p/294466.mp4',args)?.kind,'series');
  for(const url of ['http://foreign.example/movie/u/p/207458.mp4',
    'https://cdn.example/movie/stranger/p/207458.mp4',
    'https://cdn.example/movie/u/wrong/207458.mp4',
    'https://cdn.example/live/u/p/207458.ts',
    'https://cdn.example/movie/u/p/207458.php',
    'https://cdn.example/movie/u/p/207458.mp4#fragment',
    'file:///movie/u/p/207458.mp4',
    'https://cdn.example/prefix/movie/u/p/207458.mp4'])
    assert.equal(parseHybridM3uMediaUrl(url,args),null,url);
});
test('stream parser reads fragmented titles with bounded batches',async()=>{
  const content='#EXTM3U\n#EXTINF:-1,movie\nhttp://provider.example:8080/movie/u/p/207458.mkv\n'+
    '#EXTINF:-1,tv\nhttp://provider.example:8080/live/u/p/12.ts\n'+
    '#EXTINF:-1,episode\nhttp://provider.example:8080/series/u/p/294466.mp4\n';
  const bytes=new TextEncoder().encode(content),out=[];
  const input=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=11)c.enqueue(bytes.slice(i,i+11));c.close()}});
  const stats=await scanHybridM3uMedia(input,{...args,batchSize:1,onBatch:async x=>out.push(...x)});
  assert.deepEqual(out.map(x=>[x.kind,x.sourceId]),[['movie','207458'],['series','294466']]);
  assert.equal(stats.matched,2);assert.equal(stats.entries,3);
  assert.equal(stats.movies,1);assert.equal(stats.episodes,1);
});
test('rejected playlists and stale index generations never count as playable',async()=>{
  const body=text=>new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(text));c.close()}});
  await assert.rejects(scanHybridM3uMedia(body('<html>blocked</html>'),{...args,onBatch:async()=>{}}),
    /xtream_m3u_invalid_header/);
  await assert.rejects(scanHybridM3uMedia(body('#EXTM3U\n#EXTINF:-1,A\n'+('x'.repeat(35000))),{
    ...args,onBatch:async()=>{}
  }),/xtream_m3u_line_too_long/);
  const item={generation:'current',stream_url_secret:'cipher',ambiguous:false};
  assert.equal(verifiedHybridRow(item,'current'),true);
  assert.equal(verifiedHybridRow({...item,ambiguous:true},'current'),false);
  assert.equal(verifiedHybridRow(item,'stale'),false);
});

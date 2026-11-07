import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHybridM3uMediaUrl,scanHybridM3uMedia,verifiedHybridRow,collapseHybridM3uMediaBatch} from '../src/xtream-hybrid-m3u.mjs';
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

test('actual gateway decrypts exact indexed ID, verifies video bytes, and refuses unindexed sources',async()=>{
  const src=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
  const a=src.indexOf('async function verifiedHybridM3uFallback(');
  const b=src.indexOf('async function verifiedOfficialMediaAlternative(',a);
  assert.ok(a>0&&b>a);
  const gen='11111111-1111-4111-8111-111111111111';
  const source={server_id:'22222222-2222-4222-8222-222222222222',
    base_url:args.baseUrl,m3u_index_generation:gen};
  const raw='http://provider.example:8080/movie/u/p/207458.mkv';
  let checked=0;
  const mocks={
    pool:{query:async(sql,params)=>{
      assert.match(sql,/blofy_xtream_m3u_media_links/);
      assert.deepEqual(params,[source.server_id,gen,'movie','207458']);
      return {rows:[{generation:gen,stream_url_secret:'cipher',ambiguous:false}]};
    }},
    verifiedHybridRow,parseHybridM3uMediaUrl,
    decryptServerCredentials:()=>({username:'u',password:'p'}),
    decryptXtreamSecret:(secret,key,aad)=>{
      assert.equal(aad,'m3u-media:'+source.server_id+':'+gen+':movie:207458');
      return raw;
    },
    KEY_HEX:'aa'.repeat(32),
    confirmProviderMediaUrl:async url=>{checked++;assert.equal(url.toString(),raw);return true;},
    console:{info:()=>{}}
  };
  const fn=new Function(...Object.keys(mocks),src.slice(a,b)+
    ';return verifiedHybridM3uFallback;')(...Object.values(mocks));
  const result=await fn(source,'movie','207458',{deadline:Date.now()+12000});
  assert.equal(result?.mode,'m3u');assert.equal(result?.verified,true);
  assert.equal(checked,1);
  assert.equal(await fn({...source,m3u_index_generation:null},'movie','207458'),null);
  assert.equal(await fn(source,'live','207458'),null);
});
test('index and player never replace original Xtream catalog or bypass preflight',async()=>{
  const [admin,gateway,html,native,session]=await Promise.all([
    readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'),
    readFile(new URL('../web/sources-admin.html',import.meta.url),'utf8'),
    readFile(new URL('../src/xtream-native-controls.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/admin-session-hook.mjs',import.meta.url),'utf8')
  ]);
  assert.match(admin,/CREATE TABLE IF NOT EXISTS blofy_xtream_m3u_media_links/);
  assert.match(admin,/m3u_index_generation=NULL/);
  assert.match(admin,/encryptXtreamSecret\(item.url,KEY_HEX/);
  assert.match(admin,/url_digest<>excluded.url_digest/);
  assert.match(gateway,/verifiedHybridM3uFallback\(row,kind,id,\{deadline,diagnostic:m3uEvidence\}\)/);
  assert.match(gateway,/verifiedHybridM3uFallback\(row,'movie',sourceId/);
  assert.match(gateway,/verifiedHybridM3uFallback\(row,'series',sourceId/);
  assert.match(native,/securedForm\(id,'index-m3u'/);
  assert.match(session,/test-m3u\|index-m3u\|probe-live/);
  assert.match(html,/sources-admin\.js\?v=20261107-transport-evidence-v3/);
  assert.doesNotMatch(admin.slice(admin.indexOf('async function runHybridM3uIndex('),
    admin.indexOf('async function createServer(')),/DELETE FROM blofy_xtream_items/);
});

test('duplicated movie IDs inside a single playlist batch never cause PostgreSQL double-conflict',()=>{
  const base={kind:'movie',sourceId:'207458',extension:'mp4',
    url:'http://provider.example:8080/movie/u/p/207458.mp4'};
  const rows=collapseHybridM3uMediaBatch([
    base,{...base}, // common provider duplicate, harmless
    {...base,kind:'series',sourceId:'294466'}, // different key
    {...base,url:'http://provider.example:8080/movie/u/p/207458.mkv'}
  ]);
  assert.equal(rows.length,2);
  const movie=rows.find(x=>x.kind==='movie');
  assert.equal(movie.url,base.url);
  assert.equal(movie.ambiguous,true,'conflicting versions must never be chosen randomly');
  assert.equal(rows.find(x=>x.kind==='series').ambiguous,false);
  assert.equal(collapseHybridM3uMediaBatch([base,{...base}])[0].ambiguous,false);
});
test('real M3U upsert groups identical keys once and carries ambiguous flag through SQL',async()=>{
  const code=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  assert.match(code,/const rows=collapseHybridM3uMediaBatch\(batch\)\.map/);
  assert.match(code,/r\.digest,r\.ambiguous/);
  assert.match(code,/ambiguous=blofy_xtream_m3u_media_links\.ambiguous OR excluded\.ambiguous/);
});

test('service restarts never automatically reindex a failed source; require explicit authenticated operator action',async()=>{
  const src=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
  const ready=src.slice(src.indexOf('async function ensureReady('),
    src.indexOf('function decryptCredentials(',src.indexOf('async function ensureReady(')));
  assert.doesNotMatch(ready,/startHybridM3uIndex\(/,
    'no automatic massive playlist download on service startup');
  assert.doesNotMatch(ready,/m3u_index_generation IS NULL/,
    'do not repeatedly retry failed index after deployment');
  assert.match(src,/if\(action==='index-m3u'\)/,
    'only an authenticated native admin action can launch a new index');
  assert.match(src,/if \(action === 'index-m3u' && req.method === 'POST'\)/,
    'retain protected admin API for explicit indexing');
  assert.match(src,/function startHybridM3uIndex\(id\)/);
});

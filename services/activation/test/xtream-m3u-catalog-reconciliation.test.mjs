import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reconcileXtreamM3uWithImportedCatalog} from '../src/xtream-m3u-catalog-reconciliation.mjs';

const sourceId='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const setup={sourceId,baseUrl:'http://provider.example',
 username:'u',password:'privatePASS'};
const pool={query:async(sql,args)=>{
 assert.match(sql,/WHERE server_id=\$1/);
 assert.deepEqual(args,[sourceId]);
 return {rows:[
  {media_type:'live',source_id:'c1',container_extension:'ts'},
  {media_type:'movie',source_id:'m1',container_extension:'mp4'},
  {media_type:'movie',source_id:'m2',container_extension:'mkv'}
 ]};
}};
const m3u=['#EXTM3U','#EXTINF:-1,Channel',
 'http://provider.example/live/u/privatePASS/c1.ts',
 '#EXTINF:-1,Movie','http://provider.example/movie/u/privatePASS/m1.mkv',
 '#EXTINF:-1,Episode','http://provider.example/series/u/privatePASS/e1.mp4',
 '#EXTINF:-1,Different','https://cdn.example/signed/SECRET.ts'].join('\n');
test('full M3U ID reconciliation compares only IDs and extensions, never downloads media',async()=>{
 const urls=[];
 const r=await reconcileXtreamM3uWithImportedCatalog({...setup,pool},{
  checkPublic:async()=>{},
  fetchImpl:async(url,opts)=>{
   urls.push({url,opts});return new Response(m3u,{status:200});
  }
 });
 assert.equal(r.ok,true);
 assert.equal(r.importedLive,1);
 assert.equal(r.importedMovies,2);
 assert.equal(r.matchedLive,1);
 assert.equal(r.matchedMovies,1);
 assert.equal(r.moviesMissingFromPlaylist,1);
 assert.equal(r.movieExtensionsDisagreeing,1);
 assert.equal(r.seriesEpisodeUrls,1);
 assert.equal(r.mediaRequests,0);
 assert.equal(urls.length,1);
 assert.match(urls[0].url.pathname,/\/get\.php$/);
 assert.equal(urls[0].opts.redirect,'manual');
 assert.doesNotMatch(JSON.stringify(r),/privatePASS|SECRET|provider\.example|cdn\.example|\/movie\//);
});
test('oversize playlists report incomplete, not a full scan',async()=>{
 const r=await reconcileXtreamM3uWithImportedCatalog({...setup,pool},{
  checkPublic:async()=>{},maxBytes:10,
  fetchImpl:async()=>new Response(m3u,{status:200})
 });
 assert.equal(r.ok,false);
 assert.equal(r.incomplete,true);
});
test('operator boot source guard is read-only and never fetches media URLs individually',async()=>{
 const js=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=js.indexOf("if(process.env.BLOFY_XTREAM_M3U_FULL_ID_COMPARE_ON_BOOT==='1')");
 const b=js.indexOf('// One-shot, read-only comparison with player_api.php server_info.',a);
 const part=js.slice(a,b);
 assert.ok(a>=0&&b>a);
 assert.match(part,/BLOFY_XTREAM_EGRESS_SOURCE_ID/);
 assert.match(part,/reconcileXtreamM3uWithImportedCatalog/);
 assert.match(part,/sourceMutation:false/);
 assert.doesNotMatch(part,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|syncServer\(/);
 const audit=await readFile(new URL('../src/xtream-m3u-catalog-reconciliation.mjs',import.meta.url),'utf8');
 assert.match(audit,/xtreamM3uUrl/);
 assert.match(audit,/maxBytes=256\*1024\*1024/);
 assert.doesNotMatch(audit,/\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
});

test('failed provider transport emits a safe stage, never the signed playlist URL',async()=>{
 const r=await reconcileXtreamM3uWithImportedCatalog({...setup,pool},{
  checkPublic:async()=>{},
  fetchImpl:async()=>{throw Error('url http://provider.example?password=privatePASS');},
  http11Impl:async()=>{throw Error('password privatePASS');}
 });
 assert.equal(r.ok,false);
 assert.equal(r.stage,'playlist_http11_request');
 assert.equal(r.code,'reconciliation_stage_failed');
 assert.doesNotMatch(JSON.stringify(r),/privatePASS|provider\.example|password=/);
});
test('DNS and database failures return different redacted stages',async()=>{
 const dns=await reconcileXtreamM3uWithImportedCatalog({...setup,pool},{
  checkPublic:async()=>{throw Error('source password');}
 });
 assert.equal(dns.stage,'public_dns');
 const db=await reconcileXtreamM3uWithImportedCatalog({...setup,
  pool:{query:async()=>{throw Error('db failure source password');}}},{
  checkPublic:async()=>{}
 });
 assert.equal(db.stage,'database');
 assert.doesNotMatch(JSON.stringify(db),/password/);
});

test('HTTP/1.1 fallback can read official playlist when native fetch transport throws',async()=>{
 let transportCalls=0;
 const result=await reconcileXtreamM3uWithImportedCatalog({...setup,pool},{
  checkPublic:async()=>{},
  fetchImpl:async()=>{throw Error('fetch socket reset');},
  http11Impl:async()=>{transportCalls++;return new Response(m3u,{status:200});}
 });
 assert.equal(result.ok,true);
 assert.equal(result.transport,'http11');
 assert.equal(result.matchedMovies,1);
 assert.equal(transportCalls,1);
 assert.equal(result.mediaRequests,0);
});
test('HTTP 403 is an actual denial, not a reason to retry another transport',async()=>{
 let calls=0;
 const result=await reconcileXtreamM3uWithImportedCatalog({...setup,pool},{
  checkPublic:async()=>{},
  fetchImpl:async()=>new Response('Access denied',{status:403}),
  http11Impl:async()=>{calls++;throw Error('should never run');}
 });
 assert.equal(result.ok,false);
 assert.equal(result.playlistStatus,403);
 assert.equal(calls,0);
});

test('source-allowlisted independent manifest relay recovers full comparison after both portal connections fail',async()=>{
 let isolatedCalls=0;
 const r=await reconcileXtreamM3uWithImportedCatalog({...setup,pool},{
  checkPublic:async()=>{},
  fetchImpl:async()=>{throw Error('direct socket reset');},
  http11Impl:async()=>{throw Error('http1 reset');},
  independentImpl:async()=>{isolatedCalls++;return new Response(m3u,{status:200});}
 });
 assert.equal(r.ok,true);
 assert.equal(r.transport,'isolated_stream');
 assert.equal(r.matchedMovies,1);
 assert.equal(r.movieExtensionsDisagreeing,1);
 assert.equal(isolatedCalls,1);
 assert.equal(r.mediaRequests,0);
});
test('independent M3U path is gated to explicit source selection before any request',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=c.indexOf("if(process.env.BLOFY_XTREAM_M3U_FULL_ID_COMPARE_ON_BOOT==='1')");
 const b=c.indexOf('// One-shot, read-only comparison with player_api.php server_info.',a);
 const block=c.slice(a,b);
 assert.match(block,/independentImpl:shouldUseIndependentXtreamSource\(id\)\?/);
 assert.match(block,/fetchIndependentXtreamManifest\(manifest.href\)/);
});

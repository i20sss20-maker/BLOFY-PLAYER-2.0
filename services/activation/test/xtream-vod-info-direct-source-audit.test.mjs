import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectSameXtreamVodInfo} from '../src/xtream-vod-info-direct-source-audit.mjs';

test('exact saved movie ID may have official alternate direct source without disclosure',()=>{
 const data={movie_data:{stream_id:'123',container_extension:'mkv',
   direct_source:'https://cdn.example/movie/123.mkv?token=SECRET'},
  info:{direct_source:'https://other.example/123.mkv?sig=PRIVATE'}};
 const out=inspectSameXtreamVodInfo(data,'123','mkv');
 assert.deepEqual(out,{ok:true,code:'same_id',extensionMatches:true,
  extensionChanged:false,movieDirectSourceAdvertised:true,
  infoDirectSourceAdvertised:true});
 assert.doesNotMatch(JSON.stringify(out),/SECRET|PRIVATE|cdn|https/);
});
test('mismatched movie IDs or nonpublic scheme are rejected',()=>{
 assert.equal(inspectSameXtreamVodInfo(
  {movie_data:{stream_id:'999',direct_source:'https://cdn.test/t'}},'123','mkv').ok,false);
 assert.equal(inspectSameXtreamVodInfo(
  {movie_data:{stream_id:'123',direct_source:'file:///etc/passwd'}},'123','mkv')
  .movieDirectSourceAdvertised,false);
 assert.equal(inspectSameXtreamVodInfo({},'123','mp4').ok,false);
});
test('one-shot original VOD metadata probe cannot rewrite catalog or request movie bytes',async()=>{
 const c=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=c.indexOf("if(process.env.BLOFY_XTREAM_VOD_INFO_SAME_ID_ON_BOOT==='1')");
 const end=c.indexOf('// Full local audit scans every imported item',start);
 const s=c.slice(start,end);
 assert.ok(start>0&&end>start);
 assert.match(s,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(s,/ORDER BY name ASC LIMIT 2/);
 assert.match(s,/get_vod_info/);
 assert.match(s,/inspectSameXtreamVodInfo\(data,item.source_id,item.container_extension\)/);
 assert.match(s,/mediaRequests:0,customerCutover:false/);
 assert.doesNotMatch(s,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|syncServer\(/);
 assert.doesNotMatch(s,/console\.log\(data|console\.info\(url/);
});

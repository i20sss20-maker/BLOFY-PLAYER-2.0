import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {downloadXtreamM3uCatalog} from '../src/xtream-m3u-catalog.mjs';

const source={baseUrl:'http://example.test',username:'u',password:'privatePASS'};
const line='#EXTM3U\n#EXTINF:-1 group-title="Channels",قناة عربية\n'+
 'http://example.test/live/u/privatePASS/ch1.ts\n';
const film='#EXTINF:-1 group-title="Films",Film A\n'+
 'http://example.test/movie/u/privatePASS/film1.mp4\n';

test('read-only large M3U import reads more than old 48MiB limit without buffering discarded episodes',async()=>{
 // Each comment is under the per-line bound, but the full M3U exceeds 48MiB.
 // Construct and stream chunks lazily rather than storing a large playlist.
 const filler=Buffer.from(('#'+'X'.repeat(12000)+'\n').repeat(560));
 let emitted=0;
 const streamed=new ReadableStream({pull(controller){
  if(emitted===0)controller.enqueue(Buffer.from(line));
  else if(emitted<=8)controller.enqueue(filler);
  else if(emitted===9)controller.enqueue(Buffer.from(film));
  else {controller.close();return;}
  emitted++;
 }});
 const result=await downloadXtreamM3uCatalog(source,{
  checkPublic:async()=>{},
  fetchImpl:async()=>new Response(streamed,{status:200})
 });
 assert.equal(emitted,10);
 assert.deepEqual(result.records.live.map(x=>x.sourceId),['ch1']);
 assert.deepEqual(result.records.movie.map(x=>x.sourceId),['film1']);
 assert.equal(result.records.live[0].name,'قناة عربية');
 assert.equal(result.records.series.length,0);
});
test('transport reset can use same-source independent official M3U once',async()=>{
 let direct=0,independent=0;
 const result=await downloadXtreamM3uCatalog(source,{
  checkPublic:async()=>{},
  fetchImpl:async()=>{direct++;throw Error('socket reset with secret privatePASS');},
  independentImpl:async(url)=>{independent++;
   assert.equal(url.pathname,'/get.php');
   assert.equal(url.searchParams.get('username'),'u');
   return new Response(line+film,{status:200});
  }
 });
 assert.equal(direct,1);
 assert.equal(independent,1);
 assert.equal(result.records.live.length,1);
 assert.equal(result.records.movie.length,1);
});
test('explicit 403 never triggers source fallback or retry',async()=>{
 let independent=0;
 await assert.rejects(downloadXtreamM3uCatalog(source,{
  checkPublic:async()=>{},
  fetchImpl:async()=>new Response('Access denied',{status:403}),
  independentImpl:async()=>{independent++;return new Response(line,{status:200});}
 }),/xtream_m3u_http_403/);
 assert.equal(independent,0);
});
test('per-source fallback remains opt-in in sync and cannot change customer traffic',async()=>{
 const sourceCode=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const start=sourceCode.indexOf('const getM3u=()=>{');
 const end=sourceCode.indexOf('for (const mediaType of types)',start);
 assert.ok(start>0&&end>start);
 const part=sourceCode.slice(start,end);
 assert.match(part,/shouldUseIndependentXtreamSource\(id\)\?/);
 assert.match(part,/fetchIndependentXtreamManifest\(manifest.href\)/);
 assert.doesNotMatch(part,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|syncServer\(/);
});
test('stream handles UTF-8 Arabic characters split between chunks',async()=>{
 const data=Buffer.from(line+film,'utf8'),parts=[];
 for(let pos=0;pos<data.length;pos+=7)parts.push(data.subarray(pos,pos+7));
 let at=0;
 const reader=new ReadableStream({pull(controller){
  if(at<parts.length)controller.enqueue(parts[at++]);
  else controller.close();
 }});
 const result=await downloadXtreamM3uCatalog(source,{
  checkPublic:async()=>{},fetchImpl:async()=>new Response(reader,{status:200})
 });
 assert.equal(result.records.live[0].name,'قناة عربية');
 assert.equal(result.records.movie[0].sourceId,'film1');
});


test('retains 60005 official live/movie records before downstream deduplication',async()=>{
 const header='#EXTM3U\n';
 const item='#EXTINF:-1 group-title="Live",Repeated\n'+
  'http://example.test/live/u/privatePASS/101.ts\n';
 const body=header+item.repeat(60005);
 const result=await downloadXtreamM3uCatalog(source,{
  checkPublic:async()=>{},fetchImpl:async()=>new Response(body,{status:200})
 });
 assert.equal(result.records.live.length,60005);
 assert.equal(result.records.movie.length,0);
 assert.equal(result.categories.live.length,1);
});


test('operator dry-run invokes importer without modifying source catalog',async()=>{
 const hook=await readFile(new URL('../src/xtream-admin-hook.mjs',import.meta.url),'utf8');
 const a=hook.indexOf("if(process.env.BLOFY_XTREAM_M3U_IMPORT_DRY_RUN_ON_BOOT==='1')");
 const b=hook.indexOf('// An operator may reconcile the entire stored movie/live ID set',a);
 assert.ok(a>=0&&b>a);
 const block=hook.slice(a,b);
 assert.match(block,/shouldUseIndependentXtreamSource\(id\)/);
 assert.match(block,/downloadXtreamM3uCatalog\(/);
 assert.match(block,/fetchIndependentXtreamManifest\(manifest.href\)/);
 assert.match(block,/sourceMutation:false,customerCutover:false/);
 assert.doesNotMatch(block,/\bUPDATE\b|\bDELETE\b|\bINSERT\b|syncServer\(/);
});

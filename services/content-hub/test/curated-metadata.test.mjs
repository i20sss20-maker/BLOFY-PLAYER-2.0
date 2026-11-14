import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentCatalogStore,validateCuratedMetadata}
 from '../src/curated-metadata.mjs';
import {createContentHubServer} from '../src/server.mjs';

const entry={key:'series:987654321',title:'مسلسل الاختبار',
 year:2025,genre:'drama',overview:'وصف خاص بالمكتبة',
 posterPath:'/AbCde9876543.jpg',confirmed:true,artworkRightsConfirmed:true};
test('curated metadata validation rejects URLs, unlicensed cover and invalid keys',()=>{
 assert.deepEqual(validateCuratedMetadata(entry),{
  key:entry.key,title:entry.title,year:entry.year,genre:entry.genre,
  overview:entry.overview,posterPath:entry.posterPath});
 for(const changes of [
  {key:'series:../../etc/passwd'},
  {key:'episode:123'},
  {title:' '},
  {title:'<script>bad</script>'},
  {year:1800},
  {genre:'secret'},
  {posterPath:'http://127.0.0.1/a.jpg'},
  {posterPath:'https://image.tmdb.org/t/p/w500/foo.jpg'},
  {posterPath:'/foo.svg'},
  {posterPath:'/../../secret.jpg'},
  {confirmed:false},{artworkRightsConfirmed:false}
 ]){
  assert.throws(()=>validateCuratedMetadata({...entry,...changes}),
   /curated_metadata_invalid/);
 }
});
test('curated catalog is read-only before explicit owner save and SQL-bound',async()=>{
 const calls=[];
 class MockPool{
  async query(sql,params=[]){
   calls.push({sql,params});
   if(sql.includes('FROM blofy_content_hub_curated_metadata')&&
      sql.includes('WHERE media_key=ANY'))
    return {rows:[{media_key:entry.key,title:entry.title,genre:entry.genre,
     release_year:entry.year,overview:entry.overview,
     poster_path:entry.posterPath,updated_at:'2026-11-14T09:30:00Z'}]};
   if(sql.includes('WHERE regexp_replace(season_key'))
    return {rows:[{present:1}]};
   if(sql.includes('RETURNING media_key'))
    return {rows:[{media_key:entry.key,title:entry.title,genre:entry.genre,
     release_year:entry.year,overview:entry.overview,
     poster_path:entry.posterPath,updated_at:'2026-11-14T09:30:00Z'}]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createContentCatalogStore({connectionString:'mock',Pool:MockPool});
 const listed=await store.find([entry.key]);
 assert.equal(listed[0].title,entry.title);
 assert.equal(calls.some(x=>x.sql.includes('CREATE TABLE')),false);
 const saved=await store.save(entry);
 assert.equal(saved.ok,true);
 assert.equal(saved.automaticDownload,false);
 assert.equal(saved.metadata.posterPath,entry.posterPath);
 assert.equal(saved.metadata.source,'owner_curated');
 assert.equal(calls.filter(x=>x.sql.includes('CREATE TABLE')).length,1);
 const upsert=calls.find(x=>x.sql.includes('RETURNING media_key'));
 assert.deepEqual(upsert.params.slice(0,3),
  [entry.key,entry.title,entry.year]);
 const series=await store.searchSeriesIds('مسلسل');
 assert.deepEqual(series.ids,[]);
 await assert.rejects(store.find(['movie:unknown','../../bad']),
  /catalog_keys_invalid/);
 await store.close();
});
test('private metadata writes require owner token, confirmation and existing record',async()=>{
 const token='a'.repeat(48),writes=[];
 const catalogStore={
  save:async(x)=>{writes.push(x);return {ok:true,metadata:{...x},automaticDownload:false}}
 };
 const hub=createContentHubServer({token,catalogStore,lease:{},storage:{}});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 const url='http://127.0.0.1:'+hub.server.address().port+
  '/internal/library/metadata';
 const body=JSON.stringify(entry);
 const headers={authorization:'Bearer '+token,'content-type':'application/json',
  'x-blofy-owner-action':'curate-private-metadata'};
 try{
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   'content-type':'application/json'}})).status,401);
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   authorization:'Bearer '+token,'content-type':'application/json'}})).status,403);
  assert.equal((await fetch(url+'?evil=1',{method:'POST',body,headers})).status,403);
  assert.equal((await fetch(url,{method:'GET',headers})).status,404);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({
   ...entry,posterPath:'http://evil.test/private.jpg'})})).status,400);
  assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({
   ...entry,artworkRightsConfirmed:false})})).status,400);
  assert.equal(writes.length,0);
  const result=await fetch(url,{method:'POST',headers,body});
  assert.equal(result.status,200);
  assert.equal((await result.json()).ok,true);
  assert.equal(writes.length,1);
 }finally{await new Promise(done=>hub.server.close(done))}
});
test('library read joins only curated keys and honors title match IDs',async()=>{
 const token='q'.repeat(48);
 let input;
 const store={librarySearch:async params=>{
  input=params;
  return {query:params.query,page:params.page,state:params.state,
   episodes:[{seasonKey:'series_987654321_s01',episodeNumber:1,title:'Ep1'}],
   seasons:[{seasonKey:'series_987654321_s01',episodeCount:1}]};
 }};
 const catalogStore={
  searchSeriesIds:async()=>({ids:['987654321'],limited:false}),
  find:async keys=>{
   assert.ok(keys.includes(entry.key));
   return [{key:entry.key,title:entry.title,year:2025,
    genre:'drama',overview:'وصف',posterPath:entry.posterPath}];
  }
 };
 const hub=createContentHubServer({token,storage:{},lease:{
  listPilotRuns:async()=>[],listChunkedRuns:async()=>[]
 },seasonQueueStore:store,catalogStore});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 try{
  const response=await fetch('http://127.0.0.1:'+hub.server.address().port+
   '/internal/library/search',{method:'POST',headers:{
    authorization:'Bearer '+token,
    'content-type':'application/json',
    'x-blofy-owner-action':'library-read-only'},
   body:JSON.stringify({query:'مسلسل',state:'all',page:1})});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.seasons[0].metadata.title,entry.title);
  assert.equal(data.episodes[0].seriesMetadata.posterPath,entry.posterPath);
  assert.deepEqual(input.seriesIds,['987654321']);
  assert.equal(data.providerMediaRequests,0);
  assert.equal(data.curatedOnly,true);
 }finally{await new Promise(done=>hub.server.close(done))}
});

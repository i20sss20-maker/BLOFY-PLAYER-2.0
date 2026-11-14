import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeasonQueueStore} from '../src/season-queue.mjs';
import {createContentHubServer} from '../src/server.mjs';

const token='q'.repeat(48);
const runId='season_1234567890abcdef';
const baseRow={
 run_id:runId,season_key:'series_23_s01',episode_number:3,
 title:'Chapter "https://private.example?password=secret"',state:'queued',
 expected_bytes:'8388608',bytes_copied:'4194304',code:null,
 updated_at:'2026-11-14T08:00:00Z',verified_state:null
};
test('SQL library query is parameterized, bounded and independent for season groups',async()=>{
 const seen=[];
 class MockPool{
  async query(sql,params=[]){
   seen.push({sql,params});
   if(sql.includes('GROUP BY q.season_key'))return {rows:[{
    season_key:'series_23_s01',episode_count:'4',verified_count:'2',
    failed_count:'1',queued_count:'1',running_count:'0',paused_count:'0',
    expected_bytes:'33554432',stored_bytes:'16777216'
   }]};
   if(sql.includes('ORDER BY q.updated_at DESC'))return {rows:[baseRow]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const a=await store.librarySearch({query:'https://bogus %_ \' OR 1=1',state:'all',page:1});
 assert.equal(a.episodes.length,1);
 assert.equal(a.episodes[0].title.includes('private.example'),false);
 assert.equal(a.episodes[0].storedBytes,4194304);
 assert.equal(a.seasons[0].verifiedCount,2);
 assert.equal(a.seasons[0].fullyVerifiedInQueue,false);
 assert.equal(a.searchedAllPersistedEpisodes,true);
 assert.equal(a.providerMediaRequests,0);
 const qs=seen.filter(q=>q.params.length===4);
 assert.equal(qs.length,2);
 assert.equal(qs.every(q=>q.params[2]===41&&q.params[3]===0),true);
 assert.equal(qs.every(q=>q.params[0]==="https://bogus %_ ' OR 1=1"),true);
 assert.equal(qs.every(q=>!q.sql.includes('bogus')),true);
 await assert.rejects(store.librarySearch({query:'evil\n'}),/season_library_search_invalid/);
 await assert.rejects(store.librarySearch({query:'abc',page:0}),/season_library_search_invalid/);
 await assert.rejects(store.librarySearch({query:'abc',state:'all;drop'}),/season_library_search_invalid/);
 await store.close();
});
test('private library route requires owner bearer and signed read action',async()=>{
 const seen=[];
 const store={librarySearch:async input=>{
  seen.push(input);
  return {query:input.query,page:input.page,state:input.state,
   pageSize:40,readOnly:true,episodes:[],seasons:[],episodesHasMore:false,
   seasonsHasMore:false};
 }};
 const lease={listPilotRuns:async()=>[
  {runId:'movie_01234567890',state:'verified',
   expectedBytes:8388608,bytesCopied:8388608,
   username:'do-not-export',password:'do-not-export'}],
 listChunkedRuns:async()=>[]};
 const hub=createContentHubServer({token,storage:{},lease,seasonQueueStore:store});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 const url='http://127.0.0.1:'+hub.server.address().port+'/internal/library/search';
 const headers={authorization:'Bearer '+token,'content-type':'application/json',
  'x-blofy-owner-action':'library-read-only'};
 const body=JSON.stringify({query:'',state:'all',page:1});
 try{
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   'content-type':'application/json'}})).status,401);
  assert.equal((await fetch(url,{method:'POST',body,headers:{
   authorization:'Bearer '+token,'content-type':'application/json'}})).status,403);
  assert.equal((await fetch(url+'?q=x',{method:'POST',body,headers})).status,403);
  assert.equal((await fetch(url,{method:'POST',body:'{bad',headers})).status,400);
  assert.equal((await fetch(url,{method:'POST',
   body:JSON.stringify({query:'x',state:'bad',page:1}),headers})).status,400);
  assert.equal((await fetch(url,{method:'GET',headers})).status,404);
  assert.equal(seen.length,0);
  const result=await fetch(url,{method:'POST',body,headers});
  assert.equal(result.status,200);
  const data=await result.json();
  assert.equal(data.ok,true);
  assert.equal(data.readOnly,true);
  assert.equal(data.providerMediaRequests,0);
  assert.equal(data.automaticStart,false);
  assert.equal(data.automaticRetry,false);
  assert.equal(data.movieHistoryAvailable,true);
  assert.equal(data.movieScope,'most_recent_50_legacy_and_50_chunked_runs_not_global_search');
  assert.equal(data.movies[0].verified,true);
  assert.equal(JSON.stringify(data).includes('do-not-export'),false);
  assert.deepEqual(seen,[{query:'',state:'all',page:1}]);
 }finally{await new Promise(done=>hub.server.close(done))}
});
test('unavailable movie history does not fake global results or fail episode search',async()=>{
 const store={librarySearch:async()=>({episodes:[],seasons:[],page:1})};
 const lease={listPilotRuns:async()=>{throw Error('down')},
  listChunkedRuns:async()=>[]};
 const hub=createContentHubServer({token,storage:{},lease,seasonQueueStore:store});
 hub.server.listen(0,'127.0.0.1');
 await new Promise(done=>hub.server.once('listening',done));
 try{
  const res=await fetch('http://127.0.0.1:'+hub.server.address().port+
   '/internal/library/search',{method:'POST',headers:{
    authorization:'Bearer '+token,'content-type':'application/json',
    'x-blofy-owner-action':'library-read-only'},
    body:JSON.stringify({query:'abc',state:'all',page:1})});
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.movieHistoryAvailable,false);
  assert.equal(data.movies.length,0);
  assert.equal(data.episodes.length,0);
 }finally{await new Promise(done=>hub.server.close(done))}
});

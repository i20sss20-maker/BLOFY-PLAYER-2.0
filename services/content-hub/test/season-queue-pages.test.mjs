import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeasonQueueStore} from '../src/season-queue.mjs';
import {createContentHubServer} from '../src/server.mjs';

test('queue listing uses stable ordering and exact 50-row SQL pages',async()=>{
 const queries=[];
 class Pool{
  async query(sql,args=[]){
   queries.push({sql,args});
   if(sql.startsWith('CREATE TABLE'))return {rows:[]};
   if(sql.startsWith('SELECT COUNT(*)'))return {rows:[{total:'173'}]};
   if(sql.startsWith('SELECT q.*'))return {rows:Array.from({length:args[0]},(_,i)=>({
    run_id:'season_page_'+String(args[1]+i+1).padStart(8,'0'),
    season_key:'series_3_s1',episode_number:i+1,
    gateway_id:args[1]+i+1,state:'queued',expected_bytes:'8388608',
    bytes_copied:'0',manual_retries:0,title:'Test '+i
   }))};
   throw Error('unexpected SQL');
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool});
 const first=await store.listPage({page:1});
 assert.deepEqual(first.page,{number:1,pageSize:50,totalEpisodes:173,
  pages:4,hasPrevious:false,hasNext:true,outOfRange:false});
 assert.equal(first.episodes.length,50);
 assert.equal(first.episodes[0].runId,'season_page_00000001');
 const second=await store.listPage({page:2});
 assert.equal(second.episodes[0].runId,'season_page_00000051');
 const final=await store.listPage({page:4});
 assert.equal(final.page.hasNext,false);
 const outside=await store.listPage({page:5});
 assert.equal(outside.page.outOfRange,true);
 assert.equal(outside.episodes.length,0);
 const select=queries.filter(q=>q.sql.startsWith('SELECT q.*'));
 assert.equal(select.length,3);
 assert.deepEqual(select.map(x=>x.args),[[50,0],[50,50],[50,150]]);
 for(const q of select)assert.match(q.sql,/ORDER BY q\.created_at,q\.run_id/);
 await assert.rejects(store.listPage({page:0}),/season_queue_page_invalid/);
 await assert.rejects(store.list({limit:50,offset:-1}),/season_queue_offset_invalid/);
 await store.close();
});
test('operator bearer required; paginated queue is read-only and query strings denied',async()=>{
 const token='q'.repeat(48),seen=[];
 const hub=createContentHubServer({
  token,storage:{},lease:{},
  pilotEnv:{BLOFY_CONTENT_HUB_SEASON_QUEUE_ENABLED:'0'},
  seasonQueueStore:{listPage:async({page})=>{
   seen.push(page);
   return {episodes:[],page:{number:page,pages:5,pageSize:50,
    totalEpisodes:213,hasNext:true,hasPrevious:page>1,outOfRange:false}};
  }}
 });
 hub.server.listen(0,'127.0.0.1');
 await new Promise(resolve=>hub.server.once('listening',resolve));
 const root='http://127.0.0.1:'+hub.server.address().port,
  auth={authorization:'Bearer '+token};
 try{
  assert.equal((await fetch(root+'/internal/seasons/queue/page/2')).status,401);
  let response=await fetch(root+'/internal/seasons/queue/page/2',{headers:auth});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.ok,true);
  assert.equal(data.page.totalEpisodes,213);
  assert.equal(data.page.number,2);
  assert.equal(data.customerCutover,false);
  assert.deepEqual(seen,[2]);
  response=await fetch(root+'/internal/seasons/queue/page/2?limit=10000',
   {headers:auth});
  assert.equal(response.status,400);
  assert.deepEqual(seen,[2]);
  response=await fetch(root+'/internal/seasons/queue/page/20001',
   {headers:auth});
  assert.notEqual(response.status,200);
  assert.deepEqual(seen,[2]);
 }finally{await new Promise(resolve=>hub.server.close(resolve))}
});

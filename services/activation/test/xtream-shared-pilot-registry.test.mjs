import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimDurableSharedLiveTrial,durableSharedLiveTrialEnabled,
  durableSharedLiveTrialStatus
} from '../src/xtream-shared-pilot-registry.mjs';
const sid='11111111-1111-4111-8111-111111111111';
const codes=[
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
];
const flags={BLOFY_STREAM_SHARED_LIVE_DURABLE_PILOT:'1',
 BLOFY_STREAM_SHARED_LIVE_FIRST_ACCOUNT_TEST_ENABLED:'1',
 BLOFY_STREAM_SHARED_LIVE_TWO_ACCOUNT_TEST_ENABLED:'1',
 BLOFY_STREAM_SHARED_LIVE_CANARY:'1',
 BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh'};
function fakePool({broken=false}={}){
 const stored=[];let nextLock=Promise.resolve(),released=0,rollbacks=0;
 const pool={
  stored,get released(){return released},get rollbacks(){return rollbacks},
  async query(sql){
   if(broken)throw Error('database unavailable with credentials!');
   if(sql.includes('CREATE TABLE'))return {rows:[]};
   if(sql.includes('COUNT(*)'))return {rows:[{count:stored.length}]};
   throw Error('Unexpected standalone SQL');
  },
  async connect(){
   if(broken)throw Error('database connection refused');
   let unlock,locked=false;
   return {
    async query(sql,values=[]){
     if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){
      if(sql!=='BEGIN'&&locked){locked=false;unlock();}
      if(sql==='ROLLBACK')rollbacks++;
      return {rows:[]};
     }
     if(sql.includes('pg_advisory_xact_lock')){
      const previous=nextLock;
      nextLock=new Promise(resolve=>{unlock=resolve});
      await previous;locked=true;return {rows:[]};
     }
     if(sql.includes('SELECT account_id')){
      return {rows:stored.filter(x=>x.source_id===values[0])
       .map(x=>({account_id:x.account_id}))};
     }
     if(sql.includes('INSERT INTO')){
      if(!stored.some(x=>x.source_id===values[0]&&x.account_id===values[1]))
        stored.push({source_id:values[0],account_id:values[1]});
      return {rows:[]};
     }
     throw Error('Unexpected query');
    },
    release(){released++;if(locked)unlock();}
   };
  }
 };
 return pool;
}
test('pilot fails closed before database usage when flags, source, or IDs are invalid',async()=>{
 const pool=fakePool();
 assert.equal(durableSharedLiveTrialEnabled({}),false);
 assert.equal(await claimDurableSharedLiveTrial(pool,{
  sourceId:sid,accountId:codes[0],sourceName:'saleh'},{}),false);
 assert.equal(await claimDurableSharedLiveTrial(pool,{
  sourceId:sid,accountId:codes[0],sourceName:'other'},flags),false);
 assert.equal(await claimDurableSharedLiveTrial(pool,{
  sourceId:'*',accountId:codes[0],sourceName:'saleh'},flags),false);
 assert.equal(pool.stored.length,0);
 assert.equal(pool.released,0);
});
test('two authorized accounts persist across new instances and reject third even when concurrent',async()=>{
 const pool=fakePool();
 const f=id=>claimDurableSharedLiveTrial(pool,{
  sourceId:sid,accountId:id,sourceName:'saleh'},flags);
 assert.deepEqual(await Promise.all(codes.map(f)),[true,true,false]);
 assert.equal(await f(codes[0]),true);
 assert.equal(await f(codes[1]),true);
 assert.equal(await f(codes[2]),false);
 const status=await durableSharedLiveTrialStatus(pool,flags);
 assert.deepEqual(status,{enabled:true,limit:2,claimed:2,persistent:true});
 assert.equal(pool.stored.length,2);
 assert.equal(pool.released,6);
});
test('one-account mode does not grant the second previously claimed code',async()=>{
 const pool=fakePool(),one={...flags,BLOFY_STREAM_SHARED_LIVE_TWO_ACCOUNT_TEST_ENABLED:'0'};
 const allowed=id=>claimDurableSharedLiveTrial(pool,{
  sourceId:sid,accountId:id,sourceName:'saleh'},one);
 assert.equal(await allowed(codes[0]),true);
 assert.equal(await allowed(codes[1]),false);
 assert.equal(pool.stored.length,1);
});
test('provider account database failures never bypass trial allowlist or leak credentials',async()=>{
 const pool=fakePool({broken:true});
 const admitted=await claimDurableSharedLiveTrial(pool,{
  sourceId:sid,accountId:codes[0],sourceName:'saleh'},flags);
 assert.equal(admitted,false);
 assert.equal(pool.stored.length,0);
 assert.equal((await durableSharedLiveTrialStatus(pool,flags)).persistent,false);
});

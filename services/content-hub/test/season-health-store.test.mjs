import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeasonQueueStore} from '../src/season-queue.mjs';

test('season health accounts all queue rows in PostgreSQL, not only the first 100',async()=>{
 const queries=[];
 class MockPool{
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql.includes('to_regclass'))return {rows:[{table_name:'blofy_content_hub_episode_runs'}]};
   if(sql.includes('CREATE TABLE'))return {rows:[]};
   if(sql.includes('SELECT COUNT(*)'))return {rows:[{
    episode_count:'201',queued_count:'20',running_count:'1',
    paused_count:'5',failed_count:'1',verified_count:'174',
    expected_bytes:'2147483648',stored_bytes:'1825361100',
    verified_bytes:'1750000000'
   }]};
   throw Error('unexpected_sql');
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const result=await store.healthStats();
 assert.equal(result.episode_count,'201');
 const aggregate=queries.find(x=>x.sql.includes('SELECT COUNT(*)'));
 assert.match(aggregate.sql,/LEFT JOIN blofy_content_hub_episode_runs/);
 assert.match(aggregate.sql,/r.state='verified'/);
 await store.close();
});
test('missing episode table uses zero recorded bytes instead of a broken join',async()=>{
 const statements=[];
 class MockPool{
  async query(sql){
   statements.push(sql);
   if(sql.includes('to_regclass'))return {rows:[{table_name:null}]};
   if(sql.includes('CREATE TABLE'))return {rows:[]};
   if(sql.includes('SELECT COUNT(*)'))return {rows:[{
    episode_count:'0',verified_count:'0',expected_bytes:'0',
    stored_bytes:'0',verified_bytes:'0'
   }]};
   throw Error('unexpected_sql');
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const result=await store.healthStats();
 assert.equal(result.stored_bytes,'0');
 const aggregate=statements.find(x=>x.includes('SELECT COUNT(*)'));
 assert.doesNotMatch(aggregate,/LEFT JOIN blofy_content_hub_episode_runs/);
 await store.close();
});
test('only bounded operator audit status is persisted, with no bucket keys',async()=>{
 let recorded=null;
 class MockPool{
  async query(sql,params=[]){
   if(sql.includes('INSERT INTO blofy_content_hub_season_audits')){
    recorded={sql,params};return {rows:[]};
   }
   if(sql.includes('SELECT run_id,code,checked_parts'))return {rows:[{
    run_id:'season_0123456789abcdef01234567',
    code:'season_storage_sample_verified',checked_parts:3,
    total_parts:173,checked_bytes:'25165824',
    checked_at:'2026-11-14T00:00:00Z'
   }]};
   return {rows:[]};
  }
  async end(){}
 }
 const store=createSeasonQueueStore({connectionString:'mock',Pool:MockPool});
 const id='season_0123456789abcdef01234567';
 await store.saveAudit(id,{code:'season_storage_sample_verified',
  checkedParts:3,totalParts:173,checkedBytes:25165824});
 assert.deepEqual(recorded.params,[id,'season_storage_sample_verified',
  3,173,25165824]);
 const list=await store.recentAudits();
 assert.equal(list[0].runId,id);
 assert.equal(list[0].checkedBytes,25165824);
 assert.equal(JSON.stringify(list).includes('saleh/episode/'),false);
 await assert.rejects(store.saveAudit(id,{code:'arbitrary_error',
  checkedParts:1,totalParts:173,checkedBytes:100}),/season_storage_audit_invalid/);
 await store.close();
});

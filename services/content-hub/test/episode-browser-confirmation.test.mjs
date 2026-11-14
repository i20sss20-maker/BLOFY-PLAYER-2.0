import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLease} from '../src/source-lease.mjs';

const runId='saleh_episode_127434_20261114';
class MockPg{
 static queries=[];
 static verified=true;
 static existing=true;
 constructor(){}
 async query(sql,params=[]){
  MockPg.queries.push({sql,params});
  if(sql.includes('CREATE TABLE IF NOT EXISTS'))return {rows:[]};
  if(sql.includes('INSERT INTO')&&
     sql.includes('blofy_content_hub_episode_browser_checks')){
   assert.match(sql,/state='verified'/);
   assert.deepEqual(params,[runId]);
   return MockPg.verified?{
    rows:[{confirmed_at:'2026-11-14T00:00:00Z'}],rowCount:1}:
    {rows:[],rowCount:0};
  }
  if(sql.includes('SELECT c.audio_confirmed')){
   assert.match(sql,/state='verified'/);
   assert.deepEqual(params,[runId]);
   return {rows:MockPg.existing?[{
    audio_confirmed:true,video_confirmed:true,
    confirmed_at:'2026-11-14T00:00:00Z'}]:[]};
  }
  throw Error('unexpected_query');
 }
 async end(){}
}
function store(){
 MockPg.queries=[];MockPg.verified=true;MockPg.existing=true;
 return createSourceLease({connectionString:'postgres://mock',Pool:MockPg});
}
test('browser AV confirmation is pinned to already verified episode only',async()=>{
 const lease=store();
 const result=await lease.confirmEpisodeBrowserPlayback(runId);
 assert.equal(result.confirmed,true);
 assert.equal(result.videoConfirmed,true);
 assert.equal(result.audioConfirmed,true);
 assert.ok(MockPg.queries.some(q=>q.sql.includes('REFERENCES blofy_content_hub_episode_runs(run_id)')));
 assert.equal((await lease.getEpisodeBrowserPlaybackStatus(runId)).confirmed,true);
 await lease.close();
});
test('browser AV confirmation fails for unverified or invalid run',async()=>{
 const lease=store();
 MockPg.verified=false;
 await assert.rejects(
  lease.confirmEpisodeBrowserPlayback(runId),/episode_browser_unverified_run/);
 await assert.rejects(
  lease.confirmEpisodeBrowserPlayback('../bad'),/episode_browser_run_invalid/);
 await lease.close();
});
test('no previous owner playback confirmation returns false',async()=>{
 const lease=store();
 MockPg.existing=false;
 const result=await lease.getEpisodeBrowserPlaybackStatus(runId);
 assert.equal(result.confirmed,false);
 assert.equal(result.videoConfirmed,false);
 assert.equal(result.audioConfirmed,false);
 await lease.close();
});

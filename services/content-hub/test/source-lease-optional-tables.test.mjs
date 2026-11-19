import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceLease} from '../src/source-lease.mjs';

const pilotRun='saleh_movie_20261120';
const episodeRun='saleh_episode_127434_20261114';

// All tests are isolated from production database and private media.
// These optional tables are created only when an operator starts a pilot.
function leaseWithSql(query) {
 const seen=[];
 class FakePool {
  async query(sql,params=[]){seen.push({sql,params});return query(sql,params);}
  async end(){}
 }
 return {lease:createSourceLease({
  connectionString:'postgres://fixture/test',Pool:FakePool
 }),seen};
}

test('opening operator dashboard before the first pilot returns empty data without missing-table ERROR',async()=>{
 const {lease,seen}=leaseWithSql(async(sql,params)=>{
  assert.equal(sql,'SELECT to_regclass($1) AS relation');
  assert.match(params[0],/^blofy_content_hub_(?:pilot_runs|episode_browser_checks|episode_runs)$/);
  return {rows:[{relation:null}]};
 });
 assert.equal(await lease.getPilotStatus(pilotRun),null);
 assert.equal(await lease.getVerifiedPilotObject(pilotRun),null);
 assert.deepEqual(await lease.storageAccounting(),{
  verifiedCount:0,verifiedBytes:0,activeCount:0,failedCount:0,
  scope:'verified_pilot_records_only'
 });
 assert.deepEqual(await lease.listPilotRuns({limit:20}),[]);
 assert.deepEqual(await lease.getEpisodeBrowserPlaybackStatus(episodeRun),{
  confirmed:false,audioConfirmed:false,videoConfirmed:false,confirmedAt:null
 });
 assert.deepEqual(await lease.listEpisodeRuns(),[]);
 assert.equal(seen.length,6);
 assert.ok(seen.every(x=>x.sql.includes('to_regclass')),
  'do not emit SQL against lazy tables until they exist');
 await lease.close();
});

test('if optional tables exist, original verified records and owner confirmations remain available',async()=>{
 const {lease,seen}=leaseWithSql(async(sql,params)=>{
  if(sql==='SELECT to_regclass($1) AS relation')return {rows:[{relation:params[0]}]};
  if(sql.includes('SELECT state,result_code'))return {rows:[{
   state:'verified',result_code:'pilot_verified',expected_bytes:'100',
   bytes_copied:'100',parts_copied:2,started_at:'2026-11-18',
   finished_at:'2026-11-19'
  }]};
  if(sql.includes('SELECT object_key,expected_bytes,verified_sha256'))return {rows:[{
   object_key:'saleh/movie/example.mp4',expected_bytes:'100',verified_sha256:'a'.repeat(64)
  }]};
  if(sql.includes("COUNT(*) FILTER (WHERE state='verified')"))return {rows:[{
   verified_count:1,verified_bytes:'100',active_count:0,failed_count:0
  }]};
  if(sql.includes('SELECT run_id FROM blofy_content_hub_pilot_runs'))return {rows:[
   {run_id:pilotRun}
  ]};
  if(sql.includes('SELECT c.audio_confirmed'))return {rows:[{
   audio_confirmed:true,video_confirmed:true,confirmed_at:'2026-11-19T10:00:00Z'
  }]};
  if(sql.includes('SELECT run_id,state,expected_bytes'))return {rows:[]};
  throw Error('unexpected fixture query: '+sql);
 });
 assert.equal((await lease.getPilotStatus(pilotRun)).state,'verified');
 assert.equal((await lease.getVerifiedPilotObject(pilotRun)).bytes,100);
 assert.equal((await lease.storageAccounting()).verifiedCount,1);
 assert.equal((await lease.listPilotRuns()).length,1);
 assert.equal((await lease.getEpisodeBrowserPlaybackStatus(episodeRun)).confirmed,true);
 assert.deepEqual(await lease.listEpisodeRuns(),[]);
 assert.ok(seen.some(x=>x.sql.includes('FROM blofy_content_hub_pilot_runs')));
 await lease.close();
});

test('table dropped after existence probe falls back to empty, other SQL errors are not swallowed',async()=>{
 const dropped=leaseWithSql(async(sql,params)=>{
  if(sql==='SELECT to_regclass($1) AS relation')return {rows:[{relation:params[0]}]};
  const err=Error('relation missing');err.code='42P01';throw err;
 });
 assert.equal(await dropped.lease.getPilotStatus(pilotRun),null);
 assert.equal(await dropped.lease.getVerifiedPilotObject(pilotRun),null);
 assert.deepEqual(await dropped.lease.listPilotRuns(),[]);
 assert.equal((await dropped.lease.storageAccounting()).verifiedCount,0);
 assert.equal((await dropped.lease.getEpisodeBrowserPlaybackStatus(episodeRun)).confirmed,false);
 await dropped.lease.close();

 const blocked=leaseWithSql(async()=>{
  const err=Error('permission denied');err.code='42501';throw err;
 });
 await assert.rejects(blocked.lease.storageAccounting(),/permission denied/);
 await blocked.lease.close();
});

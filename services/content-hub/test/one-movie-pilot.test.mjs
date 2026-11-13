import test from 'node:test';
import assert from 'node:assert/strict';
import {runOneMoviePilot} from '../src/one-movie-pilot.mjs';

test('one-movie pilot is off by default and does not request upstream media',async()=>{
 let operations=0;
 const result=await runOneMoviePilot({
  env:{},fetchImpl:async()=>{operations++;throw Error('unexpected network')},
  storage:{health:async()=>{operations++;return {ok:true}}},
  lease:{claimPilotRun:async()=>{operations++;return true}}
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'pilot_not_enabled');
 assert.equal(operations,0);
});
test('operator enables all independent safety and per-run controls',async()=>{
 let operations=0;
 const env={
  BLOFY_CONTENT_HUB_ONE_MOVIE_ON_BOOT:'1',
  BLOFY_CONTENT_HUB_UPLOAD_ENABLED:'1',
  BLOFY_CONTENT_HUB_STORAGE_RIGHTS_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_QUIET_WINDOW_CONFIRMED:'1',
  BLOFY_CONTENT_HUB_SOURCE_IDLE_CONFIRMED:'1'
 };
 const result=await runOneMoviePilot({
  env,fetchImpl:async()=>{operations++},
  storage:{health:async()=>{operations++}},
  lease:{claimPilotRun:async()=>{operations++}}
 });
 assert.equal(result.ok,false);
 assert.equal(result.code,'pilot_operator_configuration_missing');
 assert.equal(operations,0);
});

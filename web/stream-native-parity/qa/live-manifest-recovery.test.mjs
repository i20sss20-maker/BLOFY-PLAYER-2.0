import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const first=app.indexOf('function retryLiveHlsRequest(');
const end=app.indexOf('function playHls(',first);
assert.ok(first>=0&&end>first);
const retry=vm.runInNewContext(app.slice(first,end)+';retryLiveHlsRequest');
const manifest='/api/hls/live/test/ts/0/sid-test/index.m3u8';
test('initial manifest errors re-fetch the existing session rather than start absent levels',()=>{
 for(const details of ['manifestLoadError','manifestLoadTimeOut']){
  const calls=[];
  const engine={loadSource:u=>calls.push(['source',u]),startLoad:()=>calls.push(['start'])};
  assert.equal(retry(engine,manifest,{details}),true);
  assert.deepEqual(calls,[['source',manifest]]);
 }
});
test('fragment and level errors resume the existing engine without a new manifest or session',()=>{
 for(const details of ['fragLoadError','levelLoadError','levelLoadTimeOut']){
  const calls=[];
  assert.equal(retry({startLoad:()=>calls.push('start'),loadSource:()=>calls.push('source')},manifest,{details}),true);
  assert.deepEqual(calls,['start']);
 }
});
test('failed retry allows existing recovery fallback',()=>{
 assert.equal(retry(null,manifest,{}),false);
 assert.equal(retry({loadSource(){throw Error('failed')}},manifest,{details:'manifestLoadError'}),false);
 assert.equal(retry({startLoad(){throw Error('failed')}},manifest,{details:'levelLoadError'}),false);
});
test('all three LIVE retry branches use the helper, and only missing fragments get 404 live-edge recovery',()=>{
 const live=app.slice(end,app.indexOf('function durationSeconds(',end));
 assert.equal((live.match(/retryLiveHlsRequest\(engine,manifest,detail\)/g)||[]).length,3);
 assert.match(live,/code===404&&detail\.details==='fragLoadError'/);
 assert.match(live,/liveExpiredSegmentRecovery\(record,engine,video,Date\.now\(\)\)/);
});

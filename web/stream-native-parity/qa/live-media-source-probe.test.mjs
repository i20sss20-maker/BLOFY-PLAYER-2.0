import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../media-worker.ts',import.meta.url),'utf8');
const start=source.indexOf('function liveUpstreamFailure('),end=source.indexOf('function hlsError(',start);
assert.ok(start>=0&&end>start);
const {failure,budget}=vm.runInNewContext(source.slice(start,end)+';({failure:liveUpstreamFailure,budget:hlsProbeBudget})');
const json=x=>JSON.parse(JSON.stringify(x));
test('LIVE admission keeps 503 and 429 with bounded retry hints, not false codec errors',()=>{
 for(const status of [429,503]){
  assert.deepEqual(json(failure('live',status,{get:()=> '9'})),{error:'live_source_unavailable',status,retryAfterSeconds:9});
  for(const raw of ['999','0','1.5','bad',null])
   assert.equal(failure('live',status,{get:()=>raw}).retryAfterSeconds,5);
 }
 assert.equal(failure('movie',503,{get:()=> '9'}).status,502);
 assert.equal(failure('live',401,null).status,401);
});
test('probe only expanded for unknown/compatibility live input, copy and VOD unchanged',()=>{
 assert.equal(budget('live',false),'4000000');
 assert.equal(budget('live',true),'1200000');
 assert.equal(budget('movie',false),'1200000');
 assert.equal(budget('series',false),'1200000');
 assert.match(source,/-analyzeduration',probeBudget,'-probesize',probeBudget/);
});
test('missing video and invalid input feed existing bounded, isolated cooldown',()=>{
 const first=source.indexOf('function liveSourceRetryMs('),last=source.indexOf('function noteLiveSourceHealthy(',first);
 const entries=new Map();
 const api=vm.runInNewContext(source.slice(first,last)+';({record:recordLiveSourceFailure,wait:liveSourceRetryMs})',{liveSourceFailureWindows:entries,MAX_LIVE_SOURCE_WINDOWS:256});
 const session={kind:'live',sourceIdentity:'test-a',startedAt:1000};
 api.record(session,'source_missing_video',2000);
 assert.equal(api.wait('test-a',2000),1600);
 api.record(session,'invalid_source_data',5000);
 assert.equal(api.wait('test-a',5000),3200);
 api.record(session,'upstream_429',9000);
 assert.equal(api.wait('test-a',9000),6400);
 assert.equal(api.wait('test-b',9000),0);
 api.record({...session,kind:'movie',sourceIdentity:'test-movie'},'source_missing_video',9000);
 assert.equal(api.wait('test-movie',9000),0);
});
test('forward admission retry hint and close rejected response body',()=>{
 assert.match(source,/hlsError\(start\.status,start\.error,start\.retryAfterSeconds\|\|/);
 assert.match(source,/liveUpstreamFailure\(kind,status,upstream\.headers\);try\{await upstream\.body\?\.cancel\(\)/);
});

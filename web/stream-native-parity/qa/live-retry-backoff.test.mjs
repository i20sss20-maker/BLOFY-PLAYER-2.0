import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('function liveRetryDelayMs('),end=app.indexOf('function playHls(',start);
assert.ok(start>=0&&end>start);
const {delay,pending}=vm.runInNewContext(app.slice(start,end)+';({delay:liveRetryDelayMs,pending:liveRetryPending})');
test('honor bounded retry-after from XHR and Fetch, never shorten local backoff',()=>{
 assert.equal(delay(2400,{networkDetails:{getResponseHeader:()=> '8'}}),8000);
 assert.equal(delay(2400,{networkDetails:{headers:{get:()=> '30'}}}),30000);
 assert.equal(delay(10900,{networkDetails:{getResponseHeader:()=> '5'}}),10900);
});
test('ignore unsupported, malformed and excessive retry hints',()=>{
 for(const raw of ['0','31','600','-1','1.5','2e1','Wed, 25 Nov 2026','https://example.invalid',null])
  assert.equal(delay(2400,{networkDetails:{getResponseHeader:()=>raw}}),2400);
 assert.equal(delay(2400,{}),2400);
 assert.equal(delay(2400,{networkDetails:{getResponseHeader(){throw Error('header inaccessible')}}}),2400);
});
test('any active backoff prevents parallel recovery',()=>{
 assert.equal(pending({}),false);
 for(const key of ['capacityTimer','originTimer','retryTimer'])assert.equal(pending({[key]:1}),true);
 assert.equal(pending(null),false);
});
test('live error path preserves decoder on upstream failure and defers watchdog during backoff',()=>{
 const live=app.slice(end,app.indexOf('function durationSeconds(',end));
 assert.match(live,/if\(!record\.sourceFailure&&!record\.compat&&record\.recoveryAttempt>=2/);
 assert.match(live,/record\.sourceFailure=true;\s*record\.originRetries/);
 assert.match(live,/liveRetryDelayMs\(liveOriginRetryMs\(record\.originRetries\),detail\)/);
 assert.match(live,/liveRetryDelayMs\(liveCapacityRetryMs\(record\.capacityRetries\),detail\)/);
 assert.match(live,/var now=Date\.now\(\);\s*if\(liveRetryPending\(record\)\)return;\s*var intentionalPause/);
 assert.match(live,/record\.sourceFailure=false;/);
});

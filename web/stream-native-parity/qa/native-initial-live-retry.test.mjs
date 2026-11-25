import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const start=app.indexOf('function nativeInitialLiveRetryMs('),end=app.indexOf('function playHls(',start);
assert.ok(start>=0&&end>start);
const delay=vm.runInNewContext(app.slice(start,end)+';nativeInitialLiveRetryMs');
test('native ambiguous startup errors use bounded same-session backoff',()=>{
 for(const error of [2,3,4]){
  const record={kind:'live'};
  for(const expected of [3000,6500,12000,0]){
   assert.equal(delay(record,error),expected);
   record.nativeInitialRetries=(record.nativeInitialRetries||0)+1;
  }
 }
});
test('do not alter established playback, MSE or non-live paths',()=>{
 for(const r of [{kind:'movie'},{kind:'series'},{kind:'live',engine:{}},{kind:'live',ready:true},{kind:'live',framePresentationObserved:true}])
  assert.equal(delay(r,4),0);
 assert.equal(delay({kind:'live'},1),0);
});
test('retry is guarded, uses existing manifest and respects explicit user pause',()=>{
 const a=app.indexOf('var delay=nativeInitialLiveRetryMs(record,code)'),b=app.indexOf('var unsupported=',a);
 const handler=app.slice(a,b);
 assert.match(handler,/record\.originTimer=setTimeout/);
 assert.match(handler,/!alive\(\)\|\|!video\.isConnected/);
 assert.match(handler,/userPaused/);
 assert.match(handler,/video\.src=manifest;video\.load\(\)/);
 assert.doesNotMatch(handler,/fetch\(|freshPlaybackId\(|playHls\(|stopPlayback\(/);
});

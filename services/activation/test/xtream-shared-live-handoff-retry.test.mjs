import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedLiveHandoffDelay,waitSharedLiveHandoff} from '../src/xtream-shared-live-handoff-retry.mjs';
const allowed={status:503,reason:'fanout_source_handoff_pending',retryAfter:1,attempt:0,random:()=>0};
test('honor explicit relay release wait with bounded positive jitter',()=>{
 assert.equal(sharedLiveHandoffDelay(allowed),1000);
 assert.equal(sharedLiveHandoffDelay({...allowed,retryAfter:2,random:()=>1}),2150);
});
test('do not retry denial, source limit, cooldown, ambiguous failure, or second attempt',()=>{
 for(const patch of [{status:403},{status:502},{status:429},{reason:'fanout_source_channel_limit'},{reason:'fanout_source_cooling_down'},{reason:'licensed_fanout_unavailable'},{attempt:1},{retryAfter:0},{retryAfter:31},{retryAfter:NaN}]){
  assert.equal(sharedLiveHandoffDelay({...allowed,...patch}),null);
 }
});
test('cancel waiting immediately when viewer leaves',async()=>{
 const c=new AbortController();
 const wait=waitSharedLiveHandoff({...allowed,signal:c.signal});
 c.abort();assert.equal(await wait,false);
 assert.equal(await waitSharedLiveHandoff({...allowed,signal:c.signal}),false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayHealthTracker} from '../src/blofy-relay-health-tracker.mjs';
const start=1700000000000;
test('continuous observations accumulate evidence, duplicates do not extend it',()=>{
 let now=start;
 const t=createRelayHealthTracker({clock:()=>now});
 const put=()=>t.observe({hostbrr:{ok:false,observedAt:now},linode:{ok:true,observedAt:now}});
 put();for(let i=0;i<6;i++){now+=5000;put()}
 assert.equal(t.read().hostbrr.since,start);
 assert.equal(t.read().linode.observedAt,start+30000);
 now+=5000;
 t.observe({hostbrr:{ok:false,observedAt:start+30000},linode:{ok:true,observedAt:start+30000}});
 assert.equal(t.read().hostbrr.observedAt,start+30000);
});
test('unknown, expired, contradictory and out-of-order evidence fail closed',()=>{
 let now=start;
 const t=createRelayHealthTracker({clock:()=>now});
 t.observe({hostbrr:{ok:false,observedAt:now}});
 assert.equal(t.read().hostbrr.ok,false);
 t.observe({});assert.equal(t.read().hostbrr,undefined);
 t.observe({hostbrr:{ok:false,observedAt:now}});
 t.observe({hostbrr:{ok:true,observedAt:now}});
 assert.equal(t.read().hostbrr,undefined);
 t.observe({hostbrr:{ok:false,observedAt:now}});
 now+=11000;assert.equal(t.read().hostbrr,undefined);
 t.observe({hostbrr:{ok:false,observedAt:now}});
 assert.equal(t.read().hostbrr.since,now);
 t.observe({hostbrr:{ok:false,observedAt:now-1000}});
 assert.equal(t.read().hostbrr,undefined);
});
test('change of status restarts evidence period',()=>{
 let now=start;
 const t=createRelayHealthTracker({clock:()=>now});
 t.observe({linode:{ok:true,observedAt:now}});
 now+=5000;t.observe({linode:{ok:false,observedAt:now}});
 assert.equal(t.read().linode.since,now);
});

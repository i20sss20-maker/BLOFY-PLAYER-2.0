import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineReleaseCoordinator} from '../src/blofy-engine-release-coordinator.mjs';
const now=Date.parse('2026-11-26T16:00:00Z'),observedAt=new Date(now).toISOString();
const input={sourceId:'00000000-0000-4000-8000-000000000001',reservationId:'00000000-0000-4000-8000-000000000002',engineId:'hostbrr',channelId:'42'};
function harness({proof={},observation={},enabled=true,failStop=false}={}){
 const calls=[];
 const fn=createEngineReleaseCoordinator({env:{BLOFY_ENGINE_RELEASE_COORDINATOR:enabled?'1':'0',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:input.sourceId},clock:()=>now,
  ledger:{async transition(x){calls.push(x.next);return {ok:true,state:x.next}}},
  workers:{hostbrr:{async stopAndFence(){calls.push('stop');if(failStop)throw Error('lost');return {...input,status:'stopped_and_fenced',localSourceConnections:0,observedAt,...proof}}}},
  capacity:{async observe(){calls.push('observe');return {...input,scope:'all_paths',authoritative:true,activeConnections:0,maxConnections:1,observedAt,...observation}}}
 });
 return {calls,fn};
}
test('release only after committed fence, exact stop proof and authoritative zero connections',async()=>{
 const h=harness();assert.equal((await h.fn(input)).action,'released');assert.deepEqual(h.calls,['unknown','stop','observe','released']);
});
test('ambiguous stop, mismatched engine and unconfirmed provider never release',async()=>{
 for(const opts of [{failStop:true},{proof:{engineId:'linode'}},{observation:{activeConnections:1}},{observation:{scope:'local_only'}},{observation:{authoritative:false}},{observation:{observedAt:new Date(now-20000).toISOString()}}]){
  const h=harness(opts);assert.equal((await h.fn(input)).ok,false);assert.equal(h.calls.includes('released'),false);
 }
});
test('disabled by default does not touch ledger or workers',async()=>{
 const h=harness({enabled:false});assert.equal((await h.fn(input)).reason,'disabled');assert.deepEqual(h.calls,[]);
});

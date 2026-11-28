import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayHandoffCoordinator} from '../src/blofy-relay-handoff-coordinator.mjs';
const sourceId='11111111-1111-4111-8111-111111111111',now=1700000000000;
function fixture({owner='hostbrr',primaryHealthy=false,standbyHealthy=true,age=400000,openHolds=0,coverage=true,stopped=true,activeConnections=0,mode='legacy',enabled=true}={}){
 let state={ok:true,mode,owner,nextOwner:mode==='draining'?(owner==='hostbrr'?'linode':'hostbrr'):null,epoch:now-1000,openHolds};
 const calls=[];
 const opts={enabled,sourceId,clock:()=>now,
  readHealth:async()=>({hostbrr:{ok:primaryHealthy,observedAt:now,since:now-age},linode:{ok:standbyHealthy,observedAt:now,since:now-age}}),
  verifyCoverage:async({phase})=>{calls.push(phase);return coverage},
  stopPreviousOwner:async i=>{calls.push('stop:'+i.previousOwner);return stopped},
  observeProviderRelease:async i=>{calls.push('observe');return {...i,authoritative:true,scope:'all_paths',activeConnections,maxConnections:1,observedAt:now}},
  gate:{
    readRelayOwnerState:async()=>({...state}),
    beginRelayDrain:async({expectedOwner,nextOwner})=>{calls.push('begin');state={...state,mode:'draining',owner:expectedOwner,nextOwner,epoch:now};return {...state}},
    commitRelayOwner:async({expectedOwner,nextOwner,proof})=>{calls.push('commit');assert.equal(proof.previousOwner,expectedOwner);assert.equal(proof.drainStartedAt,state.epoch);state={...state,mode:'legacy',owner:nextOwner,nextOwner:null};return {ok:true}}
  }};
 return {calls,opts,run:createRelayHandoffCoordinator(opts),state:()=>state};
}
test('stable outage commits standby only after stop, zero holds and release',async()=>{
 const f=fixture();assert.deepEqual(await f.run(),{ok:true,action:'owner_committed',owner:'linode'});
 assert.deepEqual(f.calls,['preflight','begin','stop:hostbrr','drained','observe','commit']);
 assert.equal(f.state().owner,'linode');
});
test('primary return is delayed and independently fenced',async()=>{
 const early=fixture({owner:'linode',primaryHealthy:true,age:60000});
 assert.equal((await early.run()).reason,'no_stable_transition');
 const f=fixture({owner:'linode',primaryHealthy:true});
 assert.equal((await f.run()).owner,'hostbrr');
 assert.ok(f.calls.includes('stop:linode'));
});
test('no unverified transition or premature commit',async()=>{
 for(const [o,reason] of [[{coverage:false},'coverage_unconfirmed'],[{age:1000},'no_stable_transition'],[{stopped:false},'stop_unconfirmed'],[{openHolds:1},'holds_open'],[{activeConnections:1},'provider_release_unconfirmed'],[{enabled:false},'disabled']]){
  const f=fixture(o);assert.equal((await f.run()).reason,reason);assert.ok(!f.calls.includes('commit'));
 }
});
test('restarted coordinator resumes persisted drain without selecting a new destination',async()=>{
 const f=fixture({mode:'draining'});assert.equal((await f.run()).owner,'linode');assert.ok(!f.calls.includes('begin'));
});

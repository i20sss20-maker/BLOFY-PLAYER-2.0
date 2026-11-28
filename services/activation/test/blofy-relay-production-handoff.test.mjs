import test from 'node:test';
import assert from 'node:assert/strict';
import {createProductionRelayHandoff} from '../src/blofy-relay-production-handoff.mjs';
const sourceId='11111111-1111-4111-8111-111111111111';
function fixture(){
 let now=1700000000000,reads=0,commits=0,drains=0,stops=0;
 let state={ok:true,mode:'legacy',owner:'hostbrr',nextOwner:null,epoch:now-1000,openHolds:0};
 const env=Object.fromEntries(['BLOFY_RELAY_AUTO_HANDOFF','BLOFY_ENGINE_LEGACY_INGRESS_GATE','BLOFY_ENGINE_RELAY_HOLDS',
 'BLOFY_RELAY_ENGINE_OWNERSHIP','BLOFY_RELAY_OWNER_ROUTING','BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER'].map(k=>[k,'1']));
 env.BLOFY_RELAY_APPROVED_PROVIDER_QUOTA='5';
 const gate={readRelayOwnerState:async()=>({...state}),beginRelayDrain:async({expectedOwner,nextOwner})=>{
   drains++;assert.equal(expectedOwner,state.owner);state={...state,mode:'draining',nextOwner,epoch:now};return {...state};
  },commitRelayOwner:async({expectedOwner,nextOwner,proof})=>{
   assert.equal(expectedOwner,state.owner);assert.equal(proof.maxConnections,5);
   assert.equal(proof.activeConnections,0);assert.equal(proof.drainStartedAt,state.epoch);
   commits++;state={...state,mode:'legacy',owner:nextOwner,nextOwner:null};return {ok:true};
  }};
 const opts={env,clock:()=>now,readApproved:async()=>({sourceId,reportedMaxConnections:5}),
  createGate:o=>{assert.equal(o.expectedRelayMaxConnections,5);assert.equal(o.sourceId,sourceId);return gate},
  readPair:async()=>({hostbrr:{ok:false},linode:{ok:true}}),
  verifyCoverage:async()=>true,stopPreviousOwner:async()=>{stops++;return true},
  readProviderAccount:async id=>{assert.equal(id,sourceId);reads++;return {activeConnections:0,maxConnections:5}}};
 return {opts,env,advance:ms=>{now+=ms},counts:()=>({reads,commits,drains,stops})};
}
test('production composition is default off and rejects missing flags or adapters without provider reads',async()=>{
 for(const [key,value,reason] of [['BLOFY_RELAY_AUTO_HANDOFF','0','disabled'],['BLOFY_RELAY_OWNER_ROUTING','0','production_flags_incomplete'],['BLOFY_RELAY_APPROVED_PROVIDER_QUOTA','','source_capacity_unconfirmed']]){
  const f=fixture();f.env[key]=value;assert.equal((await createProductionRelayHandoff(f.opts)()).reason,reason);
  assert.deepEqual(f.counts(),{reads:0,commits:0,drains:0,stops:0});
 }
 const f=fixture();delete f.opts.verifyCoverage;
 assert.equal((await createProductionRelayHandoff(f.opts)()).reason,'trusted_adapters_missing');
 assert.equal(f.counts().reads,0);
});
test('production composition keeps a continuous health window and checks fresh provider only after drain',async()=>{
 const f=fixture();const tick=createProductionRelayHandoff(f.opts);
 for(let i=0;i<6;i++){assert.equal((await tick()).reason,'no_stable_transition');f.advance(5000)}
 assert.deepEqual(f.counts(),{reads:0,commits:0,drains:0,stops:0});
 assert.deepEqual(await tick(),{ok:true,action:'owner_committed',owner:'linode'});
 assert.deepEqual(f.counts(),{reads:1,commits:1,drains:1,stops:1});
});
test('missing coverage blocks even drain, and a changed licensed quota stops a running composition',async()=>{
 const f=fixture();f.opts.verifyCoverage=async()=>false;const tick=createProductionRelayHandoff(f.opts);
 assert.equal((await tick()).reason,'coverage_unconfirmed');
 assert.deepEqual(f.counts(),{reads:0,commits:0,drains:0,stops:0});
 f.env.BLOFY_RELAY_APPROVED_PROVIDER_QUOTA='6';
 assert.equal((await tick()).reason,'source_capacity_unconfirmed');
});

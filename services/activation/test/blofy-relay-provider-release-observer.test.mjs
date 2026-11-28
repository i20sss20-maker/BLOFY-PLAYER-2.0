import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayProviderReleaseObserver} from '../src/blofy-relay-provider-release-observer.mjs';
const sourceId='11111111-1111-4111-8111-111111111111',now=1700000000000;
const identity={sourceId,previousOwner:'hostbrr',nextOwner:'linode',drainStartedAt:now-2000};
function fixture(){
 let at=now,reads=0;
 const opts={sourceId,expectedRelayMaxConnections:5,clock:()=>at,
  readApprovedSource:async()=>({sourceId,reportedMaxConnections:5}),
  readOwnerState:async()=>({ok:true,mode:'draining',owner:'hostbrr',nextOwner:'linode',epoch:identity.drainStartedAt,openHolds:0}),
  verifyCoverage:async()=>true,readProviderAccount:async()=>{reads++;return {activeConnections:0,maxConnections:5}}};
 return {opts,reads:()=>reads,setTime:x=>{at=x}};
}
test('fresh account read and independently verified coverage yield exact release proof',async()=>{
 const f=fixture();
 const r=await createRelayProviderReleaseObserver(f.opts)(identity);
 assert.deepEqual(r,{sourceId,previousOwner:'hostbrr',drainStartedAt:identity.drainStartedAt,activeConnections:0,maxConnections:5,observedAt:now,authoritative:true,scope:'all_paths'});
 assert.equal(f.reads(),1);
});
test('no provider read without approval, closed holds or coverage',async()=>{
 for(const change of [{verifyCoverage:undefined},{verifyCoverage:async()=>false},
  {readOwnerState:async()=>({ok:true,mode:'legacy'})},
  {readApprovedSource:async()=>({sourceId,reportedMaxConnections:1})}]){
  const f=fixture();Object.assign(f.opts,change);
  assert.equal(await createRelayProviderReleaseObserver(f.opts)(identity),null);
  assert.equal(f.reads(),0);
 }
});
test('nonzero or malformed provider counts, errors and slow observations are rejected',async()=>{
 for(const counts of [{activeConnections:1,maxConnections:5},{activeConnections:0,maxConnections:1},{activeConnections:'0',maxConnections:5},null]){
  const f=fixture();f.opts.readProviderAccount=async()=>counts;
  assert.equal(await createRelayProviderReleaseObserver(f.opts)(identity),null);
 }
 for(const slow of [false,true]){
  const f=fixture();f.opts.readProviderAccount=async()=>{if(!slow)throw Error('provider');f.setTime(now+7001);return {activeConnections:0,maxConnections:5}};
  assert.equal(await createRelayProviderReleaseObserver(f.opts)(identity),null);
 }
});
test('ownership or coverage changes during provider read invalidate the observation',async()=>{
 for(const key of ['readOwnerState','verifyCoverage','readApprovedSource']){
  const f=fixture();const original=f.opts[key];let calls=0;
  f.opts[key]=async x=>++calls===1?original(x):null;
  assert.equal(await createRelayProviderReleaseObserver(f.opts)(identity),null);
  assert.equal(f.reads(),1);
 }
});

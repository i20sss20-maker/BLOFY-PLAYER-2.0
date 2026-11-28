import test from 'node:test';
import assert from 'node:assert/strict';
import {createLeaseHandoffStart} from '../src/blofy-engine-lease-handoff-start.mjs';
const now=1700000000000;
const sourceId='11111111-1111-4111-8111-111111111111',requestId='22222222-2222-4222-8222-222222222222',fromReservationId='33333333-3333-4333-8333-333333333333',reservationId='44444444-4444-4444-8444-444444444444';
const request={sourceId,requestId,channelId:'42',authorized:true,expiresAt:now+60000};
const input={request,engineId:'linode',handoff:{fromReservationId,fromEngineId:'hostbrr',proof:{sourceId}}};
const identity={sourceId,channelId:'42',engineId:'linode',reservationId,generation:reservationId.replaceAll('-','')};
function fixture({proof,ownership,reserve,commit,enabled=true}={}){
 let time=now,calls=[];
 const fn=createLeaseHandoffStart({enabled,clock:()=>time,timeoutMs:1000,pollMs:250,sleep:async ms=>{time+=ms},
  ledger:{reserve:async x=>{calls.push('reserve');assert.equal(x.handoff.fromReservationId,fromReservationId);return reserve??{ok:true,state:'pending',action:'start_once',reservationId}},
   readRoutingState:async()=>{calls.push('owner');return ownership??{...identity,state:'pending'}},
   markLeaseReady:async x=>{calls.push('ready');assert.equal(x.reservationId,reservationId);return commit??{ok:true,state:'ready',generation:identity.generation}}},
  readProof:async()=>{calls.push('proof');return proof===undefined?{...identity,observedAt:time,lastSegment:3}:proof}});
 return {fn,calls};
}
test('commits readiness only after exact fresh worker proof',async()=>{
 const f=fixture();assert.deepEqual(await f.fn(input),{ok:true,action:'feed_ready',...identity});assert.deepEqual(f.calls,['reserve','owner','proof','ready']);
});
test('invalid proof times out and never releases or starts again',async()=>{
 for(const proof of [null,{...identity,observedAt:now-20000,lastSegment:3},{...identity,engineId:'hostbrr',observedAt:now,lastSegment:3}]){
  const f=fixture({proof});assert.equal((await f.fn(input)).reason,'lease_start_timeout');assert.equal(f.calls.filter(x=>x==='reserve').length,1);assert.equal(f.calls.includes('ready'),false);
 }
});
test('does not act on duplicate reservations or changed ownership',async()=>{
 let f=fixture({reserve:{ok:true,action:'existing',state:'pending',reservationId}});assert.equal((await f.fn(input)).reason,'lease_reservation_not_new');assert.deepEqual(f.calls,['reserve']);
 f=fixture({ownership:{...identity,engineId:'hostbrr',state:'pending'}});assert.equal((await f.fn(input)).reason,'lease_ownership_changed');assert.deepEqual(f.calls,['reserve','owner']);
});
test('disabled, unauthorized or initial cutover cannot invoke handoff',async()=>{
 let f=fixture({enabled:false});assert.equal((await f.fn(input)).reason,'lease_start_disabled');assert.deepEqual(f.calls,[]);
 f=fixture();assert.equal((await f.fn({...input,handoff:null})).reason,'lease_handoff_required');
 assert.equal((await f.fn({...input,request:{...request,expiresAt:now}})).reason,'lease_start_unauthorized');assert.deepEqual(f.calls,[]);
});
test('failed readiness commit is not a successful start',async()=>{
 const f=fixture({commit:{ok:false}});assert.equal((await f.fn(input)).reason,'lease_ready_not_committed');assert.deepEqual(f.calls,['reserve','owner','proof','ready']);
});

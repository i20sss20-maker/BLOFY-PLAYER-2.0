import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineFailoverRunner} from '../src/blofy-engine-failover-runner.mjs';
import {createEngineRouteCoordinator} from '../src/blofy-engine-route-coordinator.mjs';
const now=1700000000000;
const original={requestId:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',accountId:'33333333-3333-4333-8333-333333333333',channelId:'10',authorized:true,expiresAt:now+60000};
const fresh={...original,requestId:'44444444-4444-4444-8444-444444444444'};
const retry={ok:false,action:'retry_with_fresh_snapshot'};
const run=(options)=>createEngineFailoverRunner({enabled:true,clock:()=>now,renewAuthorization:async()=>fresh,...options});
test('disabled, expired and ambiguous requests do not retry',async()=>{
 let calls=0,renewals=0;
 const route=async()=>{calls++;return {ok:false,action:'hold',reason:'execution_unknown'}};
 const renewAuthorization=async()=>{renewals++;return fresh};
 assert.equal((await run({route,renewAuthorization,enabled:false})(original)).reason,'failover_disabled');
 assert.equal((await run({route,renewAuthorization})({...original,expiresAt:now})).reason,'request_unauthorized');
 assert.equal((await run({route,renewAuthorization})(original)).reason,'execution_unknown');
 assert.equal(calls,1);assert.equal(renewals,0);
});
test('rejects a reused claim, changed identity or expired renewed authorization',async()=>{
 for(const next of [original,{...fresh,channelId:'11'},{...fresh,accountId:fresh.requestId},{...fresh,sourceId:fresh.requestId},{...fresh,expiresAt:now}]){
  let calls=0;
  const result=await run({route:async()=>{calls++;return retry},renewAuthorization:async()=>next})(original);
  assert.equal(result.reason,'reauthorization_invalid');assert.equal(calls,1);
 }
});
test('at most two attempts, no loop after another release',async()=>{
 let calls=0;const result=await run({route:async()=>{calls++;return retry}})(original);
 assert.equal(result.reason,'failover_retry_budget_exhausted');assert.equal(calls,2);
});
test('does not renew after original authorization expires during release',async()=>{
 let clock=now,renewals=0;
 const result=await run({clock:()=>clock,route:async()=>{clock=original.expiresAt;return retry},renewAuthorization:async()=>{renewals++;return fresh}})(original);
 assert.equal(result.reason,'authorization_expired_after_release');assert.equal(renewals,0);
});
test('uses fresh ledger state after confirmed HostBrr release before choosing Linode',async()=>{
 const calls=[],claims=new Set();
 let feed={sourceId:original.sourceId,state:'ready',engineId:'hostbrr',reservationId:'old',generation:'g',channelId:'10'};
 const good={authenticated:true,observedAt:now,deliveryActive:true,heartbeatActive:true,activeViewers:0,viewerLimit:150};
 const route=createEngineRouteCoordinator({enabled:true,clock:()=>now,
  claims:{claim:async({requestId})=>{if(claims.has(requestId))return {acquired:false};claims.add(requestId);return {acquired:true,token:requestId}},finish:async()=>true},
  ledger:{readRoutingState:async()=>feed},
  readSnapshot:async()=>{calls.push('snapshot');return {entitlement:{sourceId:original.sourceId,redistributionAllowed:true,expiresAt:now+60000},workers:{hostbrr:{...good,deliveryActive:false},linode:good},capacity:{sourceId:original.sourceId,authoritative:true,scope:'all_paths',activeConnections:0,maxConnections:1,observedAt:now},sourceIngressMode:'engine'}},
  release:async ids=>{calls.push('release');feed={...feed,state:'released',releaseConfirmed:true};return {ok:true,action:'released',...ids}},
  start:async({request,engineId,handoff})=>{calls.push('start');assert.equal(engineId,'linode');assert.equal(request.requestId,fresh.requestId);assert.equal(handoff.fromReservationId,'old');return {ok:true,action:'feed_ready',sourceId:request.sourceId,channelId:request.channelId,engineId,reservationId:'new'}}
 });
 const result=await run({route})(original);
 assert.equal(result.ok,true);assert.equal(result.engineId,'linode');
 assert.deepEqual(calls,['snapshot','release','snapshot','start']);
});

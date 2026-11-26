import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineRouteCoordinator} from '../src/blofy-engine-route-coordinator.mjs';
const now=1700000000000;
const request={requestId:'attempt-1',sourceId:'s',channelId:'10',authorized:true,expiresAt:now+60000};
function fixture(state='empty'){
 const calls=[],claimed=new Set();
 const snapshot={entitlement:{sourceId:'s',redistributionAllowed:true,expiresAt:now+60000},feed:{sourceId:'s',state},capacity:{sourceId:'s',authoritative:true,scope:'all_paths',activeConnections:0,maxConnections:1,observedAt:now},workers:{hostbrr:{authenticated:true,observedAt:now,deliveryActive:true,heartbeatActive:true,activeViewers:0,viewerLimit:10}}};
 if(state==='ready')Object.assign(snapshot.feed,{engineId:'hostbrr',reservationId:'r',channelId:'10',generation:'g'});
 const opts={enabled:true,clock:()=>now,readSnapshot:async()=>snapshot,ledger:{readRoutingState:async()=>snapshot.feed},claims:{claim:async({requestId})=>{if(claimed.has(requestId))return {acquired:false};claimed.add(requestId);return {acquired:true,token:requestId}},finish:async()=>true},start:async()=>{calls.push('start');return {ok:true,action:'feed_ready',sourceId:'s',channelId:'10',engineId:'hostbrr',reservationId:'r'}},release:async()=>{calls.push('release');return {ok:true,action:'released',sourceId:'s',engineId:'hostbrr',reservationId:'r'}},attach:async()=>{calls.push('attach');return {ok:true}}};
 return {opts,calls,snapshot};
}
test('only one start for a concurrent duplicate',async()=>{const {opts,calls}=fixture();const route=createEngineRouteCoordinator(opts);const results=await Promise.all([route(request),route(request)]);assert.equal(results.filter(r=>r.ok).length,1);assert.deepEqual(calls,['start'])});
test('ready feed attaches; unhealthy feed requests release only',async()=>{let f=fixture('ready');assert.equal((await createEngineRouteCoordinator(f.opts)(request)).action,'attached');assert.deepEqual(f.calls,['attach']);f=fixture('ready');f.snapshot.workers.hostbrr.deliveryActive=false;assert.equal((await createEngineRouteCoordinator(f.opts)(request)).action,'retry_with_fresh_snapshot');assert.deepEqual(f.calls,['release'])});
test('unknown execution holds claim and prevents redispatch',async()=>{const {opts,calls}=fixture();opts.start=async()=>{calls.push('start');throw Error('uncertain')};const route=createEngineRouteCoordinator(opts);assert.equal((await route(request)).reason,'execution_unknown');assert.equal((await route(request)).reason,'already_claimed');assert.deepEqual(calls,['start'])});
test('disabled or unconfirmed capacity never dispatches',async()=>{const f=fixture();assert.equal((await createEngineRouteCoordinator({...f.opts,enabled:false})(request)).reason,'disabled');f.snapshot.capacity.activeConnections=1;assert.equal((await createEngineRouteCoordinator(f.opts)(request)).reason,'capacity_unconfirmed');assert.deepEqual(f.calls,[])});

test('ledger state overrides a contradictory telemetry snapshot',async()=>{const f=fixture();f.opts.ledger.readRoutingState=async()=>({sourceId:'s',state:'unknown'});assert.equal((await createEngineRouteCoordinator(f.opts)(request)).reason,'reservation_unresolved');assert.deepEqual(f.calls,[])});

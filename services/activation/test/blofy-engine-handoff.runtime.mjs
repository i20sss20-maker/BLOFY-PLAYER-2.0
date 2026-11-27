import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import pg from 'pg';
import {ensureEngineIngressGate,createEngineIngressGate} from '../src/blofy-engine-ingress-gate.mjs';
import {ensureLinodeFeedLedger,createLinodeFeedLedger} from '../src/linode-feed-ledger.mjs';
import {createEngineRouteCoordinator} from '../src/blofy-engine-route-coordinator.mjs';

test('confirmed release transfers one source slot and lease to Linode',{timeout:30000},async()=>{
 const url=process.env.BLOFY_HANDOFF_TEST_DATABASE_URL;
 assert.equal(url,'postgresql://blofy:blofy_test@127.0.0.1:5432/blofy_engine_shadow_test');
 const pool=new pg.Pool({connectionString:url,ssl:false,max:8});
 try{
  await ensureLinodeFeedLedger(pool);
  await ensureEngineIngressGate(pool);
  const sourceId=randomUUID(),channelId='123',engineId='hostbrr';
  const env={BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_HOSTBRR_FEED_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId,BLOFY_ENGINE_RENEWABLE_LEASE:'1'};
  const ledger=createLinodeFeedLedger(pool,env);
  const ingress=createEngineIngressGate(pool,{sourceId,enabled:true});
  assert.equal((await ingress.initialize()).ok,true);
  const legacyHold=randomUUID();
  assert.equal((await ingress.enterLegacy(legacyHold)).ok,true);
  const {reservationId}=await ledger.reserve({sourceId,channelId,engineId,requestId:randomUUID()});
  assert.equal((await ingress.beginDrain()).ok,true);
  const capacity=()=>({sourceId,authoritative:true,scope:'all_paths',activeConnections:0,maxConnections:1,observedAt:Date.now()});
  const {drainStartedAt,openHoldIds}=await ingress.readDrain({includeOpenHoldIds:true});
  assert.deepEqual(openHoldIds,[legacyHold]);
  const cutover={engineId,reservationId,legacyHoldsToReconcile:openHoldIds,proof:{...capacity(),drainStartedAt}};
  assert.equal((await ingress.promote({...cutover,proof:{...cutover.proof,activeConnections:1}})).reason,'external_fence_unconfirmed');
  assert.equal((await ingress.promote({...cutover,proof:{...cutover.proof,drainStartedAt:drainStartedAt-1000}})).reason,'legacy_holds_open');
  assert.equal((await ingress.promote({...cutover,legacyHoldsToReconcile:[randomUUID()]})).reason,'legacy_hold_snapshot_changed');
  assert.equal((await ingress.readDrain()).registeredLegacyHolds,1);
  assert.deepEqual(await ingress.promote(cutover),{ok:true,mode:'engine',reconciledLegacyHolds:1});
  const {rows:[closed]}=await pool.query('SELECT closed,closed_at FROM blofy_engine_legacy_holds WHERE hold_id=$1',[legacyHold]);
  assert.equal(closed.closed,true);
  assert.ok(closed.closed_at instanceof Date);
  const owner={sourceId,channelId,engineId,reservationId};
  const switched={sourceId,channelId,requestId:randomUUID(),engineId:'linode'};
  const handoff=()=>({fromReservationId:reservationId,fromEngineId:engineId,proof:capacity()});
  assert.equal((await ledger.reserve({...switched,handoff:handoff()})).reason,'feed_occupied_or_uncertain');
  await ledger.transition({...owner,next:'unknown'});
  assert.equal((await ledger.reserve({...switched,handoff:handoff()})).reason,'feed_occupied_or_uncertain');
  assert.equal((await ledger.transition({...owner,next:'released',releaseConfirmed:true})).ok,true);
  const healthy=()=>({authenticated:true,observedAt:Date.now(),deliveryActive:true,heartbeatActive:true,activeViewers:0,viewerLimit:150});
  let winner;
  const route=createEngineRouteCoordinator({
   claims:{claim:async()=>({acquired:true,token:'test'}),finish:async()=>true},ledger,enabled:true,
   readSnapshot:async()=>({sourceIngressMode:'engine',workers:{linode:healthy()},
    entitlement:{sourceId,redistributionAllowed:true,expiresAt:Date.now()+10000},capacity:capacity()}),
   start:async({request,engineId,handoff})=>{
    const args={sourceId,channelId,requestId:request.requestId,engineId,handoff};
    const results=await Promise.all(Array.from({length:16},()=>ledger.reserve(args)));
    assert.equal(results.filter(x=>x.action==='start_once').length,1);
    assert.equal(results.filter(x=>x.action==='existing').length,15);
    winner=results.find(x=>x.action==='start_once');
    return {ok:true,action:'feed_ready',sourceId,channelId,engineId,reservationId:winner.reservationId};
   }
  });
  const result=await route({sourceId,channelId,requestId:switched.requestId,authorized:true,expiresAt:Date.now()+10000});
  assert.equal(result.ok,true);
  assert.equal(result.engineId,'linode');
  assert.equal((await ingress.enterLegacy(randomUUID())).reason,'legacy_fenced');
  assert.equal(await ingress.readFence(owner),null);
  const target={sourceId,channelId,engineId:'linode',reservationId:winner.reservationId};
  const fence={...target,...capacity(),expiresAt:Date.now()+60000};
  const {privateKey}=generateKeyPairSync('ed25519');
  assert.equal((await ledger.issueWorkerLease({...owner,fence,signingKey:privateKey})).ok,false);
  const granted=await ledger.issueWorkerLease({...target,fence,signingKey:privateKey});
  assert.equal(granted.ok,true);
  assert.equal(granted.lease.sequence,1);
  assert.equal((await ledger.claimWorkerLease({...owner,fence})).ok,false);
  assert.equal((await ledger.claimWorkerLease({...target,fence:{...fence,scope:'local'}})).ok,false);
  const claim=await ledger.claimWorkerLease({...target,fence});
  assert.equal(claim.ok,true);
  assert.equal(claim.lease.sequence,2);
  assert.equal(claim.lease.reservationId,target.reservationId);
  assert.equal(claim.signature,undefined);
  const renewed=await ledger.issueWorkerLease({...target,fence,signingKey:privateKey});
  assert.equal(renewed.lease.sequence,3);
  assert.equal((await ingress.restoreLegacy()).reason,'engine_release_unconfirmed');
 }finally{await pool.end();}
});

test('initial drain atomically reserves and reconciles only with fresh exact evidence',{timeout:30000},async()=>{
 const url=process.env.BLOFY_HANDOFF_TEST_DATABASE_URL;
 assert.equal(url,'postgresql://blofy:blofy_test@127.0.0.1:5432/blofy_engine_shadow_test');
 const pool=new pg.Pool({connectionString:url,ssl:false,max:8});
 const sourceId=randomUUID(),channelId='456',engineId='hostbrr';
 try{
  await ensureLinodeFeedLedger(pool);
  await ensureEngineIngressGate(pool);
  const env={BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_HOSTBRR_FEED_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId,BLOFY_ENGINE_RENEWABLE_LEASE:'1'};
  const ledger=createLinodeFeedLedger(pool,env);
  const ingress=createEngineIngressGate(pool,{sourceId,enabled:true});
  assert.equal((await ingress.initialize()).ok,true);
  const holdId=randomUUID();
  assert.equal((await ingress.enterLegacy(holdId)).ok,true);
  assert.equal((await ingress.beginDrain()).ok,true);
  const {drainStartedAt,openHoldIds}=await ingress.readDrain({includeOpenHoldIds:true});
  const capacity=()=>({sourceId,scope:'all_paths',authoritative:true,activeConnections:0,maxConnections:1,observedAt:Date.now(),drainStartedAt});
  const args={sourceId,channelId,engineId,requestId:randomUUID()};
  const reserve=(proof=capacity(),ids=openHoldIds)=>ledger.reserve({...args,initialDrain:{proof,openHoldIds:ids}});
  assert.equal((await reserve({...capacity(),activeConnections:1})).reason,'initial_drain_unconfirmed');
  assert.equal((await reserve({...capacity(),drainStartedAt:drainStartedAt-1})).reason,'initial_drain_unconfirmed');
  assert.equal((await reserve(capacity(),[randomUUID()])).reason,'initial_drain_hold_snapshot_changed');
  assert.equal((await ledger.readRoutingState({sourceId})).state,'empty');
  assert.equal((await ingress.readDrain()).registeredLegacyHolds,1);
  assert.equal((await ingress.cancelDrain({expectedDrainStartedAt:drainStartedAt-1})).reason,'drain_epoch_changed');
  assert.equal((await ingress.readMode()).mode,'draining');
  assert.equal((await ingress.cancelDrain({expectedDrainStartedAt:drainStartedAt})).ok,true);
  assert.equal((await ingress.beginDrain()).ok,true);
  const fresh=await ingress.readDrain({includeOpenHoldIds:true});
  const proof={...capacity(),drainStartedAt:fresh.drainStartedAt};
  const results=await Promise.all(Array.from({length:16},()=>reserve(proof,fresh.openHoldIds)));
  assert.equal(results.filter(x=>x.action==='start_once').length,1);
  assert.equal(results.filter(x=>x.action==='existing').length,15);
  const winner=results.find(x=>x.action==='start_once');
  assert.equal((await ingress.readMode()).mode,'engine');
  assert.equal((await ingress.readDrain()).registeredLegacyHolds,0);
  const row=(await pool.query('SELECT state,worker_lease_sequence FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId])).rows[0];
  assert.equal(row.state,'pending');
  assert.equal(Number(row.worker_lease_sequence),0);
  assert.ok(await ingress.readFence({sourceId,engineId,reservationId:winner.reservationId}));
  assert.equal((await ingress.enterLegacy(randomUUID())).reason,'legacy_fenced');
  const identity={sourceId,engineId,reservationId:winner.reservationId};
  const releaseProof=()=>({...identity,authoritative:true,scope:'all_paths',activeConnections:0,exclusiveLeaseStartup:true,workerStopped:true,observedAt:Date.now()});
  assert.equal((await ledger.rollbackUnissuedInitial({...identity,proof:{...releaseProof(),activeConnections:1}})).reason,'rollback_release_unconfirmed');
  assert.equal((await ingress.readMode()).mode,'engine');
  assert.deepEqual(await ledger.rollbackUnissuedInitial({...identity,proof:releaseProof()}),{ok:true,mode:'legacy',state:'released'});
  assert.equal((await ledger.readRoutingState({sourceId})).state,'released');
  assert.equal((await ingress.enterLegacy(randomUUID())).ok,true);
 }finally{
  await pool.query('DELETE FROM blofy_engine_legacy_holds WHERE source_id=$1',[sourceId]);
  await pool.query('DELETE FROM blofy_engine_ingress_gate WHERE source_id=$1',[sourceId]);
  await pool.query('DELETE FROM blofy_linode_feed_ledger WHERE source_id=$1',[sourceId]);
  await pool.query('DELETE FROM blofy_linode_feed_requests WHERE source_id=$1',[sourceId]);
  await pool.end();
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {verifyLiveLease} from '../src/blofy-live-worker-lease.mjs';
import {ensureEngineIngressGate,createEngineIngressGate} from '../src/blofy-engine-ingress-gate.mjs';
import pg from 'pg';
import {ensureEngineRouteClaims,createEngineRouteClaims} from '../src/blofy-engine-route-claims.mjs';
import {createEngineRouteCoordinator} from '../src/blofy-engine-route-coordinator.mjs';
import {ensureLinodeFeedLedger,createLinodeFeedLedger} from '../src/linode-feed-ledger.mjs';

// Only the disposable CI database, never DATABASE_URL or production.
const options={host:'127.0.0.1',port:5432,database:'blofy_ledger_qa',
 user:'blofy_qa',password:'blofy_qa_local_only',connectionTimeoutMillis:5000};
test('concurrent reservations, restart persistence and release fencing',{timeout:60000},async()=>{
 const admin=new pg.Pool({...options,max:1});
 const schema='qa_'+randomUUID().replaceAll('-','');
 let pool;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  pool=new pg.Pool({...options,options:'-c search_path='+schema,max:12});
  await ensureLinodeFeedLedger(pool);
  const sourceId=randomUUID(),requestId=randomUUID();
  const env={BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_HOSTBRR_FEED_LEDGER:'1',BLOFY_LINODE_VIEWER_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId};
  const ledger=createLinodeFeedLedger(pool,env);
  const args={sourceId,channelId:'123',requestId};
  assert.deepEqual(await ledger.readRoutingState({sourceId}),{sourceId,state:'empty'});
  assert.equal(await ledger.readRoutingState({sourceId:randomUUID()}),null);
  const all=await Promise.all(Array.from({length:30},()=>ledger.reserve(args)));
  assert.equal(all.filter(x=>x.action==='start_once').length,1);
  assert.equal(all.filter(x=>x.action==='existing').length,29);
  const reservationId=all[0].reservationId;
  assert.ok(all.every(x=>x.reservationId===reservationId));
  const conflict=await Promise.all(Array.from({length:20},()=>ledger.reserve({...args,channelId:'124',requestId:randomUUID()})));
  assert.ok(conflict.every(x=>!x.ok));
  const hostConflicts=await Promise.all(Array.from({length:20},()=>ledger.reserve({...args,engineId:'hostbrr'})));
  assert.ok(hostConflicts.every(x=>!x.ok));
  await pool.end();
  pool=new pg.Pool({...options,options:'-c search_path='+schema,max:12});
  const restored=createLinodeFeedLedger(pool,env);
  assert.equal((await restored.reserve(args)).action,'existing');
  const t={sourceId,reservationId};
  const generation=randomUUID().replaceAll('-','');
  assert.equal((await restored.findReady(args)).ok,false);
  assert.equal((await restored.transition({...t,next:'ready',generation})).ok,true);
  assert.deepEqual(await restored.readRoutingState({sourceId}),{sourceId,state:'ready',engineId:'linode',channelId:'123',reservationId,generation,releaseConfirmed:false});
  const join=await Promise.all(Array.from({length:30},()=>restored.findReady(args)));
  assert.ok(join.every(x=>x.ok&&x.reservationId===reservationId&&x.generation===generation&&x.requestId===requestId));
  assert.equal((await restored.findReady({...args,channelId:'124'})).ok,false);
  assert.equal((await restored.findReady({...args,engineId:'hostbrr'})).ok,false);
  const {rows:[feedCount]}=await pool.query('SELECT count(*)::int AS n FROM blofy_linode_feed_ledger');
  assert.equal(feedCount.n,1);
  const viewer={...t,channelId:'123',generation,sessionId:randomUUID(),accountId:randomUUID(),
    accountQuota:1,authorizedUntil:new Date(Date.now()+120000).toISOString()};
  assert.equal((await restored.attachViewer({...viewer,engineId:'hostbrr'})).ok,false);
  assert.equal((await restored.transition({...t,engineId:'hostbrr',next:'released',releaseConfirmed:true})).ok,false);
  const firstGrant=await restored.attachViewer(viewer);
  assert.equal(firstGrant.ok,true);
  const shortGrant=await restored.attachViewer({...viewer,authorizedUntil:new Date(Date.now()+20000).toISOString()});
  assert.equal(shortGrant.ok,true);
  assert.ok(Date.parse(shortGrant.expiresAt)<Date.parse(firstGrant.expiresAt));
  const {rows:[stored]}=await pool.query('SELECT expires_at FROM blofy_linode_viewer_sessions WHERE session_id=$1',[viewer.sessionId]);
  assert.equal(new Date(stored.expires_at).toISOString(),firstGrant.expiresAt);
  assert.equal((await restored.attachViewer({...viewer,sessionId:randomUUID()})).reason,'viewer_quota');
  const other={...viewer,sessionId:randomUUID(),accountId:randomUUID()};
  assert.equal((await restored.attachViewer(other)).ok,true);
  assert.equal((await restored.attachViewer({...other,generation:'0'.repeat(32)})).ok,false);
  assert.equal((await restored.closeViewer(viewer)).ok,true);
  assert.equal((await restored.attachViewer(viewer)).ok,false);
  assert.equal((await restored.attachViewer({...viewer,sessionId:randomUUID()})).reason,'viewer_quota');
  const more=await Promise.all(Array.from({length:155},()=>restored.attachViewer({...viewer,accountId:randomUUID(),sessionId:randomUUID()})));
  assert.equal(more.filter(x=>x.ok).length,148);
  assert.equal(more.filter(x=>x.reason==='viewer_quota').length,7);
  assert.equal((await restored.transition({...t,next:'unknown'})).ok,true);
  assert.equal((await restored.readRoutingState({sourceId})).state,'unknown');
  assert.equal((await restored.readRoutingState({sourceId})).releaseConfirmed,false);
  assert.equal((await restored.findReady(args)).ok,false);
  assert.equal((await restored.transition({...t,next:'released'})).ok,false);
  assert.equal((await restored.reserve({...args,requestId:randomUUID()})).ok,false);
  assert.equal((await restored.transition({...t,next:'released',releaseConfirmed:true})).ok,true);
  assert.equal((await restored.readRoutingState({sourceId})).releaseConfirmed,true);
  const newId=randomUUID();
  const next=await restored.reserve({...args,requestId:newId,engineId:'hostbrr'});
  assert.equal(next.action,'start_once');
  assert.equal((await restored.transition({...t,next:'released',releaseConfirmed:true})).ok,false);
  assert.equal((await restored.transition({sourceId,reservationId:next.reservationId,next:'released',releaseConfirmed:true})).ok,false);
  assert.equal((await restored.transition({sourceId,reservationId:next.reservationId,engineId:'hostbrr',next:'released',releaseConfirmed:true})).ok,true);
  assert.equal((await restored.reserve(args)).ok,false);
 }finally{
  if(pool)await pool.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').finally(()=>admin.end());
 }
});

test('durable route claim across pools and restart; dispatch once against PostgreSQL',{timeout:60000},async()=>{
 const admin=new pg.Pool({...options,max:1}),schema='qa_'+randomUUID().replaceAll('-','');
 let a,b;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  const open=()=>new pg.Pool({...options,options:'-c search_path='+schema,max:8});
  a=open();b=open();
  await ensureEngineRouteClaims(a);
  const sourceId=randomUUID(),requestId=randomUUID(),now=Date.now();
  const claims=p=>createEngineRouteClaims(p,{enabled:true,sourceId});
  await ensureLinodeFeedLedger(a);
  const ledger=p=>createLinodeFeedLedger(p,{BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_HOSTBRR_FEED_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId});
  const request={sourceId,requestId,channelId:'123',authorized:true,expiresAt:now+60000};
  const snapshot={entitlement:{sourceId,redistributionAllowed:true,expiresAt:now+60000},
    feed:{sourceId,state:'empty'},capacity:{sourceId,authoritative:true,scope:'dedicated_licensed_pool',activeConnections:0,maxConnections:1,observedAt:now},
    workers:{hostbrr:{authenticated:true,observedAt:now,deliveryActive:true,heartbeatActive:true,activeViewers:0,viewerLimit:150}}};
  let starts=0;
  const route=p=>createEngineRouteCoordinator({claims:claims(p),ledger:ledger(p),enabled:true,clock:()=>now,readSnapshot:async()=>snapshot,
   start:async()=>{starts++;const r=await ledger(p).reserve({sourceId,requestId,channelId:'123',engineId:'hostbrr'});assert.equal(r.action,'start_once');assert.equal((await ledger(p).transition({sourceId,reservationId:r.reservationId,engineId:'hostbrr',next:'ready',generation:randomUUID().replaceAll('-','')})).ok,true);return {ok:true,action:'feed_ready',sourceId,channelId:'123',engineId:'hostbrr',reservationId:r.reservationId}}});
  const ra=route(a),rb=route(b);
  const results=await Promise.all(Array.from({length:40},(_,i)=>(i%2?ra:rb)(request)));
  assert.equal(starts,1);assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal(results.filter(r=>r.reason==='already_claimed').length,39);
  const {rows:[stored]}=await a.query('SELECT state,action FROM blofy_engine_route_claims WHERE request_id=$1',[requestId]);
  assert.deepEqual(stored,{state:'finished',action:'feed_ready'});
  const unresolved={sourceId,requestId:randomUUID()};
  assert.equal((await claims(a).claim(unresolved)).acquired,true);
  await a.end();a=null;await b.end();b=null;a=open();
  assert.equal((await route(a)(request)).reason,'already_claimed');
  assert.equal((await claims(a).claim(unresolved)).acquired,false);
  assert.equal(starts,1);
  assert.equal((await ledger(a).readRoutingState({sourceId})).state,'ready');
 }finally{
  if(a)await a.end();if(b)await b.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').finally(()=>admin.end());
 }
});

test('worker lease sequence is serialized by source lock; fencing blocks renewal',{timeout:60000},async()=>{
 const admin=new pg.Pool({...options,max:1}),schema='qa_'+randomUUID().replaceAll('-','');
 let a,b;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  const open=()=>new pg.Pool({...options,options:'-c search_path='+schema,max:8});
  a=open();b=open();await ensureLinodeFeedLedger(a);
  const sourceId=randomUUID(),engineId='hostbrr',channelId='123';
  const env={BLOFY_LINODE_FEED_LEDGER:'1',BLOFY_HOSTBRR_FEED_LEDGER:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId,BLOFY_ENGINE_RENEWABLE_LEASE:'1'};
  const one=createLinodeFeedLedger(a,env),two=createLinodeFeedLedger(b,env);
  const {reservationId}=await one.reserve({sourceId,engineId,channelId,requestId:randomUUID()});
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  await ensureEngineIngressGate(a);
  const gate=createEngineIngressGate(a,{sourceId,enabled:true}),gate2=createEngineIngressGate(b,{sourceId,enabled:true});
  assert.equal((await gate.initialize()).ok,true);
  const hold=randomUUID();
  assert.equal((await gate.enterLegacy(hold)).ok,true);
  assert.equal((await gate2.beginDrain()).ok,true);
  assert.equal((await gate.enterLegacy(randomUUID())).ok,false);
  const external=()=>({sourceId,authoritative:true,scope:'all_paths',activeConnections:0,maxConnections:1,observedAt:Date.now()});
  const promotion=()=>({reservationId,engineId,proof:external()});
  assert.equal((await gate.promote(promotion())).reason,'legacy_holds_open');
  assert.deepEqual(await gate2.readDrain(),{ok:true,mode:'draining',registeredLegacyHolds:1,allPathsDrained:false});
  assert.equal((await gate2.closeLegacy(hold)).ok,true);
  assert.equal((await gate.promote({...promotion(),proof:null})).ok,false);
  const identity={sourceId,engineId,channelId,reservationId};
  const request=()=>({...identity,signingKey:privateKey,fence:{...identity,authoritative:true,scope:'all_paths',observedAt:Date.now(),expiresAt:Date.now()+90000}});
  assert.equal((await one.issueWorkerLease({...request(),fence:null})).ok,false);
  assert.equal((await one.issueWorkerLease(request())).reason,'lease_ingress_gate_closed');
  assert.equal((await gate.promote(promotion())).ok,true);
  assert.equal((await gate2.readFence(identity)).registeredIngressFenced,true);
  assert.equal((await gate2.enterLegacy(randomUUID())).ok,false);
  assert.equal((await gate2.restoreLegacy()).ok,false);
  assert.equal((await one.issueWorkerLease({...request(),engineId:'linode'})).ok,false);
  const results=await Promise.all(Array.from({length:24},(_,i)=>(i%2?one:two).issueWorkerLease(request())));
  assert.ok(results.every(r=>r.ok&&verifyLiveLease({lease:r.lease,signature:r.signature},{key:publicKey,identity})));
  assert.deepEqual(results.map(r=>r.lease.sequence).sort((x,y)=>x-y),Array.from({length:24},(_,i)=>i+1));
  await a.end();a=open();
  const restored=createLinodeFeedLedger(a,env);
  assert.equal((await restored.issueWorkerLease(request())).lease.sequence,25);
  assert.equal((await restored.transition({...identity,next:'unknown'})).ok,true);
  assert.equal((await two.issueWorkerLease(request())).ok,false);
  assert.equal((await restored.transition({...identity,next:'released',releaseConfirmed:true})).ok,true);
  assert.equal((await two.issueWorkerLease(request())).ok,false);
  assert.equal((await gate2.restoreLegacy()).ok,true);
  assert.equal((await gate2.enterLegacy(hold)).ok,false);
  assert.equal((await gate2.enterLegacy(randomUUID())).ok,true);
 }finally{
  if(a)await a.end();if(b)await b.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').finally(()=>admin.end());
 }
});

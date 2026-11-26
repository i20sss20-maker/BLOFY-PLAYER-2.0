import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
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
  const request={sourceId,requestId,channelId:'123',authorized:true,expiresAt:now+60000};
  const snapshot={entitlement:{sourceId,redistributionAllowed:true,expiresAt:now+60000},
    feed:{sourceId,state:'empty'},capacity:{sourceId,authoritative:true,scope:'dedicated_licensed_pool',activeConnections:0,maxConnections:1,observedAt:now},
    workers:{hostbrr:{authenticated:true,observedAt:now,deliveryActive:true,heartbeatActive:true,activeViewers:0,viewerLimit:150}}};
  let starts=0;
  const route=p=>createEngineRouteCoordinator({claims:claims(p),enabled:true,clock:()=>now,readSnapshot:async()=>snapshot,
   start:async()=>{starts++;return {ok:true,action:'feed_ready',sourceId,channelId:'123',engineId:'hostbrr',reservationId:randomUUID()}}});
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
 }finally{
  if(a)await a.end();if(b)await b.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE').finally(()=>admin.end());
 }
});

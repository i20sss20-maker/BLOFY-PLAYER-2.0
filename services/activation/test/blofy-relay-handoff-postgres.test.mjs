// This suite deliberately uses a disposable PostgreSQL instance, never a
// production database. No upstream requests, tokens or real subscribers.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createEngineIngressGate,ensureEngineIngressGate} from '../src/blofy-engine-ingress-gate.mjs';
import {createRelayHandoffCoordinator} from '../src/blofy-relay-handoff-coordinator.mjs';
import {selectOwnedRelayEnvironment} from '../src/xtream-stream-relay-bridge.mjs';

const url=process.env.BLOFY_TEST_DISPOSABLE_PG_URL;
test('real PostgreSQL serializes two competing handoffs and fences old owner and routing',
 {skip:!url,timeout:30000},async()=>{
 const u=new URL(url);
 assert.ok(['127.0.0.1','localhost'].includes(u.hostname));
 assert.equal(u.pathname,'/blofy_handoff_test');
 const pool=new pg.Pool({connectionString:url,max:6});
 const sourceId=randomUUID(),holdId=randomUUID(),schema='handoff_'+sourceId.replaceAll('-','');
 const admin=await pool.connect();
 let isolated;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  isolated=new pg.Pool({connectionString:url,max:6,options:'-c search_path='+schema});
  await ensureEngineIngressGate(isolated);
  // Minimal ledger fixture: the actual gate only reads this state.
  await isolated.query('CREATE TABLE blofy_linode_feed_ledger(source_id uuid PRIMARY KEY,state text NOT NULL)');
  const gate=createEngineIngressGate(isolated,{sourceId,enabled:true});
  assert.equal((await gate.initialize()).ok,true);
  await isolated.query("UPDATE blofy_engine_ingress_gate SET relay_owner='hostbrr' WHERE source_id=$1",[sourceId]);
  const env={BLOFY_RELAY_OWNER_ROUTING:'1',BLOFY_RELAY_ENGINE_OWNERSHIP:'1',BLOFY_STREAM_RELAY_EXTERNAL_CUTOVER:'1'};
  const route=()=>selectOwnedRelayEnvironment({sourceId,env,readApprovedSource:async()=>sourceId,
    readOwner:async id=>(await isolated.query('SELECT mode,relay_owner FROM blofy_engine_ingress_gate WHERE source_id=$1',[id])).rows[0]});
  assert.equal((await route()).BLOFY_STREAM_RELAY_MEDIA_ORIGIN,'https://media2.blofyplayer.com');
  assert.equal((await gate.enterOwnedRelay(holdId,'hostbrr')).ok,true);
  const options={enabled:true,gate,sourceId,
    readHealth:async()=>{const n=Date.now();return {hostbrr:{ok:false,observedAt:n,since:n-60000},linode:{ok:true,observedAt:n,since:n-60000}}},
    verifyCoverage:async()=>true,stopPreviousOwner:async()=>true,
    observeProviderRelease:async i=>({...i,authoritative:true,scope:'all_paths',activeConnections:0,maxConnections:1,observedAt:Date.now()})};
  const a=createRelayHandoffCoordinator(options),b=createRelayHandoffCoordinator(options);
  const first=await Promise.all([a(),b()]);
  assert.ok(first.every(x=>!x.ok));
  assert.equal((await gate.readRelayOwnerState()).mode,'draining');
  await assert.rejects(route(),/relay_owner_unavailable/);
  assert.equal((await gate.enterOwnedRelay(randomUUID(),'linode')).ok,false);
  assert.equal((await gate.enterOwnedRelay(randomUUID(),'hostbrr')).ok,false);
  assert.equal((await gate.closeOwnedRelay(holdId,'linode')).ok,false);
  assert.equal((await gate.closeOwnedRelay(holdId,'hostbrr')).ok,true);
  const next=await Promise.all([a(),b()]);
  assert.equal(next.filter(x=>x.ok&&x.owner==='linode').length,1);
  assert.equal((await route()).BLOFY_STREAM_RELAY_MEDIA_ORIGIN,'https://media.blofyplayer.com');
  assert.equal((await gate.enterOwnedRelay(randomUUID(),'hostbrr')).ok,false);
  assert.equal((await gate.enterOwnedRelay(randomUUID(),'linode')).ok,true);
 }finally{
  if(isolated)await isolated.end();
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
  admin.release();await pool.end();
 }
});

test('real PostgreSQL serializes optional source admission across separate gateway pools',
 {skip:!url,timeout:30000},async()=>{
 const u=new URL(url);
 assert.ok(['127.0.0.1','localhost'].includes(u.hostname));
 assert.equal(u.pathname,'/blofy_handoff_test');
 const root=new pg.Pool({connectionString:url,max:2});
 const sourceId=randomUUID(),schema='priority_'+sourceId.replaceAll('-','');
 const admin=await root.connect();
 let poolA,poolB;
 try{
  await admin.query('CREATE SCHEMA '+schema);
  const options={connectionString:url,max:3,options:'-c search_path='+schema};
  poolA=new pg.Pool(options);poolB=new pg.Pool(options);
  await ensureEngineIngressGate(poolA);
  await poolA.query('CREATE TABLE blofy_linode_feed_ledger(source_id uuid PRIMARY KEY,state text NOT NULL)');
  const a=createEngineIngressGate(poolA,{sourceId,enabled:true});
  const b=createEngineIngressGate(poolB,{sourceId,enabled:true});
  assert.equal((await a.initialize()).ok,true);
  const foreground=randomUUID();
  assert.equal((await a.enterLegacy(foreground)).ok,true);
  const blocked=await Promise.all(Array.from({length:6},()=>b.enterLegacy(randomUUID(),{background:true})));
  assert.ok(blocked.every(x=>!x.ok&&x.reason==='background_source_busy'));
  assert.equal((await b.closeLegacy(foreground)).ok,true);
  const ids=[randomUUID(),randomUUID()];
  const race=await Promise.all([a.enterLegacy(ids[0],{background:true}),b.enterLegacy(ids[1],{background:true})]);
  assert.equal(race.filter(x=>x.ok).length,1);
  assert.equal(race.filter(x=>x.reason==='background_source_busy').length,1);
  const winner=ids[race.findIndex(x=>x.ok)];
  // An already admitted optional request is not forcibly cancelled. A
  // foreground request still enters; use the explicit optional-media pause
  // when diagnosing live streams to prevent new optional work altogether.
  const viewer=randomUUID();
  assert.equal((await b.enterLegacy(viewer)).ok,true);
  assert.equal((await a.closeLegacy(winner)).ok,true);
  assert.equal((await a.enterLegacy(randomUUID(),{background:true})).reason,'background_source_busy');
  assert.equal((await b.closeLegacy(viewer)).ok,true);
  await poolA.query("INSERT INTO blofy_linode_feed_ledger(source_id,state) VALUES($1,'unknown')",[sourceId]);
  assert.equal((await b.enterLegacy(randomUUID(),{background:true})).reason,'background_source_busy');
  const state=await a.readRelayOwnerState();
  assert.equal(state.openHolds,0);
 }finally{
  await Promise.all([poolA?.end(),poolB?.end()]);
  await admin.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
  admin.release();await root.end();
 }
});

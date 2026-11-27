import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {ensureShadowMultiFeedSchema,createShadowMultiFeedLedger} from '../src/blofy-engine-shadow-multifeed-ledger.mjs';
const url=process.env.BLOFY_SHADOW_TEST_DATABASE_URL;
test('disabled shadow ledger never accesses PostgreSQL',async()=>{
 const l=createShadowMultiFeedLedger({connect(){throw Error('unexpected')}});
 assert.equal((await l.snapshot()).reason,'shadow_disabled');
});
test('real PostgreSQL concurrent 16-slot admission, stale revisions, duplicate channel, release and standby capacity',{skip:!url,timeout:30000},async()=>{
 // Dedicated CI-only database. No production connection string fallback.
 const pool=new pg.Pool({connectionString:url,ssl:false,max:20});
 const sourceId=randomUUID(),secondSource=randomUUID();
 const make=id=>createShadowMultiFeedLedger(pool,{enabled:true,sourceId:id,engineLimits:{hostbrr:16,linode:16}});
 const ledger=make(sourceId),other=make(secondSource);
 const requestId=()=>randomUUID();
 const decision=(s,n,engineId='hostbrr')=>({action:'request_reservation',sourceId:s.sourceId,channelId:String(n),engineId,maxFeeds:s.maxFeeds,snapshotRevision:s.revision});
 try{
  await ensureShadowMultiFeedSchema(pool);
  assert.equal((await ledger.initialize(16)).ok,true);
  assert.equal((await other.initialize(16)).ok,true);
  const s=await ledger.snapshot();
  const duplicateId=requestId();
  const race=await Promise.all(Array.from({length:20},(_,i)=>ledger.reserve({decision:decision(s,i+1),requestId:i===0?duplicateId:requestId()})));
  assert.equal(race.filter(x=>x.action==='recorded').length,1);
  assert.equal(race.filter(x=>x.reason==='snapshot_changed').length,19);
  let current=await ledger.snapshot();
  const first=current.reservations[0];
  assert.equal((await ledger.reserve({decision:decision(current,first.channelId),requestId:first.requestId})).action,'existing');
  assert.equal((await ledger.reserve({decision:decision(current,first.channelId),requestId:requestId()})).reason,'channel_occupied');
  for(let i=100;i<115;i++){
   current=await ledger.snapshot();
   assert.equal((await ledger.reserve({decision:decision(current,i),requestId:requestId()})).action,'recorded');
  }
  current=await ledger.snapshot();
  assert.equal(current.reservations.length,16);
  assert.equal((await ledger.reserve({decision:decision(current,999,'linode'),requestId:requestId()})).reason,'source_capacity');
  assert.equal((await other.reserve({decision:decision(await other.snapshot(),1),requestId:requestId()})).reason,'worker_capacity');
  const t={reservationId:first.reservationId};
  assert.equal((await ledger.simulateTransition({...t,next:'release_unknown'})).ok,true);
  assert.equal((await ledger.simulateTransition({...t,next:'released'})).reason,'release_unconfirmed');
  assert.equal((await ledger.reserve({decision:decision(await ledger.snapshot(),999,'linode'),requestId:requestId()})).reason,'source_capacity');
  assert.equal((await ledger.simulateTransition({...t,next:'released',syntheticReleaseConfirmed:true})).ok,true);
  assert.equal((await ledger.reserve({decision:decision(await ledger.snapshot(),first.channelId),requestId:first.requestId})).reason,'request_replayed');
  assert.equal((await ledger.reserve({decision:decision(await ledger.snapshot(),first.channelId,'linode'),requestId:requestId()})).action,'recorded');
  assert.equal((await other.reserve({decision:decision(await other.snapshot(),1),requestId:requestId()})).action,'recorded');
  assert.equal((await ledger.snapshot()).reservations.length,16);
 }finally{
  await pool.query('DELETE FROM blofy_shadow_multi_reservation WHERE source_id=ANY($1::uuid[])',[[sourceId,secondSource]]).catch(()=>{});
  await pool.query('DELETE FROM blofy_shadow_multi_source WHERE source_id=ANY($1::uuid[])',[[sourceId,secondSource]]).catch(()=>{});
  await pool.end();
 }
});

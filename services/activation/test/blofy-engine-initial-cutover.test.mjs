import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createInitialCutover} from '../src/blofy-engine-initial-cutover.mjs';
const request={sourceId:randomUUID(),requestId:randomUUID(),channelId:'123',engineId:'hostbrr'};
function fixture(overrides={}){
 const calls=[],id=randomUUID(),holds=[randomUUID()],proof={verifiedByTest:true};
 const gate={beginDrain:async()=>{calls.push('drain');return {ok:true}},readDrain:async()=>({ok:true,mode:'draining',drainStartedAt:123,openHoldIds:holds}),cancelDrain:async()=>{calls.push('cancel');return {ok:true}}};
 const ledger={reserve:async args=>{calls.push('reserve');assert.deepEqual(args.initialDrain,{proof,openHoldIds:holds});return {ok:true,action:'start_once',reservationId:id}},rollbackUnissuedInitial:async()=>{calls.push('rollback');return {ok:true}}};
 const config={gate,ledger,verifyDrain:async()=>proof,verifyRollback:async()=>proof,startWorker:async i=>{calls.push('start');return {ok:true,action:'feed_ready',...i}},enabled:true,...overrides};
 return {calls,config,run:()=>createInitialCutover(config)(request)};
}
test('initial cutover requires explicit adapters and starts only after committed reserve',async()=>{
 const x=fixture();assert.equal((await createInitialCutover({...x.config,enabled:false})(request)).reason,'disabled');assert.deepEqual(x.calls,[]);
 assert.equal((await x.run()).action,'feed_ready');assert.deepEqual(x.calls,['drain','reserve','start']);
});
test('unconfirmed drain cancels without reserving or starting',async()=>{
 const x=fixture({verifyDrain:async()=>null});assert.deepEqual(await x.run(),{ok:false,reason:'drain_unconfirmed',restoredLegacy:true});assert.deepEqual(x.calls,['drain','cancel']);
});
test('ambiguous database or worker execution never forces rollback',async()=>{
 const x=fixture();x.config.ledger.reserve=async()=>{throw Error('unknown commit')};assert.equal((await x.run()).reason,'reservation_commit_unknown');assert.deepEqual(x.calls,['drain']);
 const y=fixture({startWorker:async()=>{throw Error('unknown start')}});assert.equal((await y.run()).reason,'worker_start_unknown');assert.deepEqual(y.calls,['drain','reserve']);
});
test('negative worker result needs independent release confirmation before rollback',async()=>{
 const x=fixture({startWorker:async()=>({ok:false}),verifyRollback:async()=>null});assert.equal((await x.run()).reason,'worker_release_unconfirmed');assert.deepEqual(x.calls,['drain','reserve']);
 const y=fixture({startWorker:async()=>({ok:false})});assert.deepEqual(await y.run(),{ok:false,reason:'worker_not_ready',restoredLegacy:true});assert.deepEqual(y.calls,['drain','reserve','rollback']);
});

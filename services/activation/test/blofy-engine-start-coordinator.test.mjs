import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineStartCoordinator} from '../src/blofy-engine-start-coordinator.mjs';
const now=Date.parse('2026-11-26T00:00:00Z');
const a='00000000-0000-4000-8000-000000000001',s='00000000-0000-4000-8000-000000000002',q='00000000-0000-4000-8000-000000000003',r='00000000-0000-4000-8000-000000000004';
const date=ms=>new Date(now+ms).toISOString();
const env={BLOFY_LINODE_MEDIA_CANARY:'1',BLOFY_LINODE_MEDIA_TEST_ACCOUNT_ID:a,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:s,BLOFY_LINODE_MEDIA_TEST_CHANNEL_ID:'123'};
const fixture=()=>({requestId:q,context:{account:{id:a,source_id:s,enabled:true,expires_at:date(120000),max_connections:1},
row:{server_id:s,source_id:'123',server_enabled:true,source_reported_max_connections:1},kind:'live',method:'GET',distributorAllowed:true,
rights:{verified:true,sourceId:s,mediaHost:'media.blofyplayer.com',expiresAt:date(30000)},
engine:{healthy:true,customerTrafficEnabled:false,realSourceVerified:true,sourceId:s,channelId:'123',observedAt:date(-1000)}},
capacity:{authoritative:true,scope:'all_paths',sourceId:s,providerQuota:1,observedAt:date(-1000)},
attempt:{requestId:q,state:'not_started'}});

const settings={...env,BLOFY_ENGINE_START_COORDINATOR:'1'};
const gen='a'.repeat(32);
function setup({reservation={ok:true,action:'start_once',state:'pending',reservationId:r},change=x=>x,worker,clock=()=>now,settingsOverride=settings,timeoutMs=50}={}){
 const calls=[];
 const ledger={async reserve(p){calls.push(['reserve',p]);return reservation;},async transition(p){calls.push([p.next,p]);return {ok:true,state:p.next};}};
 const adapter={async start(p){calls.push(['start',p]);if(worker)return worker(p);
 return change({status:'private_hls_ready',engineId:p.engineId,sourceId:p.sourceId,channelId:p.channelId,
 reservationId:p.reservationId,requestId:p.requestId,generation:gen,realSourceVerified:true,observedAt:date(0)});}};
 return {calls,issue:createEngineStartCoordinator({ledger,workers:{linode:adapter,hostbrr:adapter},env:settingsOverride,clock,timeoutMs})};
}
test('a new reservation starts one worker and commits ready only after matching proof',async()=>{
 const {calls,issue}=setup();const result=await issue(fixture());assert.equal(result.ok,true);
 assert.deepEqual(calls.map(x=>x[0]),['reserve','start','ready']);
 assert.equal(result.generation,gen);assert.equal(calls[1][1].reservationId,r);
});
test('a replay, denied capacity, or disabled feature cannot start a worker',async()=>{
 const x=setup({reservation:{ok:true,action:'existing',state:'pending',reservationId:r}});
 assert.equal((await x.issue(fixture())).ok,false);assert.deepEqual(x.calls.map(c=>c[0]),['reserve']);
 const y=setup();const f=fixture();f.capacity.authoritative=false;assert.equal((await y.issue(f)).ok,false);assert.equal(y.calls.length,0);
 const z=setup({settingsOverride:env});assert.equal((await z.issue(fixture())).ok,false);assert.equal(z.calls.length,0);
});
test('wrong proof or timed-out worker quarantines reservation without failover',async()=>{
 for(const change of [p=>({...p,engineId:'hostbrr'}),p=>({...p,reservationId:q}),p=>({...p,observedAt:date(-11000)})]){
  const {calls,issue}=setup({change});assert.equal((await issue(fixture())).ok,false);
  assert.deepEqual(calls.map(c=>c[0]),['reserve','start','unknown']);
 }
 const {calls,issue}=setup({worker:()=>new Promise(()=>{}),timeoutMs:5});
 assert.equal((await issue(fixture())).reason,'worker_outcome_unknown');
 assert.deepEqual(calls.map(c=>c[0]),['reserve','start','unknown']);
});
test('HostBrr reservation and worker identity are bound to the same engine',async()=>{
 const f=fixture();f.context.engineId='hostbrr';f.context.engine.engineId='hostbrr';f.context.rights.mediaHost='media2.blofyplayer.com';f.attempt.engineId='hostbrr';f.capacity.engineId='hostbrr';
 const {calls,issue}=setup({settingsOverride:{...settings,BLOFY_HOSTBRR_MEDIA_CANARY:'1'}});
 assert.equal((await issue(f)).engineId,'hostbrr');assert.ok(calls.every(c=>c[1].engineId==='hostbrr'));
});

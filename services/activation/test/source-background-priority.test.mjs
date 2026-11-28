import test from 'node:test';
import assert from 'node:assert/strict';
import {createLegacyIngress,createGatewayHoldLifetime} from '../src/blofy-engine-legacy-ingress.mjs';
import {createEngineIngressGate} from '../src/blofy-engine-ingress-gate.mjs';
const sourceId='550e8400-e29b-41d4-a716-446655440000';
const hold='550e8400-e29b-41d4-a716-446655440001';
function setup({count=0,feed=null,mode='legacy'}={}){
 const calls=[];
 const c={release(){},async query(sql,args){
  calls.push(sql);
  if(sql.startsWith('SELECT * FROM blofy_engine_ingress_gate'))return {rows:[{mode}]};
  if(sql.includes('count(*)'))return {rows:[{n:count}]};
  if(sql.startsWith('SELECT state FROM blofy_linode_feed_ledger'))return {rows:feed?[{state:feed}]:[]};
  if(sql.startsWith('INSERT INTO blofy_engine_legacy_holds'))return {rows:[{hold_id:hold}],rowCount:1};
  return {rows:[]};
 }};
 return {calls,gate:createEngineIngressGate({connect:async()=>c},{sourceId,enabled:true})};
}
test('background probe defers while existing source holds are open',async()=>{
 const {calls,gate}=setup({count:1});
 assert.deepEqual(await gate.enterLegacy(hold,{background:true}),{ok:false,reason:'background_source_busy'});
 assert.ok(!calls.some(s=>s.startsWith('INSERT')));
 assert.ok(calls.findIndex(s=>s.includes('pg_advisory_xact_lock'))<calls.findIndex(s=>s.includes('count(*)')));
});
test('background probe defers on unresolved engine reservation even without legacy holds',async()=>{
 const {gate}=setup({feed:'unknown'});
 assert.equal((await gate.enterLegacy(hold,{background:true})).reason,'background_source_busy');
});
test('idle background probe can reserve; foreground admission stays unchanged',async()=>{
 const idle=setup({feed:'released'});
 assert.equal((await idle.gate.enterLegacy(hold,{background:true})).ok,true);
 const live=setup({count:2,feed:'unknown'});
 assert.equal((await live.gate.enterLegacy(hold)).ok,true);
 assert.ok(!live.calls.some(s=>s.includes('count(*)')));
});
test('background work never bypasses existing drain fence',async()=>{
 const {gate}=setup({mode:'draining'});
 assert.equal((await gate.enterLegacy(hold,{background:true})).reason,'legacy_fenced');
});

test('optional-media pause rejects before database access, even without ingress gate',async()=>{
 let calls=0;
 const pool={query(){calls++;throw Error('unexpected query')},connect(){calls++;throw Error('unexpected connect')}};
 for(const enabled of ['0','1']){
  const enter=createLegacyIngress(pool,{BLOFY_ENGINE_LEGACY_INGRESS_GATE:enabled,
   BLOFY_ENGINE_PAUSE_OPTIONAL_SOURCE_MEDIA:'1'},createGatewayHoldLifetime());
  assert.deepEqual(await enter(sourceId,{background:true}),{ok:false,reason:'background_source_busy'});
 }
 assert.equal(calls,0);
});
test('optional pause leaves foreground disabled-gate behavior intact; default is unchanged',async()=>{
 const pool={connect(){throw Error('unexpected connect')}};
 const paused=createLegacyIngress(pool,{BLOFY_ENGINE_PAUSE_OPTIONAL_SOURCE_MEDIA:'1'},createGatewayHoldLifetime());
 const foreground=await paused(sourceId);
 assert.equal(foreground.ok,true);assert.equal(await foreground.close(),true);
 const standard=createLegacyIngress(pool,{},createGatewayHoldLifetime());
 assert.equal((await standard(sourceId,{background:true})).ok,true);
});

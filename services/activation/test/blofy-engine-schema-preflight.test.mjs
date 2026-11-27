import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveApprovedEngineSource,prepareEngineSchema} from '../src/blofy-engine-schema-preflight.mjs';
const id='11111111-1111-4111-8111-111111111111';
const env={BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh',BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED:'1',BLOFY_STREAM_SHARED_LIVE_CANARY:'1',BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1',BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'1',BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'saleh'};
test('resolve exactly one enabled and approved source with provider quota 1',async()=>{
 const row={id,enabled:true,publish_catalog:true,quota:'1',restreamer:'false'};
 let rows=[row],calls=0;
 const pool={query:async(sql,args)=>{calls++;assert.deepEqual(args,['saleh']);return {rows}}};
 assert.equal(await resolveApprovedEngineSource(pool,{}),null);assert.equal(calls,0);
 assert.equal(await resolveApprovedEngineSource(pool,env),id);
 rows=[row,row];assert.equal(await resolveApprovedEngineSource(pool,env),null);
 rows=[{...row,quota:'2'}];assert.equal(await resolveApprovedEngineSource(pool,env),null);
 rows=[{...row,enabled:false}];assert.equal(await resolveApprovedEngineSource(pool,env),null);
 rows=[row];assert.equal(await resolveApprovedEngineSource(pool,{...env,BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'0'}),null);
 assert.equal(await resolveApprovedEngineSource(pool,{...env,BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:'other'}),null);
});
test('unconfigured source never opens a database connection',async()=>{
 assert.deepEqual(await prepareEngineSchema({connect:()=>{throw Error('must not connect')}},{sourceId:null}),{ok:false,code:'source_not_configured'});
});

import {createLegacyIngress} from '../src/blofy-engine-legacy-ingress.mjs';
test('opaque subscriber requests register a durable hold before upstream; draining denies them',async()=>{
 let mode='legacy',holds=0,closed=0;
 const pool={query:async()=>({rows:[{id,enabled:true,publish_catalog:true,quota:'1',restreamer:'true'}]}),
 connect:async()=>({release(){},async query(sql){
  if(sql.startsWith('SELECT * FROM blofy_engine_ingress_gate'))return {rows:[{mode}]};
  if(sql.startsWith('INSERT INTO blofy_engine_legacy_holds')){holds++;return {rowCount:1}}
  if(sql.startsWith('UPDATE blofy_engine_legacy_holds')){closed++;return {rowCount:1}}
  return {rows:[]};
 }})};
 const enter=createLegacyIngress(pool,{...env,BLOFY_ENGINE_LEGACY_INGRESS_GATE:'1'});
 const h=await enter(null,{unknownSource:true});
 assert.equal(h.ok,true);assert.equal(holds,1);
 assert.equal(await h.close(),true);assert.equal(await h.close(),true);assert.equal(closed,1);
 mode='draining';
 assert.equal((await enter(null,{unknownSource:true})).ok,false);
 assert.equal(holds,1);
 assert.equal((await enter('other')).ok,true);
 assert.equal((await createLegacyIngress(null,{})(null,{unknownSource:true})).ok,true);
});

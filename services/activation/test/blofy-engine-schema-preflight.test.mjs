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

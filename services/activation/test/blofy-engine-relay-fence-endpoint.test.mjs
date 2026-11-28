import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFenceEndpoint} from '../src/blofy-engine-relay-fence-endpoint.mjs';
const env={BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'saleh',BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED:'1',BLOFY_STREAM_SHARED_LIVE_CANARY:'1',BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1',BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'1',BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'saleh',BLOFY_ENGINE_LEGACY_INGRESS_GATE:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:'11111111-1111-4111-8111-111111111111',BLOFY_STREAM_RELAY_SHARED_TOKEN:'x'.repeat(40)};
test('relay fence reports only authenticated current database mode; denies uncertain state',async()=>{
 let mode='legacy',fail=false,queries=0;
 const pool={query:async()=>{queries++;return {rows:[{id:env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID,enabled:true,publish_catalog:true,quota:'1',restreamer:'false'}]}},connect:async()=>{if(fail)throw Error('db down');return {release(){},async query(sql){queries++;if(sql.startsWith('SELECT *'))return {rows:mode?[{mode}]:[]};if(sql.includes('clock_timestamp'))return {rows:[{now:new Date()}]};return {rows:[]}}}}};
 const handle=createRelayFenceEndpoint(pool,env);
 async function call(auth='Bearer '+env.BLOFY_STREAM_RELAY_SHARED_TOKEN,method='GET',h=handle){
  let status,headers,body;
  await h({method,headers:{authorization:auth}},{writeHead(s,x){status=s;headers=x},end(b){body=JSON.parse(b)}});
  assert.equal(headers['cache-control'],'no-store');return {status,body};
 }
 assert.equal((await call('Bearer wrong')).status,403);assert.equal(queries,0);
 assert.equal((await call(undefined,'POST')).status,405);assert.equal(queries,0);
 assert.equal((await call()).body.mode,'legacy');
 mode='engine';assert.equal((await call()).body.mode,'engine');
 mode=null;assert.equal((await call()).status,503);
 fail=true;assert.equal((await call()).status,503);
 assert.equal((await call(undefined,'GET',createRelayFenceEndpoint(pool,{}))).status,403);
});

test('ownership requires distinct credentials and current owner even for existing tickets',async()=>{
 const e={...env,BLOFY_RELAY_ENGINE_OWNERSHIP:'1',BLOFY_HOSTBRR_RELAY_HOLD_TOKEN:'h'.repeat(40),BLOFY_LINODE_RELAY_HOLD_TOKEN:'l'.repeat(40)};
 let mode='legacy',relay_owner='hostbrr';
 const pool={query:async()=>({rows:[{id:env.BLOFY_LINODE_MEDIA_TEST_SOURCE_ID,enabled:true,publish_catalog:true,quota:'1',restreamer:'false'}]}),connect:async()=>({release(){},async query(sql){if(sql.startsWith('SELECT *'))return {rows:[{mode,relay_owner}]};if(sql.includes('clock_timestamp'))return {rows:[{now:new Date()}]};return {rows:[]}}})};
 const call=async(token,h=createRelayFenceEndpoint(pool,e))=>{let status;await h({method:'GET',headers:{authorization:'Bearer '+token}},{writeHead(s){status=s},end(){}});return status};
 assert.equal(await call(e.BLOFY_STREAM_RELAY_SHARED_TOKEN),403);
 assert.equal(await call(e.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN),200);
 assert.equal(await call(e.BLOFY_LINODE_RELAY_HOLD_TOKEN),503);
 mode='draining';assert.equal(await call(e.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN),503);
 mode='legacy';relay_owner='linode';assert.equal(await call(e.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN),503);assert.equal(await call(e.BLOFY_LINODE_RELAY_HOLD_TOKEN),200);
 assert.equal(await call(e.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN,createRelayFenceEndpoint(pool,{...e,BLOFY_LINODE_RELAY_HOLD_TOKEN:e.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN})),403);
});

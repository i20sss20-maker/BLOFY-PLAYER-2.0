import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createRelayHoldEndpoint} from '../src/blofy-engine-relay-hold-endpoint.mjs';
import {resolveApprovedEngineSource} from '../src/blofy-engine-schema-preflight.mjs';
const sourceId='11111111-1111-4111-8111-111111111111',holdId='22222222-2222-4222-8222-222222222222';
const env={BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'licensed',BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED:'1',BLOFY_STREAM_SHARED_LIVE_CANARY:'1',BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1',BLOFY_XTREAM_SHARED_LIVE_MANUAL_PROVIDER_APPROVED:'1',BLOFY_XTREAM_SHARED_LIVE_MANUAL_GRANT_SOURCE_NAME:'licensed',BLOFY_ENGINE_LEGACY_INGRESS_GATE:'1',BLOFY_ENGINE_RELAY_HOLDS:'1',BLOFY_LINODE_MEDIA_TEST_SOURCE_ID:sourceId,BLOFY_STREAM_RELAY_SHARED_TOKEN:'x'.repeat(40)};
test('relay holds are authenticated, scoped, atomic and cannot mutate mode',async()=>{
 let mode='legacy',queries=0,quota='5';
 const open=new Set(),used=new Set();
 const pool={
  async query(){queries++;return {rows:[{id:sourceId,enabled:true,publish_catalog:true,quota,restreamer:'false'}]};},
  async connect(){return {release(){},async query(sql,args){
   queries++;
   if(sql.startsWith('SELECT *'))return {rows:[{mode}]};
   if(sql.startsWith('INSERT INTO blofy_engine_legacy_holds')){
    assert.equal(args[0],sourceId);
    if(sql.includes('closed_at')){
     used.add(args[1]);open.delete(args[1]);return {rowCount:1};
    }
    if(used.has(args[1]))return {rowCount:0};
    used.add(args[1]);open.add(args[1]);return {rowCount:1};
   }
   if(sql.startsWith('UPDATE blofy_engine_legacy_holds')){
    assert.equal(args[0],sourceId);
    open.delete(args[1]);return {rowCount:Number(used.has(args[1]))};
   }
   return {rows:[]};
  }};}
 };
 const handle=createRelayHoldEndpoint(pool,env);
 async function call(body,auth='Bearer '+env.BLOFY_STREAM_RELAY_SHARED_TOKEN,h=handle){
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.headers={authorization:auth,'content-type':'application/json'};
  let code,result;await h(req,{writeHead(c){code=c},end(s){result=JSON.parse(s)}});return {code,result};
 }
 assert.equal((await call({operation:'enter',holdId},'Bearer wrong')).code,403);assert.equal(queries,0);
 assert.equal((await call({operation:'promote',holdId})).code,400);
 assert.equal((await call({operation:'enter',holdId,sourceId})).code,400);
 assert.equal((await call({operation:'enter',holdId},undefined,createRelayHoldEndpoint(pool,{}))).code,403);
 assert.equal((await call({operation:'enter',holdId})).code,200);
 assert.equal((await call({operation:'enter',holdId})).code,409);
 assert.equal(await resolveApprovedEngineSource(pool,env),null);
 const unacknowledged='33333333-3333-4333-8333-333333333333';
 assert.equal((await call({operation:'close',holdId:unacknowledged})).code,409);
 assert.equal((await call({operation:'abandon',holdId:unacknowledged})).code,200);
 assert.equal((await call({operation:'enter',holdId:unacknowledged})).code,409);
 assert.equal(open.size,1);
 mode='draining';
 assert.equal((await call({operation:'enter',holdId:'44444444-4444-4444-8444-444444444444'})).code,409);
 quota=null;
 assert.equal((await call({operation:'close',holdId})).code,200);
 assert.equal((await call({operation:'close',holdId})).code,200);
 assert.equal(open.size,0);
});

test('owned relay mode rejects old shared credential and standby admission',async()=>{
 const cfg={...env,BLOFY_RELAY_ENGINE_OWNERSHIP:'1',BLOFY_HOSTBRR_RELAY_HOLD_TOKEN:'h'.repeat(40),BLOFY_LINODE_RELAY_HOLD_TOKEN:'l'.repeat(40)};
 const calls=[];
 const pool={async query(){return {rows:[{id:sourceId,enabled:true,publish_catalog:true,quota:'1',restreamer:'false'}]}},async connect(){return {release(){},async query(sql,args){
  calls.push({sql,args});
  if(sql.startsWith('SELECT *'))return {rows:[{mode:'legacy',relay_owner:'hostbrr'}]};
  if(sql.startsWith('INSERT INTO blofy_engine_legacy_holds'))return {rowCount:1};
  if(sql.startsWith('UPDATE blofy_engine_legacy_holds'))return {rowCount:args[2]==='hostbrr'?1:0};
  return {rows:[]};
 }}}};
 const handle=createRelayHoldEndpoint(pool,cfg);
 async function call(token,operation='enter',h=handle){
  const req=Readable.from([Buffer.from(JSON.stringify({operation,holdId}))]);req.method='POST';req.headers={authorization:'Bearer '+token,'content-type':'application/json'};
  let status;await h(req,{writeHead(code){status=code},end(){}});return status;
 }
 assert.equal(await call(cfg.BLOFY_STREAM_RELAY_SHARED_TOKEN),403);
 assert.equal(await call(cfg.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN,'enter',createRelayHoldEndpoint(pool,{...cfg,BLOFY_LINODE_RELAY_HOLD_TOKEN:cfg.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN})),403);
 assert.equal(await call(cfg.BLOFY_LINODE_RELAY_HOLD_TOKEN),409);
 assert.equal(await call(cfg.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN),200);
 assert.equal(await call(cfg.BLOFY_LINODE_RELAY_HOLD_TOKEN,'close'),409);
 assert.equal(await call(cfg.BLOFY_HOSTBRR_RELAY_HOLD_TOKEN,'close'),200);
 assert.deepEqual(calls.filter(x=>x.sql.startsWith('INSERT INTO')).map(x=>x.args),[[sourceId,holdId,'hostbrr']]);
});

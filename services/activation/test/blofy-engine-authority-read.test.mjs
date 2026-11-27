import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {Readable} from 'node:stream';
import {signAuthorityRead,verifyAuthorityRead,createAuthorityReadEndpoint} from '../src/blofy-engine-authority-read.mjs';
test('read-only authority request requires pinned fresh exact signature',()=>{
 const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519'),now=Date.now();
 const e=signAuthorityRead(a.privateKey,now);
 assert.equal(verifyAuthorityRead(e,a.publicKey,now),true);
 assert.equal(verifyAuthorityRead(e,b.publicKey,now),false);
 assert.equal(verifyAuthorityRead(e,a.publicKey,now+10001),false);
 assert.equal(verifyAuthorityRead({...e,ts:now+1},a.publicKey,now),false);
 assert.equal(verifyAuthorityRead({...e,operation:'start'},a.publicKey,now),false);
});
test('disabled route never accesses production state',async()=>{
 const a=generateKeyPairSync('ed25519');
 const handler=createAuthorityReadEndpoint({connect(){throw Error('unexpected access')}},{env:{},key:a.publicKey});
 let code,body;
 await handler({method:'POST'},{writeHead(c){code=c},end(s){body=JSON.parse(s)}});
 assert.equal(code,503);assert.deepEqual(body,{ok:false});
});
test('authority reports legacy hold ages without treating them as open or released provider sockets',async()=>{
 const key=generateKeyPairSync('ed25519'),now=Date.parse('2026-11-27T12:00:00Z');
 const sourceId='d96b3b00-a833-4e6e-8d53-975be96fdf52';
 const env={BLOFY_ENGINE_AUTHORITY_READ:'1',BLOFY_XTREAM_SHARED_LIVE_SOURCE_NAME:'test',
  BLOFY_XTREAM_SHARED_LIVE_RIGHTS_CONFIRMED:'1',BLOFY_STREAM_SHARED_LIVE_CANARY:'1',BLOFY_STREAM_LICENSED_LIVE_PRODUCTION:'1'};
 let rows={n:2,oldest:new Date(now-60000),newest:new Date(now-19000)};
 const pool={
  async query(){return {rows:[{id:sourceId,enabled:true,publish_catalog:true,restreamer:'true',quota:'1'}]};},
  async connect(){return {release(){},async query(sql){
   if(sql.startsWith('INSERT INTO blofy_engine_authority_read_nonce'))return {rowCount:1};
   if(sql.includes('FROM blofy_engine_ingress_gate'))return {rows:[{mode:'legacy'}]};
   if(sql.includes('FROM blofy_linode_feed_ledger'))return {rows:[]};
   if(sql.includes('FROM blofy_engine_legacy_holds'))return {rows:[rows]};
   if(sql.startsWith('SELECT clock_timestamp()'))return {rows:[{now:new Date(now)}]};
   if(!/^(BEGIN|COMMIT|SELECT pg_advisory_xact_lock|DELETE FROM blofy_engine_authority_read_nonce)/.test(sql))throw Error('unexpected query');
   return {rows:[]};
  }};}
 };
 const endpoint=createAuthorityReadEndpoint(pool,{env,key:key.publicKey,clock:()=>now});
 async function request(){
  const req=Readable.from([Buffer.from(JSON.stringify(signAuthorityRead(key.privateKey,now)))]);
  req.method='POST';req.headers={'content-type':'application/json'};
  let status,body;
  await endpoint(req,{writeHead(code){status=code},end(value){body=JSON.parse(value)}});
  assert.equal(status,200);
  assert.equal(body.mode,'legacy');
  assert.equal(body.allPathsFenced,false);
  return body;
 }
 const active=await request();
 assert.equal(active.registeredLegacyHolds,2);
 assert.deepEqual(active.legacyHoldAgesSeconds,{oldest:60,newest:19});
 rows={n:0,oldest:null,newest:null};
 assert.equal((await request()).legacyHoldAgesSeconds,null);
});

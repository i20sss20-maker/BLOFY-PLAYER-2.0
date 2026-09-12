import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createSubscriberResolveHandler, resolveEnvelope } from '../src/subscriber-resolve.mjs';
import { createActivationCredentialCodec } from '../src/auth-protection.mjs';
const keyHex = 'a'.repeat(64), key = Buffer.from(keyHex, 'hex');
const deviceId = 'BLOFY-SYNC-TEST', pin = '123456', clock = 1_789_251_000_000;
const envelope = (extra = {}) => {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const value = {u:'user العربية',p:' p&?"% العربية ',d:deviceId,exp:clock+60000,...extra};
  const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
};
const row = (extra={}) => ({ device_id:deviceId, activation_code:createActivationCredentialCodec(keyHex).proof(deviceId,pin), status:'active', expires_at:null, ...extra });
function memoryPool(device=row()) {
  const state={device,queries:[],releases:0};
  const client={release(){state.releases++;}, async query(sql,values=[]) {
    state.queries.push(sql);
    if(sql.startsWith('SELECT * FROM devices')) return {rows:state.device&&values[0]===state.device.device_id?[state.device]:[]};
    if(sql.startsWith('UPDATE devices')) Object.assign(state.device,{auth_failed_attempts:values[1],last_auth_failure_at:values[2],auth_locked_until:values[3]});
    return {rows:[]};
  }};
  return {state, async connect(){return client;}};
}
async function fixture(t, options={}) {
  const pool=Object.hasOwn(options,'pool')?options.pool:memoryPool();
  const handle=createSubscriberResolveHandler({pool,keyHex,subscriberHost:'https://provider.example/base',now:()=>clock,...options});
  const server=http.createServer(async(req,res)=>{if(!await handle(req,res)){res.writeHead(404);res.end('{}');}});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base='http://127.0.0.1:'+server.address().port;
  const call=async(body={deviceId,activationCode:pin,sessionTokens:[envelope()]},init={})=>{
    const r=await fetch(base+'/api/v1/subscribers/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),...init});
    return {status:r.status,headers:r.headers,data:await r.json()};
  };
  return {pool,call,base};
}

test('resolves an authenticated AES-GCM envelope bound to the same device',()=>{
  const value=resolveEnvelope(envelope(),deviceId,key);assert.equal(value.u,'user العربية');assert.equal(value.p,' p&?"% العربية ');
});
test('a changed tag, another device, another key, or malformed token never discloses credentials',()=>{
  const token=envelope(), bytes=Buffer.from(token,'base64url');bytes[14]^=1;
  for(const value of [bytes.toString('base64url'),'garbage','',token+'=']) assert.equal(resolveEnvelope(value,deviceId,key),null);
  assert.equal(resolveEnvelope(token,'BLOFY-OTHER',key),null);assert.equal(resolveEnvelope(token,deviceId,Buffer.alloc(32)),null);
});
test('authenticated expired envelope is recoverable but absent/invalid device or expiry is rejected',()=>{
  assert.ok(resolveEnvelope(envelope({exp:clock-1}),deviceId,key));
  for(const extra of [{exp:0},{exp:'9999999999999'},{d:''},{u:''},{p:''},{u:'u'.repeat(257)},{p:'p'.repeat(513)}]) assert.equal(resolveEnvelope(envelope(extra),deviceId,key),null);
});
test('Android direct response contract, UTF-8 and no-store headers are preserved',async t=>{
  const {call}=await fixture(t);const token=envelope();const r=await call({deviceId,activationCode:pin,sessionTokens:[token]});
  assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
  assert.deepEqual(r.data.items[0],{delivery:'direct',providerName:'مشتركين BLOFY',providerType:'xtream',baseUrl:'https://provider.example/base',username:'user العربية',password:' p&?"% العربية ',sessionToken:token,expiresAt:clock+60000});
});
test('missing PIN/identity is rejected before database access',async t=>{
  const {call,pool}=await fixture(t);
  for(const body of [{},{deviceId,sessionTokens:[envelope()]},{deviceId,activationCode:'bad',sessionTokens:[envelope()]}]) assert.equal((await call(body)).status,403);
  assert.equal(pool.state.queries.length,0);
});
test('rejects null, arrays, malformed JSON and non-JSON content types',async t=>{
  const {call}=await fixture(t);for(const body of [null,[]])assert.equal((await call(body)).status,400);
  assert.equal((await call({}, {body:'{'})).status,400);
  assert.equal((await call({}, {headers:{'content-type':'text/plain'}})).status,415);
});
test('limits batches and individual token sizes before querying the database',async t=>{
  const {call,pool}=await fixture(t);for(const sessionTokens of [[],[null],['x'.repeat(4097)],['a b'],Array(21).fill(envelope())]) assert.equal((await call({deviceId,activationCode:pin,sessionTokens})).status,400);
  assert.equal(pool.state.queries.length,0);
});
test('valid sessions in a batch are not discarded because another envelope is bad',async t=>{
  const {call}=await fixture(t), valid=envelope(),other=envelope({d:'BLOFY-OTHER'});
  const r=await call({deviceId,activationCode:pin,sessionTokens:[valid,other,'garbage',valid]});
  assert.equal(r.status,200);assert.equal(r.data.items.length,3);
  assert.equal(r.data.items[0].delivery,'direct');for(const item of r.data.items.slice(1))assert.deepEqual(Object.keys(item).sort(),['error','sessionToken']);
});
for(const [label,changes] of Object.entries({blocked:{status:'blocked'},expired:{status:'expired'},trialExpired:{status:'trial',expires_at:new Date(clock-1)},locked:{auth_locked_until:new Date(clock+60000)},invalidExpiry:{expires_at:'broken'}})) {
  test('denies '+label+' devices even with correct PIN and envelope',async t=>{const {call}=await fixture(t,{pool:memoryPool(row(changes))});const r=await call();assert.equal(r.status,403);assert.equal(JSON.stringify(r.data).includes('provider.example'),false);});
}
test('unknown device is not registered by the read-only resolver',async t=>{const {call,pool}=await fixture(t,{pool:memoryPool(null)});assert.equal((await call()).status,403);assert.ok(!pool.state.queries.some(x=>x.startsWith('INSERT')));});
test('wrong PIN attempts persist and cannot evade the device lock',async t=>{
  const {call,pool}=await fixture(t);for(let i=0;i<5;i++)assert.equal((await call({deviceId,activationCode:'654321',sessionTokens:[envelope()]})).status,403);
  assert.equal(pool.state.device.auth_failed_attempts,5);assert.ok(pool.state.device.auth_locked_until>new Date(clock));assert.equal((await call()).status,403);
});
test('routine successful resolution does not reset a previous failed PIN count',async t=>{
  const pool=memoryPool(row({auth_failed_attempts:2,last_auth_failure_at:new Date(clock)}));const {call}=await fixture(t,{pool});
  assert.equal((await call()).status,200);assert.equal(pool.state.device.auth_failed_attempts,2);assert.equal(pool.state.releases,1);
});
test('supports existing plaintext pairing records while preserving the stored record',async t=>{
  const pool=memoryPool(row({activation_code:pin}));const {call}=await fixture(t,{pool});assert.equal((await call()).status,200);assert.equal(pool.state.device.activation_code,pin);
});
test('unavailable service returns a bounded generic failure without secrets',async t=>{
  const reports=[];const {call}=await fixture(t,{pool:{async connect(){throw new Error('secret-database-password');}},report:c=>reports.push(c)});
  const r=await call();assert.equal(r.status,503);assert.deepEqual(reports,['subscriber_resolve_unavailable']);assert.ok(!JSON.stringify(r.data).includes('secret'));
});
test('missing host or encryption configuration fails closed',async t=>{
  const {call}=await fixture(t,{subscriberHost:'',keyHex:''});assert.equal((await call()).status,503);
});
test('only the resolver endpoint is handled; legacy media, session and portal paths remain unchanged',async t=>{
  const {base}=await fixture(t);
  for(const path of ['/api/v1/subscribers/session','/api/v1/subscribers/xtream/player_api.php','/api/v1/portal/playlists/list','/health'])assert.equal((await fetch(base+path)).status,404);
  const r=await fetch(base+'/api/v1/subscribers/resolve');assert.equal(r.status,405);assert.equal(r.headers.get('allow'),'POST');
});
test('bounded device request rate has a Retry-After header',async t=>{
  const {call}=await fixture(t);for(let i=0;i<20;i++)assert.equal((await call()).status,200);
  const r=await call();assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
});

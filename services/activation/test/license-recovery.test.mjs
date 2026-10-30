import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createLicenseRecoveryHandlers } from '../src/license-recovery.mjs';

const originalId = 'BLOFY-ABCD-1234', newId = 'BLOFY-EFGH-5678';
const originalPin = '234567', newPin = '789012';
const keyHex = 'a1'.repeat(32);
const proof = (id,pin) => crypto.createHmac('sha256',Buffer.from(keyHex,'hex'))
  .update(id+':'+pin).digest('hex');

function createFixture({ originalStatus='active',targetStatus='trial',freshLinked=false }={}) {
  const state = {
    devices: new Map([
      [originalId,{device_id:originalId,activation_code:proof(originalId,originalPin),status:originalStatus,
        expires_at:'2030-01-01T00:00:00Z'}],
      [newId,{device_id:newId,activation_code:proof(newId,newPin),status:targetStatus,
        expires_at:'2026-11-06T00:00:00Z'}]
    ]),
    tokens: new Map(),aliases: new Map(),audits:[],locked:[],
    linkCounts: freshLinked ? {playlists:1,subscriptions:0,orders:0,customers:0}
      : {playlists:0,subscriptions:0,orders:0,customers:0}
  };
  const db = async (sql,params=[]) => {
    if (sql==='BEGIN' || sql==='COMMIT' || sql==='ROLLBACK') return {rows:[]};
    if (sql.includes('pg_advisory_xact_lock')) {state.locked.push(params[0]);return {rows:[]};}
    if (sql.includes('INSERT INTO license_recovery_codes')) {
      state.tokens.set(params[0],{hash:params[1],used:false,expires:Date.now()+720*86400000});
      return {rows:[{expires_at:new Date(Date.now()+720*86400000).toISOString()}]};
    }
    if (sql.includes('FROM license_recovery_codes') && sql.includes('code_hash=$1'))
      return {rows:[...state.tokens].filter(([,v])=>v.hash===params[0]&&!v.used&&v.expires>Date.now()).map(([device_id])=>({device_id}))};
    if (sql.includes('FROM license_recovery_codes') && sql.includes('device_id=$1'))
      return {rows:[...state.tokens].filter(([id,v])=>id===params[0]&&!v.used&&v.expires>Date.now()).map(([,v])=>({code_hash:v.hash}))};
    if (sql.includes('UPDATE license_recovery_codes SET used_at')) {
      const token=state.tokens.get(params[0]);if(token)token.used=true;return {rows:[]};
    }
    if (sql.includes('SELECT * FROM devices')) {
      return {rows:state.devices.has(params[0])?[state.devices.get(params[0])]:[]};
    }
    if (sql.includes('FROM device_identity_aliases')) {
      return {rows:state.aliases.has(params[0])?[{canonical_device_id:state.aliases.get(params[0]).canonical}]:[]};
    }
    if (sql.includes('SELECT')&&sql.includes('device_playlists WHERE device_id=$1'))
      return {rows:[state.linkCounts]};
    if (sql.includes('DELETE FROM devices')) {state.devices.delete(params[0]);return {rows:[]};}
    if (sql.includes('INSERT INTO device_identity_aliases')) {
      state.aliases.set(params[0],{canonical:params[1],proof:params[2]});return {rows:[]};
    }
    if (sql.includes('UPDATE devices')&&sql.includes('SET activation_code=$2')) {
      state.devices.get(params[0]).activation_code=params[1];return {rows:[]};
    }
    if (sql.includes('INSERT INTO device_audit')) {
      state.audits.push({id:params[0],actor:params[1],newId:params[2]});return {rows:[]};
    }
    throw Error('Unexpected SQL: '+sql.slice(0,130));
  };
  const pool={query:db,connect:async()=>({query:db,release(){}})};
  const responses=[];
  const json=(res,status,body)=>{responses.push({status,body});return {status,body}};
  const handlers=createLicenseRecoveryHandlers({
    pool,json,readJson:async req=>req.body||{},
    keyHex,
    authorizedDevice:async id=>state.devices.get(id)||null,
    verifyDeviceCredential:async(_client,row,pin)=>row.activation_code===proof(row.device_id,pin),
    activationCredentials:{proof},
    consumeDeviceAuthAttempt:()=>{},
    requireAdmin:(req,res)=>{
      if(req.headers?.authorization==='Bearer trusted-admin')return true;
      json(res,401,{error:'unauthorized'});return false;
    }
  });
  const request=async(path,body={},headers={})=>{
    responses.length=0;
    await handlers.handle({method:'POST',body,headers},{},path);
    return responses.at(-1);
  };
  return {state,request};
}
test('generates one-time 32-character proof for active licenses and trials',async()=>{
  const f=createFixture();
  const a=await f.request('/api/v1/license/recovery/create',{deviceId:originalId,activationCode:originalPin});
  assert.equal(a.status,200);
  assert.match(a.body.recoveryCode,/^[A-Za-z0-9_-]{32}$/);
  assert.ok(f.state.tokens.has(originalId));
  const trial=await f.request('/api/v1/license/recovery/create',{deviceId:newId,activationCode:newPin});
  assert.equal(trial.status,200);
  assert.match(trial.body.recoveryCode,/^[A-Za-z0-9_-]{32}$/);
});
test('factory-reset restore retains canonical ID, original expiry and subscriptions',async()=>{
  const f=createFixture();
  const key=(await f.request('/api/v1/license/recovery/create',{deviceId:originalId,activationCode:originalPin})).body.recoveryCode;
  const done=await f.request('/api/v1/license/recovery/restore',{deviceId:newId,activationCode:newPin,recoveryCode:key});
  assert.equal(done.status,200);assert.equal(done.body.canonicalDeviceId,originalId);
  assert.equal(f.state.devices.has(newId),false);
  assert.equal(f.state.devices.get(originalId).expires_at,'2030-01-01T00:00:00Z');
  assert.equal(f.state.devices.get(originalId).activation_code,proof(originalId,newPin));
  assert.equal(f.state.aliases.get(newId).canonical,originalId);
  assert.equal(f.state.aliases.get(newId).proof,proof(newId,newPin));
  assert.equal(f.state.tokens.get(originalId).used,true);
  const reuse=await f.request('/api/v1/license/recovery/restore',{deviceId:newId,activationCode:newPin,recoveryCode:key});
  assert.equal(reuse.status,403);
  assert.equal(reuse.body.error,'invalid_recovery_code');
});
test('cannot discard a newly paid or already populated target license',async()=>{
  for(const f of [createFixture({targetStatus:'active'}),createFixture({freshLinked:true})]){
    const key=(await f.request('/api/v1/license/recovery/create',{deviceId:originalId,activationCode:originalPin})).body.recoveryCode;
    const done=await f.request('/api/v1/license/recovery/restore',{deviceId:newId,activationCode:newPin,recoveryCode:key});
    assert.equal(done.status,409);
    assert.equal(f.state.devices.has(newId),true);
    assert.equal(f.state.tokens.get(originalId).used,false);
  }
});
test('admin recovery requires explicit ownership confirmation and live target proof',async()=>{
  const f=createFixture();
  const body={originalDeviceId:originalId,targetDeviceId:newId,targetActivationCode:newPin,
    confirmedOwnership:true,reason:'Customer verified purchase receipt and registration'};
  const forbidden=await f.request('/api/v1/admin/device/recovery/restore',body);
  assert.equal(forbidden.status,401);
  const missing=await f.request('/api/v1/admin/device/recovery/restore',
    {...body,confirmedOwnership:false},{authorization:'Bearer trusted-admin'});
  assert.equal(missing.status,400);
  const wrong=await f.request('/api/v1/admin/device/recovery/restore',
    {...body,targetActivationCode:'000000'},{authorization:'Bearer trusted-admin'});
  assert.equal(wrong.status,403);
  const success=await f.request('/api/v1/admin/device/recovery/restore',
    body,{authorization:'Bearer trusted-admin'});
  assert.equal(success.status,200);
  assert.equal(success.body.canonicalDeviceId,originalId);
  assert.equal(f.state.audits.at(-1).actor,'admin');
});

test('original trial stays a trial with the original expiry after reset',async()=>{
  const f=createFixture({originalStatus:'trial'});
  const key=(await f.request('/api/v1/license/recovery/create',{deviceId:originalId,activationCode:originalPin})).body.recoveryCode;
  const result=await f.request('/api/v1/license/recovery/restore',{deviceId:newId,activationCode:newPin,recoveryCode:key});
  assert.equal(result.status,200);
  assert.equal(f.state.devices.get(originalId).status,'trial');
  assert.equal(f.state.devices.get(originalId).expires_at,'2030-01-01T00:00:00Z');
});
test('blocked identity cannot create backup or recover',async()=>{
  const f=createFixture({originalStatus:'blocked'});
  const token=await f.request('/api/v1/license/recovery/create',{deviceId:originalId,activationCode:originalPin});
  assert.equal(token.status,403);
  assert.equal(token.body.error,'recovery_unavailable');
});

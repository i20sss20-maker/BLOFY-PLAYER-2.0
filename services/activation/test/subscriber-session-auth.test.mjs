import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createSubscriberSessionAuthorizer } from '../src/subscriber-session-auth.mjs';
import { createActivationCredentialCodec } from '../src/auth-protection.mjs';

const keyHex='42'.repeat(32), deviceId='BLOFY-AUTH-TEST', pin='123456';
const req={headers:{},socket:{remoteAddress:'127.0.0.1'}};
const now=()=>2_000_000_000_000;
const row=()=>({device_id:deviceId,activation_code:createActivationCredentialCodec(keyHex).proof(deviceId,pin),
  status:'active',expires_at:null,auth_failed_attempts:0});
function memoryPool(device=row()) {
  let releases=0;
  return {device,get releases(){return releases;},async connect(){return {
    release(){releases++;},async query(sql,args=[]){
      if(sql.startsWith('SELECT')) return {rows:device?[device]:[]};
      if(sql.startsWith('UPDATE'))Object.assign(device,{auth_failed_attempts:args[1],last_auth_failure_at:args[2],auth_locked_until:args[3]});
      return {rows:[]};
    }
  };}};
}
test('wrong PIN budget survives a new authorizer and legitimate requests do not reset it',async()=>{
  const pool=memoryPool();
  let auth=createSubscriberSessionAuthorizer({pool,keyHex,now,env:{}});
  for(let i=0;i<3;i++)assert.equal((await auth(req,deviceId,'654321')).status,403);
  assert.equal((await auth(req,deviceId,pin)).allowed,true);
  auth=createSubscriberSessionAuthorizer({pool,keyHex,now,env:{}});
  for(let i=0;i<2;i++)assert.equal((await auth(req,deviceId,'654321')).status,403);
  assert.equal(pool.device.auth_failed_attempts,5);
  assert.equal((await auth(req,deviceId,pin)).status,403);
  assert.equal(pool.releases,7);
});
test('blocked expired malformed and missing devices cannot create subscriber sessions',async()=>{
  for(const device of [null,{...row(),status:'blocked'},{...row(),expires_at:new Date(now()-1)},
    {...row(),expires_at:'invalid'},{...row(),auth_locked_until:new Date(now()+60_000)}]){
    const auth=createSubscriberSessionAuthorizer({pool:memoryPool(device),keyHex,now,env:{}});
    assert.equal((await auth(req,deviceId,pin)).status,403);
  }
  const pool=memoryPool(),auth=createSubscriberSessionAuthorizer({pool,keyHex,now,env:{}});
  assert.equal((await auth(req,deviceId,'not-a-pin')).status,403);assert.equal(pool.releases,0);
});
test('rate limits return bounded retry information and database failures cannot authorize',async()=>{
  const pool=memoryPool(),auth=createSubscriberSessionAuthorizer({pool,keyHex,now,env:{BLOFY_AUTH_DEVICE_RATE_LIMIT:'1'}});
  assert.equal((await auth(req,deviceId,pin)).allowed,true);
  assert.deepEqual(await auth(req,deviceId,pin),{allowed:false,status:429,error:'rate_limited',retryAfterSeconds:60});
  const broken=createSubscriberSessionAuthorizer({pool:{connect:async()=>{throw Error('db unavailable');}},keyHex,now,env:{}});
  await assert.rejects(()=>broken(req,deviceId,pin),/db unavailable/);
});

test('PostgreSQL: concurrent workers persist exactly five failures and lock new processes',
  {skip:!process.env.BLOFY_TEST_DATABASE_URL},async()=>{
    const {default:pg}=await import('pg');
    const schema='session_auth_'+crypto.randomUUID().replaceAll('-','');
    const setup=new pg.Pool({connectionString:process.env.BLOFY_TEST_DATABASE_URL,ssl:false});
    await setup.query(`CREATE SCHEMA ${schema}`);
    const pool=new pg.Pool({connectionString:process.env.BLOFY_TEST_DATABASE_URL,ssl:false,options:`-c search_path=${schema}`,max:8});
    try {
      await pool.query(`CREATE TABLE devices(device_id TEXT PRIMARY KEY,activation_code TEXT,status TEXT,
        expires_at TIMESTAMPTZ,auth_failed_attempts INT DEFAULT 0,last_auth_failure_at TIMESTAMPTZ,
        auth_locked_until TIMESTAMPTZ,updated_at TIMESTAMPTZ)`);
      await pool.query('INSERT INTO devices(device_id,activation_code,status) VALUES($1,$2,$3)',[deviceId,row().activation_code,'active']);
      const workers=Array.from({length:8},()=>createSubscriberSessionAuthorizer({pool,keyHex,now,env:{}}));
      assert.ok((await Promise.all(workers.map(auth=>auth(req,deviceId,'654321')))).every(r=>r.status===403));
      const saved=(await pool.query('SELECT * FROM devices WHERE device_id=$1',[deviceId])).rows[0];
      assert.equal(saved.auth_failed_attempts,5);assert.ok(saved.auth_locked_until.getTime()>now());
      assert.equal((await createSubscriberSessionAuthorizer({pool,keyHex,now,env:{}})(req,deviceId,pin)).status,403);
    } finally {await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();}
  });

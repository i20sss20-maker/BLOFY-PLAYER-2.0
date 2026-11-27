import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,randomUUID,randomBytes,sign} from 'node:crypto';
import {createMultiLeasePoll} from '../../src/blofy-multifeed-lease-poll.mjs';
import {signLiveLease,verifyLiveLease} from '../../src/blofy-live-worker-lease.mjs';
test('signed batches are scoped to one worker, bounded, replay protected and disabled by default',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const controller=generateKeyPairSync('ed25519'),a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
  const workerKeys={hostbrr:a.publicKey,linode:b.publicKey};
  let now=1700000000000,calls=0;
  const sourceId=randomUUID();
  const batch=Array.from({length:16},(_,i)=>signLiveLease({version:1,sourceId,engineId:'hostbrr',channelId:String(i+1),reservationId:randomUUID(),sequence:1,issuedAt:now,expiresAt:now+60000},controller.privateKey,now));
  let issued=batch;
  const open=(enabled=false)=>createMultiLeasePoll({db,workerKeys,controllerKey:controller.privateKey,enabled,clock:()=>now,issueCommittedBatch:async()=>{calls++;return issued}});
  const status=(id='hostbrr',key=a.privateKey,deliveryActive=true)=>{
   const s={version:1,engineId:id,challenge:randomBytes(16).toString('hex'),observedAt:now,deliveryActive,heartbeatActive:true};
   return {status:s,signature:sign(null,Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...Object.values(s)])),key).toString('base64url')};
  };
  assert.deepEqual((await open()(status())).body.leases,[]);
  assert.equal(calls,0);
  const poll=open(true),e=status();
  assert.equal((await poll(status('hostbrr',b.privateKey))).code,403);
  assert.deepEqual((await poll(status('hostbrr',a.privateKey,false))).body.leases,[]);
  assert.equal(calls,0);
  const result=await poll(e);
  assert.equal(result.code,200);
  assert.equal(result.body.leases.length,16);
  assert.ok(result.body.leases.every(x=>verifyLiveLease(x,{key:controller.publicKey,identity:x.lease,now})));
  assert.equal((await open(true)(e)).code,429);
  assert.equal((await poll(status('linode',b.privateKey))).code,409);
  issued=[batch[0],batch[0]];
  assert.equal((await poll(status())).code,409);
  issued=[...batch,batch[0]];
  assert.equal((await poll(status())).code,409);
  issued=[{...batch[0],signature:'a'.repeat(86)}];
  assert.equal((await poll(status())).code,409);
  issued=batch;now+=61000;
  assert.equal((await poll(status())).code,409);
 }finally{db.close()}
});

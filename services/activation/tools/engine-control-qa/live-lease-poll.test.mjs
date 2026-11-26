import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,randomUUID,randomBytes,sign} from 'node:crypto';
import {createLiveLeasePoll} from '../../src/blofy-live-lease-poll.mjs';
import {signLiveLease,verifyLiveLease} from '../../src/blofy-live-worker-lease.mjs';
test('authenticated polls issue only from matching committed ledger with fresh fence',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519'),c=generateKeyPairSync('ed25519');
  const now=Date.now(),identity={engineId:'hostbrr',sourceId:randomUUID(),channelId:'123',reservationId:randomUUID()};
  const proof=(engineId='hostbrr',key=a.privateKey)=>{const status={version:1,engineId,challenge:randomBytes(16).toString('hex'),observedAt:now,deliveryActive:true,heartbeatActive:true};return {status,signature:sign(null,Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...Object.values(status)])),key).toString('base64url')}};
  let calls=0,fence=null,state='pending';
  const ledger={readRoutingState:async()=>({...identity,state}),issueWorkerLease:async({fence:f,signingKey})=>{if(!f)return {ok:false};calls++;return {ok:true,...signLiveLease({version:1,...identity,sequence:calls,issuedAt:now,expiresAt:now+60000},signingKey,now)}}};
  const make=(enabled=true)=>createLiveLeasePoll({db,ledger,readFence:async()=>fence,controllerKey:c.privateKey,workerKeys:{hostbrr:a.publicKey,linode:b.publicKey},sourceId:identity.sourceId,enabled,clock:()=>now});
  let poll=make(false);assert.equal((await poll(proof())).body.lease,null);
  poll=make();assert.equal((await poll(proof('hostbrr',b.privateKey))).code,403);
  assert.equal((await poll(proof('linode',b.privateKey))).body.lease,null);
  assert.equal((await poll(proof())).body.lease,null);
  fence={scope:'all_paths',authoritative:true};
  const p=proof();const r=await poll(p);assert.equal(r.code,200);
  assert.ok(verifyLiveLease({lease:r.body.lease,signature:r.body.signature},{key:c.publicKey,identity,now}));
  poll=make();assert.equal((await poll(p)).code,429);
  state='unknown';assert.equal((await poll(proof())).body.lease,null);
  assert.equal(calls,1);
 }finally{db.close()}
});

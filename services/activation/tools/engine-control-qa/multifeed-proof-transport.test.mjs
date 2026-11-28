import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,randomUUID,randomBytes,sign} from 'node:crypto';
import {createMultiFeedProofTransport} from '../../src/blofy-multifeed-proof-transport.mjs';
import {signFeedProof} from '../../src/blofy-live-feed-proof.mjs';
test('sixteen independent signed feed proofs, revoked and replayed evidence denied',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
  const workerKeys={hostbrr:a.publicKey,linode:b.publicKey};
  let now=1700000000000;
  const sourceId=randomUUID();
  let rows=Array.from({length:16},(_,i)=>({sourceId,engineId:'hostbrr',channelId:String(i+1),reservationId:randomUUID(),state:'starting'}));
  const open=(enabled=true)=>createMultiFeedProofTransport({db,workerKeys,readReservations:async id=>rows.filter(r=>r.engineId===id),enabled,clock:()=>now});
  const status=(id='hostbrr',key=a.privateKey)=>{
   const s={version:1,engineId:id,challenge:randomBytes(16).toString('hex'),observedAt:now,deliveryActive:true,heartbeatActive:true};
   return {status:s,signature:sign(null,Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...Object.values(s)])),key).toString('base64url')};
  };
  const t=open(),e=status();
  assert.deepEqual((await open(false).poll(e)).body.challenges,[]);
  assert.deepEqual((await t.poll(status('linode',b.privateKey))).body.challenges,[]);
  assert.equal((await t.poll(status('hostbrr',b.privateKey))).code,403);
  const result=await t.poll(e);
  assert.equal(result.code,200);assert.equal(result.body.challenges.length,16);
  assert.equal(new Set(result.body.challenges.map(x=>x.challenge)).size,16);
  assert.equal((await t.poll(e)).code,429);
  const proofs=result.body.challenges.map(({identity,challenge})=>({version:1,...identity,challenge,observedAt:now,status:'private_hls_ready',lastSegment:4,localSourceConnections:1}));
  assert.equal((await t.complete(signFeedProof(proofs[0],b.privateKey,now))).code,409);
  rows[0].state='release_unknown';
  assert.equal((await t.complete(signFeedProof(proofs[0],a.privateKey,now))).code,409);
  rows[0].state='starting';
  const accepted=await Promise.all(proofs.map(p=>t.complete(signFeedProof(p,a.privateKey,now))));
  assert.equal(accepted.filter(r=>r.code===200).length,16);
  assert.equal((await open().complete(signFeedProof(proofs[0],a.privateKey,now))).code,409);
  for(const {identity} of result.body.challenges)assert.equal(open().read(identity).lastSegment,4);
  now+=10001;
  assert.equal(open().read(result.body.challenges[0].identity),null);
  rows.push({...rows[0],reservationId:randomUUID()});
  assert.equal((await t.poll(status())).code,409);
 }finally{db.close()}
});

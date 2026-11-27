import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,randomUUID,randomBytes,sign} from 'node:crypto';
import {createFeedProofTransport} from '../../src/blofy-live-feed-proof-transport.mjs';
import {signFeedProof} from '../../src/blofy-live-feed-proof.mjs';
test('worker challenge only for committed current reservation; revoked, wrong and replayed proof denied',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
  let now=1700000000000;
  const reservationId=randomUUID(),sourceId=randomUUID();
  let reservation={sourceId,engineId:'hostbrr',channelId:'123',reservationId,state:'pending'};
  const open=(enabled=true)=>createFeedProofTransport({db,workerKeys:{hostbrr:a.publicKey,linode:b.publicKey},readReservation:async()=>reservation,enabled,clock:()=>now});
  const status=(id='hostbrr',key=a.privateKey)=>{
   const s={version:1,engineId:id,challenge:randomBytes(16).toString('hex'),observedAt:now,deliveryActive:true,heartbeatActive:true};
   return {status:s,signature:sign(null,Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...Object.values(s)])),key).toString('base64url')};
  };
  const t=open(),e=status();
  assert.equal((await open(false).poll(e)).body.challenge,null);
  assert.equal((await t.poll(status('linode',b.privateKey))).body.challenge,null);
  assert.equal((await t.poll(status('hostbrr',b.privateKey))).code,403);
  const result=await t.poll(e);
  assert.equal(result.code,200);
  assert.equal(result.body.identity.generation,reservationId.replaceAll('-',''));
  assert.equal((await t.poll(e)).code,429);
  const {identity,challenge}=result.body;
  const p={version:1,...identity,challenge,observedAt:now,status:'private_hls_ready',lastSegment:4,localSourceConnections:1};
  assert.equal((await t.complete(signFeedProof(p,b.privateKey,now))).code,409);
  reservation={...reservation,state:'unknown'};
  assert.equal((await t.complete(signFeedProof(p,a.privateKey,now))).code,409);
  reservation={...reservation,state:'pending'};
  assert.equal((await t.complete(signFeedProof(p,a.privateKey,now))).code,200);
  assert.equal((await open().complete(signFeedProof(p,a.privateKey,now))).code,409);
  assert.equal(open().read(identity).lastSegment,4);
  now+=10001;assert.equal(open().read(identity),null);
 }finally{db.close()}
});

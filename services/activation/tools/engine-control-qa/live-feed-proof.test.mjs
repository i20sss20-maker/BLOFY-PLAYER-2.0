import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {signFeedProof} from '../../src/blofy-live-feed-proof.mjs';
import {createLiveFeedProofInbox} from '../../src/blofy-live-feed-proof-inbox.mjs';
test('feed proof challenges are scoped, one-use, fresh and terminally fenced',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
  let now=1700000000000;
  const identity={engineId:'hostbrr',sourceId:randomUUID(),channelId:'123',reservationId:randomUUID(),generation:'a'.repeat(32)};
  const open=()=>createLiveFeedProofInbox(db,{workerKeys:{hostbrr:a.publicKey,linode:b.publicKey},clock:()=>now});
  let inbox=open();
  const signed=(challenge,overrides={},key=a.privateKey)=>signFeedProof({version:1,...identity,challenge,observedAt:now,status:'private_hls_ready',lastSegment:5,localSourceConnections:1,...overrides},key,now);
  const c=inbox.issue(identity).challenge;
  assert.equal(inbox.accept(signed(c,{},b.privateKey)),false);
  assert.equal(inbox.accept(signed(c,{generation:'b'.repeat(32)})),false);
  assert.equal(inbox.accept(signed(c)),true);
  inbox=open();assert.equal(inbox.accept(signed(c)),false);
  assert.equal(inbox.read(identity).lastSegment,5);
  now+=10001;assert.equal(inbox.read(identity),null);
  const old=inbox.issue(identity).challenge;now+=10001;
  assert.equal(inbox.accept(signed(old)),false);
  const stop=inbox.issue(identity).challenge;
  assert.equal(inbox.accept(signed(stop,{status:'stopped_and_fenced',lastSegment:null,localSourceConnections:0})),true);
  now+=100;assert.equal(inbox.accept(signed(inbox.issue(identity).challenge)),false);
  assert.equal(inbox.read(identity).status,'stopped_and_fenced');
 }finally{db.close()}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {signLeaseClaim,verifyLeaseClaim,createLeaseClaimHandler,createLeaseClaimClient} from '../src/blofy-engine-lease-claim.mjs';
import {verifyLiveLease} from '../src/blofy-live-worker-lease.mjs';
const keys=generateKeyPairSync('ed25519'),now=Date.now();
const identity={sourceId:randomUUID(),reservationId:randomUUID(),engineId:'hostbrr',channelId:'123'};
test('claims are bound to exact signed reservation, nonce and time',()=>{
 const e=signLeaseClaim(identity,keys.privateKey,now);
 assert.equal(verifyLeaseClaim(e,keys.publicKey,now),true);
 assert.equal(verifyLeaseClaim({...e,engineId:'linode'},keys.publicKey,now),false);
 assert.equal(verifyLeaseClaim({...e,fence:{authoritative:true}},keys.publicKey,now),false);
 assert.equal(verifyLeaseClaim(e,keys.publicKey,now+10001),false);
});
test('no lease claims without independent fence, and no replay',async()=>{
 let fence=null,claims=0;
 const seen=new Set();
 const handler=createLeaseClaimHandler({enabled:true,key:keys.publicKey,clock:()=>now,
  claimNonce:async n=>{if(seen.has(n))return false;seen.add(n);return true},
  readFence:async()=>fence,ledger:{claimWorkerLease:async input=>{
   claims++;assert.equal(input.reservationId,identity.reservationId);
   return {ok:true,lease:{version:1,...identity,sequence:claims,issuedAt:now,expiresAt:now+60000}};
  }}});
 const e=()=>signLeaseClaim(identity,keys.privateKey,now);
 assert.equal((await handler(e())).code,409);
 fence={...identity,authoritative:true,scope:'local'};
 assert.equal((await handler(e())).code,409);
 assert.equal(claims,0);
 fence={...identity,authoritative:true,scope:'all_paths',observedAt:now,expiresAt:now+60000};
 const request=e();
 assert.equal((await handler(request)).code,200);
 assert.equal((await handler(request)).code,409);
 assert.equal(claims,1);
 const client=createLeaseClaimClient({controllerKey:keys.privateKey,enabled:true,clock:()=>now,fetchImpl:async(url,opts)=>{
  const result=await handler(JSON.parse(opts.body));
  return new Response(JSON.stringify(result.body),{status:result.code});
 }});
 const signed=await client(identity);
 assert.equal(signed.lease.sequence,2);
 assert.equal(verifyLiveLease(signed,{key:keys.publicKey,identity,now}),true);
});
test('disabled or missing verifier cannot claim or sign',async()=>{
 const handler=createLeaseClaimHandler({enabled:true,key:keys.publicKey,ledger:{claimWorkerLease:()=>{throw Error('unexpected')}}});
 assert.equal((await handler(signLeaseClaim(identity,keys.privateKey,now))).code,503);
 const client=createLeaseClaimClient({controllerKey:keys.privateKey,fetchImpl:()=>{throw Error('unexpected')}});
 assert.equal(await client(identity),null);
});

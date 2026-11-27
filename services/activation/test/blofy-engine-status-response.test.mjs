import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyWorkerStatus} from '../src/blofy-engine-status-response.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const now=1700000000000,challenge='a'.repeat(32),engineId='linode';
const s={version:1,engineId,challenge,observedAt:now,deliveryActive:true,heartbeatActive:true};
const opts={publicKey,engineId,challenge,now};
function signed(status){
 const p=Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',status.version,status.engineId,status.challenge,status.observedAt,status.deliveryActive,status.heartbeatActive]));
 return {status,signature:sign(null,p,privateKey).toString('base64url')};
}
test('signed status accepted, wrong target or challenge rejected',()=>{
 const e=signed(s);
 assert.equal(verifyWorkerStatus(e,opts),true);
 assert.equal(verifyWorkerStatus(e,{...opts,engineId:'hostbrr'}),false);
 assert.equal(verifyWorkerStatus(e,{...opts,challenge:'b'.repeat(32)}),false);
 assert.equal(verifyWorkerStatus(e,{...opts,publicKey:generateKeyPairSync('ed25519').publicKey}),false);
});
test('stale, future, extra fields and tampered status rejected',()=>{
 assert.equal(verifyWorkerStatus(signed({...s,observedAt:now-31000}),opts),false);
 assert.equal(verifyWorkerStatus(signed({...s,observedAt:now+3000}),opts),false);
 assert.equal(verifyWorkerStatus(signed({...s,other:1}),opts),false);
 const e=signed(s);
 assert.equal(verifyWorkerStatus({...e,status:{...s,deliveryActive:false}},opts),false);
 assert.equal(verifyWorkerStatus(signed({...s,deliveryActive:false}),opts),true);
});

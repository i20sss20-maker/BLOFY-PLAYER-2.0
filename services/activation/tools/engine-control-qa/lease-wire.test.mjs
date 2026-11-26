import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {signLiveLease} from '../../src/blofy-live-worker-lease.mjs';
// Verify the real Node signer and OpenSSL Python verifier agree on the bytes,
// using a disposable key. The production controller key is never exported.
test('node lease wire interoperates with the actual python guard',{timeout:15000},()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const identity={engineId:'hostbrr',sourceId:randomUUID(),channelId:'123',reservationId:randomUUID()};
 const now=Date.now(),first={version:1,...identity,sequence:1,issuedAt:now,expiresAt:now+40000};
 const renewal={...first,sequence:2,issuedAt:now+1000,expiresAt:now+60000};
 const data={pin:publicKey.export({type:'spki',format:'der'}).toString('base64'),identity,first:signLiveLease(first,privateKey,now),renewal:signLiveLease(renewal,privateKey,now+1000)};
 const r=spawnSync('python3',['tools/engine-control-qa/lease-wire-check.py'],{input:JSON.stringify(data),encoding:'utf8',timeout:10000});
 assert.equal(r.status,0,r.stderr||r.error?.message);assert.match(r.stdout,/BLOFY_LEASE_WIRE_PASS/);
});

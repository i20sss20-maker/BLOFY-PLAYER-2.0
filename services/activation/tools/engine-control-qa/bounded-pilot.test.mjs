import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,verify,randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createBoundedPilotPermit} from '../../src/blofy-bounded-pilot-permit.mjs';
test('permit is disabled by default, pinned, bounded and exclusive',()=>{
 const db=new DatabaseSync(':memory:');
 const controller=generateKeyPairSync('ed25519'),a=generateKeyPairSync('ed25519'),b=generateKeyPairSync('ed25519');
 let now=1700000000000;const env={};
 const open=()=>createBoundedPilotPermit(db,{controllerKey:controller.privateKey,workerKeys:{linode:a.publicKey,hostbrr:b.publicKey},clock:()=>now,env});
 const proof=(engineId,key,deliveryActive=true)=>{const status={version:1,engineId,challenge:randomBytes(16).toString('hex'),observedAt:now,deliveryActive,heartbeatActive:true};return {status,signature:sign(null,Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...Object.values(status)])),key).toString('base64url')}};
 try{
 let poll=open();
 assert.equal(poll(proof('hostbrr',b.privateKey)).body.permit,null);
 Object.assign(env,{BLOFY_BOUNDED_PILOT_EXCLUSIVE_CONFIRMED:'1',BLOFY_BOUNDED_PILOT_ENGINE:'hostbrr',BLOFY_BOUNDED_PILOT_PERMIT_ID:randomUUID(),BLOFY_BOUNDED_PILOT_EXPIRES_MS:String(now+300000)});
 assert.equal(poll(proof('hostbrr',a.privateKey)).code,403);
 assert.equal(poll(proof('linode',a.privateKey)).body.permit,null);
 assert.equal(poll(proof('hostbrr',b.privateKey,false)).code,409);
 const first=poll(proof('hostbrr',b.privateKey));assert.equal(first.code,200);
 const p=first.body.permit;
 assert.equal(verify(null,Buffer.from(JSON.stringify(['BLOFY_BOUNDED_PILOT_V1',p.version,p.engineId,p.operation,p.permitId,p.issuedAt,p.expiresAt])),controller.publicKey,Buffer.from(first.body.signature,'base64url')),true);
 poll=open();assert.deepEqual(poll(proof('hostbrr',b.privateKey)),first);
 env.BLOFY_BOUNDED_PILOT_EXPIRES_MS=String(now+310000);assert.equal(poll(proof('hostbrr',b.privateKey)).code,409);
 env.BLOFY_BOUNDED_PILOT_ENGINE='linode';env.BLOFY_BOUNDED_PILOT_PERMIT_ID=randomUUID();
 assert.equal(poll(proof('linode',a.privateKey)).code,409);
 now+=310000;assert.equal(poll(proof('linode',a.privateKey)).body.permit,null);
 }finally{db.close()}
});

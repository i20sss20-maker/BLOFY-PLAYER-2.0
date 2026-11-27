import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {signStatusCommand,verifyStatusCommand} from '../src/blofy-engine-status-command.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const now=1700000000000;
const cmd={version:1,engineId:'linode',operation:'status',challenge:'a'.repeat(32),issuedAt:now,expiresAt:now+10000};
test('valid signed status bound to correct engine',()=>{
 const e=signStatusCommand(cmd,privateKey,now);
 assert.equal(verifyStatusCommand(e,publicKey,'linode',now),true);
 assert.equal(verifyStatusCommand(e,publicKey,'hostbrr',now),false);
});
test('tampered, expired, forged and extra fields fail',()=>{
 const e=signStatusCommand(cmd,privateKey,now);
 const other=generateKeyPairSync('ed25519').publicKey;
 assert.equal(verifyStatusCommand(e,other,'linode',now),false);
 assert.equal(verifyStatusCommand(e,publicKey,'linode',now+10000),false);
 assert.equal(verifyStatusCommand({...e,command:{...cmd,challenge:'b'.repeat(32)}},publicKey,'linode',now),false);
 assert.equal(verifyStatusCommand({...e,command:{...cmd,extra:true}},publicKey,'linode',now),false);
 assert.equal(verifyStatusCommand({...e,signature:e.signature+'='},publicKey,'linode',now),false);
});
test('start and stop are not supported, bounded time only',()=>{
 for(const operation of ['start','stop','shell'])assert.throws(()=>signStatusCommand({...cmd,operation},privateKey,now));
 assert.throws(()=>signStatusCommand({...cmd,expiresAt:now+60000},privateKey,now));
 assert.throws(()=>signStatusCommand({...cmd,issuedAt:now+3000},privateKey,now));
});

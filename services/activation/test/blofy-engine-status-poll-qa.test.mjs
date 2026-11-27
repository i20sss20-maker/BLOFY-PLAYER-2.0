import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createStatusPollQa} from '../src/blofy-engine-status-poll-qa.mjs';
import {verifyStatusCommand} from '../src/blofy-engine-status-command.mjs';
const controller=generateKeyPairSync('ed25519'),linode=generateKeyPairSync('ed25519'),hostbrr=generateKeyPairSync('ed25519');
function setup(){let now=1700000000000;return {qa:createStatusPollQa({controllerKey:controller.privateKey,workerKeys:{linode:linode.publicKey,hostbrr:hostbrr.publicKey},clock:()=>now}),advance:n=>now+=n,now:()=>now}}
function response(c,key,now){const s={version:1,engineId:c.engineId,challenge:c.challenge,observedAt:now,deliveryActive:true,heartbeatActive:true};return {status:s,signature:sign(null,Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...Object.values(s)])),key).toString('base64url')}}
test('signed poll, target identity, one-time completion',()=>{const {qa,now}=setup();const e=qa.poll('linode');assert.equal(verifyStatusCommand(e,controller.publicKey,'linode',now()),true);assert.equal(qa.poll('linode'),e);const r=response(e.command,linode.privateKey,now());assert.equal(qa.complete('hostbrr',r).ok,false);assert.equal(qa.complete('linode',r).ok,true);assert.equal(qa.complete('linode',r).ok,false);assert.notEqual(qa.poll('linode').command.challenge,e.command.challenge)});
test('expired and wrong-key responses fail closed',()=>{const {qa,now,advance}=setup();const e=qa.poll('linode');assert.equal(qa.complete('linode',response(e.command,hostbrr.privateKey,now())).ok,false);advance(26000);assert.equal(qa.complete('linode',response(e.command,linode.privateKey,now())).ok,false);assert.notEqual(qa.poll('linode').command.challenge,e.command.challenge);assert.equal(qa.poll('unknown'),null)});

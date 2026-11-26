import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDurableStatusTransport} from '../../src/blofy-engine-durable-status.mjs';
import {verifyStatusCommand} from '../../src/blofy-engine-status-command.mjs';
test('persistent replay fence, signed commands and worker identity survive restart',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blofy-status-')),file=join(dir,'db.sqlite');
 const controller=generateKeyPairSync('ed25519'),linode=generateKeyPairSync('ed25519'),hostbrr=generateKeyPairSync('ed25519');
 let now=1700000000000,db=new DatabaseSync(file);
 const open=()=>createDurableStatusTransport(db,{controllerKey:controller.privateKey,workerKeys:{linode:linode.publicKey,hostbrr:hostbrr.publicKey},clock:()=>now});
 function proof(engineId,key,challenge=randomBytes(16).toString('hex')){
  const status={version:1,engineId,challenge,observedAt:now,deliveryActive:true,heartbeatActive:true};
  return {status,signature:sign(null,Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',...Object.values(status)])),key).toString('base64url')};
 }
 try{
  let t=open();const p=proof('linode',linode.privateKey),r=t.poll(p);
  assert.equal(r.code,200);assert.equal(verifyStatusCommand(r.body,controller.publicKey,'linode',now),true);
  assert.equal(t.poll(proof('linode',hostbrr.privateKey)).code,403);
  db.close();db=new DatabaseSync(file);t=open();
  assert.equal(t.poll(p).code,429);
  const cmd=t.poll(proof('linode',linode.privateKey)).body;assert.deepEqual(cmd,r.body);
  assert.equal(t.complete(proof('hostbrr',hostbrr.privateKey,cmd.command.challenge)).code,409);
  const response=proof('linode',linode.privateKey,cmd.command.challenge);
  assert.equal(t.complete(response).code,200);
  db.close();db=new DatabaseSync(file);t=open();
  assert.equal(t.complete(response).code,409);
  assert.equal(db.prepare('SELECT delivery FROM worker_status WHERE engine=?').get('linode').delivery,1);
  const h=t.poll(proof('hostbrr',hostbrr.privateKey)).body;now+=26000;
  assert.equal(t.complete(proof('hostbrr',hostbrr.privateKey,h.command.challenge)).code,409);
 }finally{db.close();rmSync(dir,{recursive:true,force:true})}
});

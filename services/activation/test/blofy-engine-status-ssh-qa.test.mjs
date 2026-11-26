import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {probeEngineStatus} from '../src/blofy-engine-status-ssh-qa.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const now=1700000000000;
const opts={engineId:'hostbrr',identity:'-----BEGIN OPENSSH PRIVATE KEY-----\nqa\n',hostKey:'ssh-ed25519 AAAA',workerPublicKey:publicKey.export({type:'spki',format:'pem'}),clock:()=>now};
function reply(args,overrides={}){
 const challenge=args.at(-1).split(' ')[1];
 const s={version:1,engineId:'hostbrr',challenge,observedAt:now,deliveryActive:true,heartbeatActive:true,...overrides};
 const msg=Buffer.from(JSON.stringify(['BLOFY_WORKER_STATUS_V1',s.version,s.engineId,s.challenge,s.observedAt,s.deliveryActive,s.heartbeatActive]));
 return {stdout:JSON.stringify({status:s,signature:sign(null,msg,privateKey).toString('base64url')})};
}
test('transport targets pinned host and only dedicated status account',async()=>{
 const r=await probeEngineStatus({...opts,execute:async(bin,args,config)=>{
  assert.equal(bin,'/usr/bin/ssh');
  assert.equal(args.at(-2),'blofycontrolqa@77.90.2.179');
  assert.match(args.at(-1),/^status [a-f0-9]{32}$/);
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('ClearAllForwardings=yes'));
  assert.equal(config.timeout,8000);
  return reply(args);
 }});
 assert.deepEqual(r,{ok:true,engineId:'hostbrr',deliveryActive:true,heartbeatActive:true});
});
test('wrong engine, challenge, malformed response, or SSH error rejected',async()=>{
 for(const execute of [async(_,args)=>reply(args,{engineId:'linode'}),async(_,args)=>reply(args,{challenge:'a'.repeat(32)}),async()=>({stdout:'bad'}),async()=>{throw Error('SSH failed')}])
  assert.equal((await probeEngineStatus({...opts,execute})).ok,false);
});
test('invalid engine is rejected before execution',async()=>{
 const r=await probeEngineStatus({...opts,engineId:'__proto__',execute:async()=>{assert.fail('unexpected execution')}});
 assert.equal(r.ok,false);
});

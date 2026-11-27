import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyFeedProof} from '../../src/blofy-live-feed-proof.mjs';
test('Python worker produces interoperable proof only for current leased progress',()=>{
 const dir=mkdtempSync(join(tmpdir(),'blofy-proof-'));
 try{
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  const key=join(dir,'key.pem');
  writeFileSync(key,privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  const now=Date.now(),reservationId=randomUUID();
  const identity={engineId:'hostbrr',sourceId:randomUUID(),channelId:'123',reservationId,generation:reservationId.replaceAll('-','')};
  const challenge=randomBytes(16).toString('hex');
  const {generation,...leaseIdentity}=identity;
  const lease={version:1,...leaseIdentity,issuedAt:now-1000,expiresAt:now+50000,sequence:1};
  const status={...identity,status:'private_hls_ready',observedAt:new Date(now).toISOString(),lastSegment:4};
  const script=`
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("proof","blofy-live-feed-proof-worker.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
a=json.load(sys.stdin)
i,c,s,l,n,k=[a[x] for x in ("identity","challenge","status","lease","now","key")]
p=m.make_ready_proof(i,c,s,l,5,n)
assert p and p["lastSegment"]==5
assert m.make_ready_proof(i,c,s,l,None,n) is None
assert m.make_ready_proof(i,c,s,l,3,n) is None
assert m.make_ready_proof(i,c,s,{**l,"expiresAt":n},5,n) is None
assert m.make_ready_proof(i,c,{**s,"status":"releasing"},l,5,n) is None
assert m.make_ready_proof(i,c,{**s,"generation":"0"*32},l,5,n) is None
assert m.make_ready_proof(i,c,s,l,5,n+11000) is None
print(json.dumps(m.sign_proof(p,k)))
`;
  const r=spawnSync('python3',['-c',script],{input:JSON.stringify({identity,challenge,status,lease,now,key}),encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);
  assert.equal(verifyFeedProof(JSON.parse(r.stdout),{key:publicKey,identity,challenge,now}),true);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

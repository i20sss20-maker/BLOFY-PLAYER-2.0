import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {auditVerifiedPrivateCopy} from '../src/verified-copy-audit.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const data=Buffer.from('real-copy-test-fixture');
const runId='saleh_episode_127434_20261114';
const manifest=kind=>({bytes:data.length,sha256:sha(data),parts:[{
 partNumber:1,bytes:data.length,sha256:sha(data),
 key:`saleh/${kind}/01234567-89ab-4cde-8f01-23456789abcd/`+
 'batch_0123456789abcdef01234567_part_000001.mkv'}]});
const deps=kind=>({kind,runId,lease:{
 getVerifiedEpisodeObject:async()=>manifest('episode'),
 getVerifiedChunkedObject:async()=>manifest('movie')},
 storage:{readVerifiedRange:async()=>Readable.from([data])}});

for(const kind of ['episode','movie'])
 test(`verified ${kind}: fresh full SHA from S3 only`,async()=>{
  const d=deps(kind),r=await auditVerifiedPrivateCopy(d);
  assert.equal(r.ok,true);assert.equal(r.fullFileReadBackVerified,true);
  assert.equal(r.bytesRead,data.length);assert.equal(r.checkedParts,1);
  assert.equal(r.providerRequests,0);assert.equal(r.customerCutover,false);
  assert.equal(r.ownerAudioVideoConfirmed,false);
 });
test('tampered chunk fails closed without accepting original DB checksum',async()=>{
 const d=deps('episode');d.storage.readVerifiedRange=async()=>
  Readable.from([Buffer.from('REAL-copy-test-fixture')]);
 const r=await auditVerifiedPrivateCopy(d);
 assert.equal(r.ok,false);
 assert.equal(r.code,'private_copy_audit_chunk_hash_mismatch');
});
test('truncated and overlong stored chunks fail size check',async()=>{
 for(const bytes of [data.subarray(0,-1),Buffer.concat([data,Buffer.from('!')])]){
  const d=deps('movie');d.storage.readVerifiedRange=async()=>Readable.from([bytes]);
  const r=await auditVerifiedPrivateCopy(d);
  assert.equal(r.code,'private_copy_audit_size_mismatch');
 }
});
test('no manifest, invalid run, missing adapters and aborted read all fail closed',async()=>{
 const d=deps('episode');
 d.lease.getVerifiedEpisodeObject=async()=>null;
 assert.equal((await auditVerifiedPrivateCopy(d)).code,
  'private_copy_audit_manifest_invalid');
 assert.equal((await auditVerifiedPrivateCopy({...d,runId:'../../secrets'})).code,
  'private_copy_audit_invalid_request');
 assert.equal((await auditVerifiedPrivateCopy({...d,storage:{}})).ok,false);
 const controller=new AbortController();controller.abort();
 const x=deps('movie');x.signal=controller.signal;
 assert.equal((await auditVerifiedPrivateCopy(x)).code,
  'private_copy_audit_interrupted');
});

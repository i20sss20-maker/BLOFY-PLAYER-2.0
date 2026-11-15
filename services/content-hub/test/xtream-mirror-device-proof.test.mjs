import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMirrorDeviceTicketProof} from '../src/xtream-mirror-device-proof.mjs';

const runId='mirror_'+'a'.repeat(40),sha256='b'.repeat(64);
const selected={
 ok:true,mediaKind:'episode',runId,sha256,bytes:16777216
};
const when=Date.UTC(2026,10,15,5,0,0);
const lastQa={ok:true,runId,sha256,
 code:'canary_audio_video_and_seeks_verified',
 seeksVerified:4,checkedAt:new Date(when-10000).toISOString()};
test('verified existing S3 manifest plus fresh A/V four-seek canary authorizes only device QA ticket proof',()=>{
 const proof=validateMirrorDeviceTicketProof({selected,lastQa,now:when});
 assert.equal(proof.ok,true);
 assert.equal(proof.runId,runId);
 assert.equal(proof.mediaKind,'episode');
 assert.equal(proof.providerRequests,0);
 assert.equal(proof.devicePlaybackValidated,false);
 assert.equal(proof.releaseToSubscribersApproved,false);
 assert.equal(proof.customerCutover,false);
});
test('stale, changed SHA, different run ID, incomplete seek or absent A/V blocks all QA tickets',()=>{
 for(const altered of [
 {checkedAt:new Date(when-31*60000).toISOString()},
 {checkedAt:new Date(when+60000).toISOString()},
 {sha256:'c'.repeat(64)},
 {runId:'mirror_'+'c'.repeat(40)},
 {seeksVerified:3},
 {code:'canary_audio_decode_failed'},
 {ok:false}
 ]){
  const proof=validateMirrorDeviceTicketProof({
   selected,lastQa:{...lastQa,...altered},now:when
  });
  assert.equal(proof.ok,false,JSON.stringify(altered));
  assert.equal(proof.customerCutover,false);
 }
});
test('verified queue state is not enough: independent manifest must exist',()=>{
 const no=validateMirrorDeviceTicketProof({
  selected:{...selected,ok:false},lastQa,now:when});
 assert.equal(no.ok,false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedStreamUploadClaims, verifySignedStreamUploadOidc,
  STREAM_55836_APK, STREAM_55836_SHA256, STREAM_55836_BYTES,
  STREAM_56_APK, STREAM_56_SHA256, STREAM_56_BYTES,
  STREAM_5601_APK, STREAM_5601_SHA256, STREAM_5601_BYTES,
  approvedStreamUpload } from './stream-upload-oidc.mjs';

const now = 1_799_800_000;
const claims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'blofy-stream-55-8-36-website-upload',
  sub: 'repo:i20sss20-maker@317876372/BLOFY-PLAYER-2.0@1351236912:ref:refs/heads/main',
  repository: 'i20sss20-maker/BLOFY-PLAYER-2.0',
  repository_id: '1351236912',
  ref: 'refs/heads/main',
  event_name: 'push',
  workflow_ref: 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-55-8-36.yml@refs/heads/main',
  exp: now + 180,
  iat: now - 30
};
test('only the designated release workflow from our main branch can upload STREAM', () => {
  assert.equal(isTrustedStreamUploadClaims(claims, now), true);
  for (const [field, value] of [
    ['aud', 'wrong'], ['iss', 'https://example.com'], ['ref', 'refs/heads/feature'],
    ['sub', 'repo:someone/else:ref:refs/heads/main'],
    ['repository_id', '7'], ['event_name', 'pull_request'],
    ['workflow_ref', 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/other.yml@refs/heads/main'],
    ['exp', now - 1], ['iat', now + 60]
  ]) assert.equal(isTrustedStreamUploadClaims({...claims, [field]: value}, now), false, field);
});
test('unsigned and absent bearer tokens are rejected before network access', async () => {
  assert.equal(await verifySignedStreamUploadOidc(''), false);
  assert.equal(await verifySignedStreamUploadOidc('Bearer abc'), false);
  assert.equal(await verifySignedStreamUploadOidc('Bearer invalid.invalid.invalid'), false);
});
test('published APK digest and size are pinned, not client-controlled', () => {
  assert.equal(STREAM_55836_APK, 'BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk');
  assert.match(STREAM_55836_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(STREAM_55836_BYTES, 135775044);
});

test('STREAM 56 upload is pinned to signed artifact and dedicated workflow', () => {
  const claims56 = {
    ...claims,
    aud: 'blofy-stream-56-website-upload',
    workflow_ref: 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-56.yml@refs/heads/main'
  };
  assert.equal(STREAM_56_BYTES, 135783643);
  assert.equal(STREAM_56_SHA256, 'bba9e340d50c95ab8ab9e1c42f96bef8f2d676dee888e975d7a161f2027d8064');
  assert.equal(approvedStreamUpload(STREAM_56_APK)?.bytes, STREAM_56_BYTES);
  assert.equal(approvedStreamUpload(STREAM_56_APK)?.sha256, STREAM_56_SHA256);
  assert.equal(approvedStreamUpload('../evil.apk'), null);
  assert.equal(approvedStreamUpload('fake.apk'), null);
  assert.equal(isTrustedStreamUploadClaims(claims56, now, STREAM_56_APK), true);
  assert.equal(isTrustedStreamUploadClaims(claims56, now, STREAM_55836_APK), false);
  assert.equal(isTrustedStreamUploadClaims(claims, now, STREAM_56_APK), false);
  for (const [key, value] of [
    ['aud','blofy-stream-55-8-36-website-upload'],
    ['event_name','pull_request'],
    ['workflow_ref',claims.workflow_ref],
    ['ref','refs/heads/feature/anything'],
    ['repository_id','9999']
  ]) assert.equal(
    isTrustedStreamUploadClaims({...claims56,[key]:value},now,STREAM_56_APK),false,key);
});

test('56.0.1 hotfix requires only the designated original-owner QA upload workflow',()=>{
  const liveFix={
    ...claims,
    aud:'blofy-stream-56-0-1-qa-website-upload',
    workflow_ref:'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-56-0-1-qa.yml@refs/heads/main'
  };
  assert.equal(STREAM_5601_SHA256,'02d40e3748f0d75905f734ad429ef16994d87a7068280e567d8da9339932e89a');
  assert.equal(STREAM_5601_BYTES,135785176);
  assert.equal(approvedStreamUpload(STREAM_5601_APK)?.sha256,STREAM_5601_SHA256);
  assert.equal(approvedStreamUpload(STREAM_5601_APK)?.bytes,STREAM_5601_BYTES);
  assert.equal(isTrustedStreamUploadClaims(liveFix,now,STREAM_5601_APK),true);
  assert.equal(isTrustedStreamUploadClaims(liveFix,now,STREAM_56_APK),false);
  assert.equal(isTrustedStreamUploadClaims(liveFix,now,STREAM_55836_APK),false);
  assert.equal(isTrustedStreamUploadClaims(claims,now,STREAM_5601_APK),false);
  assert.equal(isTrustedStreamUploadClaims({...liveFix,event_name:'pull_request'},now,STREAM_5601_APK),false);
  assert.equal(isTrustedStreamUploadClaims({...liveFix,ref:'refs/heads/testing'},now,STREAM_5601_APK),false);
});

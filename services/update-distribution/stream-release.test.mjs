import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAM_RELEASE_URL, STREAM_PUBLIC_DOWNLOAD,
  streamReleaseMetadata
} from './stream-release.mjs';

const approved = {
  slug:'blofy-stream', enabled:true, downloadMode:'direct',
  version:'55.8.24', downloadUrl:STREAM_RELEASE_URL
};

test('STREAM release serves code 2000101 and own website URL, never PLAYER updater',()=>{
  const release=streamReleaseMetadata(approved)?.release?.app;
  assert.equal(release?.versionCode,2000101);
  assert.equal(release?.versionName,'2.0.0-rc07.55.8.24-STREAM');
  assert.equal(release?.downloadUrl,STREAM_PUBLIC_DOWNLOAD);
  assert.equal(release?.minSupportedVersionCode,1);
  assert.equal(release?.packageName,'tv.blofy.player.v2.stream');
  assert.equal(release?.apkSizeBytes,135682806);
  assert.match(release?.sha256,/^[0-9a-f]{64}$/);
  assert.equal(release?.sha256,'a5af6253ad816d325af9a1f32bc5b03cef9a6cd0f5dc6e8ca3f861dd1325b00d');
  assert.ok(release?.apkSizeBytes < 268435456, 'fits installed STREAM legacy resumable updater');


  assert.ok(release?.downloadUrl.endsWith('/d/blofy-stream'));
  assert.ok(!release?.downloadUrl.endsWith('/d/blofy'));
  assert.ok(!release?.downloadUrl.endsWith('/download/latest.apk'));
});

test('STREAM updater fails closed on stale 55.8.7, wrong source or hidden app',()=>{
  for (const partial of [
    {version:'55.8.10'}, {enabled:false}, {slug:'blofy'},
    {downloadMode:'official'},
    {downloadUrl:'https://github.com/somebody/fake.apk'},
    {downloadUrl:'https://updates.blofyplayer.com/download/latest.apk'}
  ]) assert.equal(streamReleaseMetadata({...approved,...partial}),null);
  assert.equal(streamReleaseMetadata(null),null);
});

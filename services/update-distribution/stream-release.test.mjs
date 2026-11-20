import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAM_RELEASE_URL, STREAM_PUBLIC_DOWNLOAD, STREAM_PREVIOUS_RELEASE_FILENAME,
  STREAM_TEST_FILENAME, STREAM_TEST_PATH,
  STREAM_LIVE_FIX_TEST_FILENAME, STREAM_LIVE_FIX_TEST_PATH,
  streamReleaseMetadata
} from './stream-release.mjs';

const approved = {
  slug:'blofy-stream', enabled:true, downloadMode:'direct',
  version:'56.0.2', downloadUrl:STREAM_RELEASE_URL
};

test('STREAM release serves code 2000117 and own website URL, never PLAYER updater',()=>{
  const release=streamReleaseMetadata(approved)?.release?.app;
  assert.equal(release?.versionCode,2000117);
  assert.equal(release?.versionName,'2.0.0-rc07.56.0.2-STREAM');
  assert.equal(release?.downloadUrl,STREAM_PUBLIC_DOWNLOAD);
  assert.equal(release?.minSupportedVersionCode,1);
  assert.equal(release?.packageName,'tv.blofy.player.v2.stream');
  assert.equal(release?.apkSizeBytes,135787039);
  assert.match(release?.sha256,/^[0-9a-f]{64}$/);
  assert.equal(release?.sha256,'9a3037936b374b3e62e2bc06f4f9fe8b5a3a64441c249c8cf00d78944c58876a');
  assert.ok(release?.apkSizeBytes < 268435456, 'fits installed STREAM legacy resumable updater');


  assert.ok(release?.downloadUrl.endsWith('/d/blofy-stream'));
  assert.ok(!release?.downloadUrl.endsWith('/d/blofy'));
  assert.ok(!release?.downloadUrl.endsWith('/download/latest.apk'));
});

test('STREAM updater fails closed on stale 55.8.7, wrong source or hidden app',()=>{
  for (const partial of [
    {version:'55.8.10'}, {version:'55.8.34'}, {version:'55.8.36'}, {enabled:false}, {slug:'blofy'},
    {downloadMode:'official'},
    {downloadUrl:'https://github.com/somebody/fake.apk'},
    {downloadUrl:'https://updates.blofyplayer.com/download/latest.apk'}
  ]) assert.equal(streamReleaseMetadata({...approved,...partial}),null);
  assert.equal(streamReleaseMetadata(null),null);
});

test('optional 55.8.33 audio source test never replaces 56.0.2 updater',()=>{
  assert.equal(STREAM_PREVIOUS_RELEASE_FILENAME,'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk');
  assert.equal(STREAM_TEST_FILENAME,'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk');
  assert.equal(STREAM_TEST_PATH,'/d/blofy-stream/foxfm-test');
  assert.notEqual(STREAM_TEST_PATH,STREAM_PUBLIC_DOWNLOAD.replace('https://updates.blofyplayer.com',''));
  assert.equal(streamReleaseMetadata({...approved,version:'55.8.33'}),null);
  assert.equal(streamReleaseMetadata(approved)?.release?.app?.versionCode,2000117);
});

test('56.0.2 owner-signed update is public and retains separate 56.0.1 test alias',()=>{
  assert.equal(STREAM_LIVE_FIX_TEST_FILENAME,'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk');
  assert.equal(STREAM_LIVE_FIX_TEST_PATH,'/d/blofy-stream/live-fix-test');
  assert.notEqual(STREAM_LIVE_FIX_TEST_PATH,STREAM_PUBLIC_DOWNLOAD.replace('https://updates.blofyplayer.com',''));
  assert.equal(streamReleaseMetadata({...approved, version:'56.0'}),null);
  assert.equal(streamReleaseMetadata(approved)?.release?.app?.versionCode,2000117);
});

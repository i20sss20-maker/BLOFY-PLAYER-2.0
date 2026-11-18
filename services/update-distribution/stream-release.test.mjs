import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STREAM_RELEASE_URL, STREAM_PUBLIC_DOWNLOAD, STREAM_PREVIOUS_RELEASE_FILENAME,
  STREAM_TEST_FILENAME, STREAM_TEST_PATH,
  streamReleaseMetadata
} from './stream-release.mjs';

const approved = {
  slug:'blofy-stream', enabled:true, downloadMode:'direct',
  version:'55.8.36', downloadUrl:STREAM_RELEASE_URL
};

test('STREAM release serves code 2000113 and own website URL, never PLAYER updater',()=>{
  const release=streamReleaseMetadata(approved)?.release?.app;
  assert.equal(release?.versionCode,2000113);
  assert.equal(release?.versionName,'2.0.0-rc07.55.8.36-STREAM');
  assert.equal(release?.downloadUrl,STREAM_PUBLIC_DOWNLOAD);
  assert.equal(release?.minSupportedVersionCode,1);
  assert.equal(release?.packageName,'tv.blofy.player.v2.stream');
  assert.equal(release?.apkSizeBytes,135775044);
  assert.match(release?.sha256,/^[0-9a-f]{64}$/);
  assert.equal(release?.sha256,'2f5abba6d367d41fd9bab71cb8355f234678a8d715c4bebff899760642bf474e');
  assert.ok(release?.apkSizeBytes < 268435456, 'fits installed STREAM legacy resumable updater');


  assert.ok(release?.downloadUrl.endsWith('/d/blofy-stream'));
  assert.ok(!release?.downloadUrl.endsWith('/d/blofy'));
  assert.ok(!release?.downloadUrl.endsWith('/download/latest.apk'));
});

test('STREAM updater fails closed on stale 55.8.7, wrong source or hidden app',()=>{
  for (const partial of [
    {version:'55.8.10'}, {version:'55.8.34'}, {enabled:false}, {slug:'blofy'},
    {downloadMode:'official'},
    {downloadUrl:'https://github.com/somebody/fake.apk'},
    {downloadUrl:'https://updates.blofyplayer.com/download/latest.apk'}
  ]) assert.equal(streamReleaseMetadata({...approved,...partial}),null);
  assert.equal(streamReleaseMetadata(null),null);
});

test('optional 55.8.33 audio source test never replaces 55.8.36 updater',()=>{
  assert.equal(STREAM_PREVIOUS_RELEASE_FILENAME,'BLOFY-STREAM-55.8.34-NEXTGEN-FOCUS-DOWNLOADS-OWNER-SIGNED.apk');
  assert.equal(STREAM_TEST_FILENAME,'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk');
  assert.equal(STREAM_TEST_PATH,'/d/blofy-stream/foxfm-test');
  assert.notEqual(STREAM_TEST_PATH,STREAM_PUBLIC_DOWNLOAD.replace('https://updates.blofyplayer.com',''));
  assert.equal(streamReleaseMetadata({...approved,version:'55.8.33'}),null);
  assert.equal(streamReleaseMetadata(approved)?.release?.app?.versionCode,2000113);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {streamReleasePayload} from './stream-release.mjs';

test('STREAM metadata never points to PLAYER and has a pinned owner APK over 256MB',()=>{
 const manifest=streamReleasePayload({});
 const app=manifest.release.app;
 assert.equal(manifest.ok,true);
 assert.equal(app.packageName,'tv.blofy.player.v2.stream');
 assert.equal(app.versionCode,2000088);
 assert.equal(app.apkSizeBytes,292310844);
 assert.match(app.downloadUrl,/BLOFY-STREAM-55\.8\.11-FFMPEG-OWNER-SIGNED\.apk$/);
 assert.match(app.sha256,/^[a-f0-9]{64}$/);
 assert.ok(!app.downloadUrl.includes('/download/latest.apk'));
});
test('partial or unsafe promotion is refused and existing customers keep known signed APK',()=>{
 const baseline=streamReleasePayload({}).release.app;
 const cases=[
  {BLOFY_STREAM_RELEASE_VERSION_CODE:'2000089'},
  {BLOFY_STREAM_RELEASE_VERSION_CODE:'2000089',BLOFY_STREAM_RELEASE_DOWNLOAD_URL:'http://github.com/unsafe.apk'},
  {BLOFY_STREAM_RELEASE_VERSION_CODE:'2000089',BLOFY_STREAM_RELEASE_DOWNLOAD_URL:'https://example.com/a.apk',
   BLOFY_STREAM_RELEASE_SHA256:'a'.repeat(64),BLOFY_STREAM_RELEASE_VERSION_NAME:'55.8.12',BLOFY_STREAM_RELEASE_APK_SIZE_BYTES:'400000000'},
  {BLOFY_STREAM_RELEASE_VERSION_CODE:'2000089',BLOFY_STREAM_RELEASE_DOWNLOAD_URL:'https://github.com/x/y.apk',
   BLOFY_STREAM_RELEASE_SHA256:'bad',BLOFY_STREAM_RELEASE_VERSION_NAME:'55.8.12',BLOFY_STREAM_RELEASE_APK_SIZE_BYTES:'400000000'}
 ];
 for(const env of cases)assert.deepEqual(streamReleasePayload(env).release.app,baseline);
});
test('complete explicitly approved promotion serves only stream package metadata',()=>{
 const app=streamReleasePayload({
  BLOFY_STREAM_RELEASE_VERSION_CODE:'2000089',
  BLOFY_STREAM_RELEASE_VERSION_NAME:'2.0.0-rc07.55.8.12-STREAM',
  BLOFY_STREAM_RELEASE_DOWNLOAD_URL:'https://github.com/a/b/releases/download/v12/STREAM.apk',
  BLOFY_STREAM_RELEASE_SHA256:'B'.repeat(64),
  BLOFY_STREAM_RELEASE_APK_SIZE_BYTES:'338000000',
  BLOFY_STREAM_RELEASE_NOTES:'Compatible with older TV devices'
 }).release.app;
 assert.equal(app.versionCode,2000089);
 assert.equal(app.packageName,'tv.blofy.player.v2.stream');
 assert.equal(app.sha256,'b'.repeat(64));
 assert.equal(app.apkSizeBytes,338000000);
});
test('public STREAM route does not replace PLAYER release.json or health',async()=>{
 const server=await readFile(new URL('./server.mjs',import.meta.url),'utf8');
 assert.match(server,/pathname === '\/stream\/release\.json'.*streamReleasePayload\(\)/);
 assert.match(server,/pathname === '\/health' \|\| pathname === '\/release\.json'.*healthPayload\(\)/);
});

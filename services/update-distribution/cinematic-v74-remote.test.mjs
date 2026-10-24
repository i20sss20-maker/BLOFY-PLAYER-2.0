import assert from 'node:assert/strict';
import test from 'node:test';
import { CINEMATIC_V74_REMOTE, CINEMATIC_V74_REMOTE_APK_URL,
  CINEMATIC_V74_REMOTE_CHECKSUM_URL, renderCinematicV74RemoteCard } from './cinematic-v74-remote.mjs';
import { CINEMATIC_V74_PATCH } from './cinematic-v74-patch.mjs';
import { CINEMATIC_V74_DOWNLOAD_PATH } from './cinematic-v74.mjs';

test('v74 remote QA uses original version name and higher internal build for in-place upgrade', () => {
  assert.equal(CINEMATIC_V74_REMOTE.versionName, '2.0.0-rc07.55.6');
  assert.equal(CINEMATIC_V74_REMOTE.versionCode, 2000076);
  assert.ok(CINEMATIC_V74_REMOTE.versionCode > CINEMATIC_V74_PATCH.versionCode);
  assert.equal(CINEMATIC_V74_REMOTE.tag, 'v74-remote-performance-qa-20261025');
  assert.ok(CINEMATIC_V74_REMOTE_APK_URL.endsWith(CINEMATIC_V74_REMOTE.fileName));
  assert.equal(CINEMATIC_V74_REMOTE_CHECKSUM_URL, CINEMATIC_V74_REMOTE_APK_URL + '.sha256');
  assert.notEqual(CINEMATIC_V74_REMOTE.downloadPath, CINEMATIC_V74_PATCH.downloadPath);
  assert.notEqual(CINEMATIC_V74_REMOTE.downloadPath, CINEMATIC_V74_DOWNLOAD_PATH);
  assert.notEqual(CINEMATIC_V74_REMOTE.downloadPath, '/d/blofy');
  assert.notEqual(CINEMATIC_V74_REMOTE.downloadPath, '/download/latest.apk');
});

test('v74 Railway card shows clearly marked QA link, checksum and no automatic update', () => {
  const html = renderCinematicV74RemoteCard();
  assert.ok(html.includes('data-v74-remote-qa="true"'));
  assert.ok(html.includes('href="/download/v74-remote-qa.apk"'));
  assert.ok(html.includes(CINEMATIC_V74_REMOTE_CHECKSUM_URL));
  assert.ok(html.includes('BLOFY PLAYER 74'));
  assert.ok(html.includes('نسخة 74 تجريبية موقّعة'));
  assert.ok(html.includes('التحديث التلقائي الرسمي لم يتغير'));
});

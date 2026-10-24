import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CINEMATIC_V74,
  CINEMATIC_V74_APK_URL,
  CINEMATIC_V74_CHECKSUM_URL,
  CINEMATIC_V74_DOWNLOAD_PATH,
  renderCinematicV74Card
} from './cinematic-v74.mjs';

test('separate signed version 74 APK uses immutable approved GitHub release as source', () => {
  assert.equal(CINEMATIC_V74.versionCode, 2000074);
  assert.equal(CINEMATIC_V74.versionName, '2.0.0-rc07.55.6');
  assert.match(CINEMATIC_V74_APK_URL, /^https:\/\/github\.com\/i20sss20-maker\/BLOFY-PLAYER-2\.0\/releases\/download\/v74-cinematic-approved-20261024\//);
  assert.ok(CINEMATIC_V74_APK_URL.endsWith(CINEMATIC_V74.fileName));
  assert.equal(CINEMATIC_V74_CHECKSUM_URL, CINEMATIC_V74_APK_URL + '.sha256');
  assert.match(CINEMATIC_V74.sha256, /^[a-f0-9]{64}$/);
  assert.equal(CINEMATIC_V74.sha256, 'e5903c2e041fe95d88ce82f8326a5c45447b2addd47424ae9c6dc740fa911c69');
  assert.equal(CINEMATIC_V74_DOWNLOAD_PATH, '/download/v74-cinematic.apk');
  assert.notEqual(CINEMATIC_V74_DOWNLOAD_PATH, '/download/latest.apk');
  assert.notEqual(CINEMATIC_V74_DOWNLOAD_PATH, '/d/blofy');
});

test('Railway update-center card is independently downloadable, multilingual-safe, and includes checksum', () => {
  const html = renderCinematicV74Card();
  assert.match(html, /data-cinematic-v74="true"/);
  assert.match(html, /BLOFY PLAYER 74 — النسخة السينمائية/);
  assert.ok(html.includes('href="' + CINEMATIC_V74_DOWNLOAD_PATH + '"'));
  assert.ok(html.includes('href="' + CINEMATIC_V74_CHECKSUM_URL + '"'));
  assert.ok(html.includes('2000074'));
  assert.ok(html.includes('لا تحذف التطبيق أو بياناته'));
  assert.ok(!html.includes('/download/latest.apk'));
  assert.ok(!html.includes('v74-premium-owner-test-20261024'));
  assert.equal((html.match(/class="official-download"/g) || []).length, 1);
});

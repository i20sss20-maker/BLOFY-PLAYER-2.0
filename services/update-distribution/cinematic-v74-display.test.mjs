import assert from 'node:assert/strict';
import test from 'node:test';
import { CINEMATIC_V74_DISPLAY, CINEMATIC_V74_DISPLAY_APK_URL,
  CINEMATIC_V74_DISPLAY_CHECKSUM_URL, renderCinematicV74DisplayCard } from './cinematic-v74-display.mjs';
import { CINEMATIC_V74_REMOTE } from './cinematic-v74-remote.mjs';

test('visible Android version is exactly 74 and internal upgrade code is higher', () => {
  assert.equal(CINEMATIC_V74_DISPLAY.versionName, '74');
  assert.equal(CINEMATIC_V74_DISPLAY.versionCode, 2000077);
  assert.ok(CINEMATIC_V74_DISPLAY.versionCode > CINEMATIC_V74_REMOTE.versionCode);
  assert.equal(CINEMATIC_V74_DISPLAY.tag, 'v74-display74-remote-qa-20261025');
  assert.ok(CINEMATIC_V74_DISPLAY_APK_URL.endsWith(CINEMATIC_V74_DISPLAY.fileName));
  assert.equal(CINEMATIC_V74_DISPLAY_CHECKSUM_URL, CINEMATIC_V74_DISPLAY_APK_URL + '.sha256');
  assert.notEqual(CINEMATIC_V74_DISPLAY.downloadPath, CINEMATIC_V74_REMOTE.downloadPath);
  assert.notEqual(CINEMATIC_V74_DISPLAY.downloadPath, '/d/blofy');
  assert.notEqual(CINEMATIC_V74_DISPLAY.downloadPath, '/download/latest.apk');
});

test('Railway page promotes version 74 QA without touching automatic update route', () => {
  const html = renderCinematicV74DisplayCard();
  assert.ok(html.includes('data-v74-display-qa="true"'));
  assert.ok(html.includes('href="/download/v74-display74.apk"'));
  assert.ok(html.includes(CINEMATIC_V74_DISPLAY_CHECKSUM_URL));
  assert.ok(html.includes('BLOFY PLAYER 74'));
  assert.ok(html.includes('الظاهر داخل التطبيق 74'));
  assert.ok(html.includes('التحديث التلقائي الرسمي لم يتغير'));
});

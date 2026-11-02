import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLAY73_ARCHIVE_FILE,
  PLAY73_ARCHIVE_ROUTE,
  PLAY73_ARCHIVE_VERSION_NAME,
  PLAY73_ARCHIVE_VERSION_CODE,
  renderPlay73ArchiveCard
} from './play73-archive.mjs';
import { renderCinematicV74DisplayCard } from './cinematic-v74-display.mjs';

test('only the exact preserved BLOFY 73 archive APK is advertised', () => {
  assert.equal(PLAY73_ARCHIVE_VERSION_CODE, 2000073);
  assert.equal(PLAY73_ARCHIVE_VERSION_NAME, '2.0.0-rc07.55.5');
  assert.equal(PLAY73_ARCHIVE_FILE, 'BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.apk');
  assert.equal(PLAY73_ARCHIVE_ROUTE, '/files/releases/' + PLAY73_ARCHIVE_FILE);
  const html = renderPlay73ArchiveCard();
  assert.ok(html.includes('BLOFY PLAYER 73'));
  assert.ok(html.includes('href="' + PLAY73_ARCHIVE_ROUTE + '"'));
  assert.ok(html.includes('2000073'));
  assert.ok(html.includes('احفظ بياناتك'));
});

test('archive card appears without replacing newer download route or cinematic cards', () => {
  const html = renderCinematicV74DisplayCard();
  assert.ok(html.includes('id="blofy-73-archive"'));
  assert.ok(html.includes('data-v74-display-qa="true"'));
  assert.ok(!html.includes('href="/download/latest.apk"'));
  assert.ok(!html.includes('href="/d/blofy"'));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { publishedAppRelease } from '../src/release-metadata.mjs';

const row = (channel, version_code, version_name) => ({channel, version_code, version_name,
  download_url: 'https://github.com/example/repo/releases/download/v1/app.apk', release_notes: 'New controls'});

test('an admin release reaches existing clients even with no old environment metadata', () => {
  assert.equal(publishedAppRelease([row('testing', 47, '2.0-rc36')], {}).versionCode, 47);
  assert.equal(publishedAppRelease([], {}), null);
});
test('stable clients do not receive a newer test channel', () => {
  const rows = [row('stable', 40, '2.0'), row('testing', 47, '2.1-rc1')];
  assert.equal(publishedAppRelease(rows, {}).versionCode, 40);
  assert.equal(publishedAppRelease(rows, { BLOFY_APP_UPDATE_CHANNEL: 'testing' }).versionCode, 47);
});
test('configured fallback prevents downgrades and keeps the required minimum', () => {
  const env = { BLOFY_APP_VERSION_CODE: '46', BLOFY_APP_VERSION_NAME: '2.0-rc35', BLOFY_APP_MIN_SUPPORTED_VERSION_CODE: '30' };
  assert.equal(publishedAppRelease([row('testing', 45, '2.0-rc34')], env).versionCode, 46);
  const next = publishedAppRelease([row('testing', 47, '2.0-rc36')], env);
  assert.equal(next.versionCode, 47);
  assert.equal(next.minSupportedVersionCode, 30);
});
test('unsafe or incomplete admin metadata is never offered', () => {
  assert.equal(publishedAppRelease([{ ...row('testing', 47, '2.0-rc36'), download_url: 'http://example.org/app.apk' }], {}), null);
  assert.equal(publishedAppRelease([{ ...row('testing', 47, '2.0-rc36'), version_name: 'bad version' }], {}), null);
});

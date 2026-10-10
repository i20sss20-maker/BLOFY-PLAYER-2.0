import assert from 'node:assert/strict';
import test from 'node:test';
import { appDownloadAction } from './app-download-policy.mjs';

const apk = { downloadMode: 'direct', downloadUrl: 'https://github.com/example/app/releases/download/1/app.apk' };

test('direct APK links remain proxied through binary and SSRF checks', () => {
  assert.deepEqual(appDownloadAction(apk), { kind: 'apk', url: apk.downloadUrl });
  assert.deepEqual(appDownloadAction({ ...apk, downloadUrl: 'https://example.org/files/INSTALL.APK?source=site' }),
    { kind: 'apk', url: 'https://example.org/files/INSTALL.APK?source=site' });
});

test('official links point to external website instead of pretending to be APKs', () => {
  assert.deepEqual(appDownloadAction({ downloadMode: 'official', downloadUrl: 'https://play.google.com/store/apps/details?id=example.app' }),
    { kind: 'official', url: 'https://play.google.com/store/apps/details?id=example.app' });
  assert.deepEqual(appDownloadAction({ downloadMode: 'official', downloadUrl: 'https://github.com/example/app' }),
    { kind: 'official', url: 'https://github.com/example/app' });
});

test('legacy invalid direct downloads are unavailable, never a proxy 500 or spoofed APK', () => {
  for (const url of [
    'https://play.google.com/store/apps/details?id=example.app',
    'https://github.com/example/app',
    'https://example.org/fake.apk.zip',
    'javascript:alert(1)',
    'http://example.org/a.apk',
    'https://user:pass@example.org/a.apk',
    'https://localhost/a.apk',
    'https://127.0.0.1/a.apk',
    'https://example.org/a.apk#fragment'
  ]) {
    assert.deepEqual(appDownloadAction({ downloadMode: 'direct', downloadUrl: url }),
      { kind: 'unavailable' }, url);
  }
  assert.deepEqual(appDownloadAction({ downloadMode: 'unknown', downloadUrl: apk.downloadUrl }),
    { kind: 'unavailable' });
});

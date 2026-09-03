import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ACTIVATION_SERVICE_VERSION,
  activationReleaseMetadata,
  appReleaseMetadata,
  sanitizeCommitSha,
  sanitizeHttpsUrl,
  sanitizeReleaseNotes,
  sanitizeVersionCode,
  sanitizeVersionName
} from '../src/release-metadata.mjs';

test('health release version stays aligned with the activation package version', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(ACTIVATION_SERVICE_VERSION, packageJson.version);
});

test('commit metadata accepts only complete Git commit hashes', () => {
  const sha1 = 'A'.repeat(40);
  const sha256 = 'b'.repeat(64);

  assert.equal(sanitizeCommitSha(` ${sha1} `), sha1.toLowerCase());
  assert.equal(sanitizeCommitSha(sha256), sha256);
  assert.equal(sanitizeCommitSha('abc1234'), null);
  assert.equal(sanitizeCommitSha('secret-value-that-must-not-be-exposed'), null);
});

test('app release sanitizers reject unsafe or malformed values', () => {
  assert.equal(sanitizeVersionCode('2000007'), 2000007);
  assert.equal(sanitizeVersionCode('0'), null);
  assert.equal(sanitizeVersionCode('3.4'), null);
  assert.equal(sanitizeVersionName('2.0.0-rc06'), '2.0.0-rc06');
  assert.equal(sanitizeVersionName('bad version name'), null);
  assert.equal(sanitizeHttpsUrl('https://downloads.example.com/BLOFY.apk'), 'https://downloads.example.com/BLOFY.apk');
  assert.equal(sanitizeHttpsUrl('http://downloads.example.com/BLOFY.apk'), null);
  assert.equal(sanitizeHttpsUrl('https://user:password@example.com/BLOFY.apk'), null);
  assert.equal(sanitizeReleaseNotes('\u0001  تحسينات جديدة  '), 'تحسينات جديدة');
});

test('app release metadata is omitted until version identity is complete', () => {
  assert.equal(appReleaseMetadata({}), null);
  assert.equal(appReleaseMetadata({ BLOFY_APP_VERSION_CODE: '2000007' }), null);
  assert.equal(appReleaseMetadata({ BLOFY_APP_VERSION_NAME: '2.0.0' }), null);
});

test('app release metadata is public, bounded and HTTPS-only', () => {
  assert.deepEqual(
    appReleaseMetadata({
      BLOFY_APP_VERSION_CODE: '2000008',
      BLOFY_APP_VERSION_NAME: '2.0.0-rc07',
      BLOFY_APP_MIN_SUPPORTED_VERSION_CODE: '9999999',
      BLOFY_APP_DOWNLOAD_URL: 'https://downloads.example.com/BLOFY.apk',
      BLOFY_APP_RELEASE_NOTES: ' أداء أسرع وريموت أدق '
    }),
    {
      versionCode: 2000008,
      versionName: '2.0.0-rc07',
      minSupportedVersionCode: 2000008,
      downloadUrl: 'https://downloads.example.com/BLOFY.apk',
      releaseNotes: 'أداء أسرع وريموت أدق'
    }
  );
});

test('Vercel release metadata is stable, comparable and contains no unrelated environment values', () => {
  const commitSha = '0123456789abcdef0123456789abcdef01234567';
  const metadata = activationReleaseMetadata({
    VERCEL: '1',
    VERCEL_GIT_COMMIT_SHA: commitSha.toUpperCase(),
    DATABASE_URL: 'postgresql://user:password@example.invalid/database',
    BLOFY_ADMIN_TOKEN: 'must-not-be-exposed'
  });

  assert.deepEqual(metadata, {
    service: 'blofy-activation',
    version: ACTIVATION_SERVICE_VERSION,
    platform: 'vercel',
    commitSha,
    app: null
  });
  assert.equal(JSON.stringify(metadata).includes('password'), false);
  assert.equal(JSON.stringify(metadata).includes('must-not-be-exposed'), false);
});

test('self-hosted release metadata may use an explicitly supplied sanitized commit', () => {
  const commitSha = 'fedcba9876543210fedcba9876543210fedcba98';
  assert.deepEqual(activationReleaseMetadata({ BLOFY_RELEASE_COMMIT_SHA: commitSha }), {
    service: 'blofy-activation',
    version: ACTIVATION_SERVICE_VERSION,
    platform: 'self-hosted',
    commitSha,
    app: null
  });
});

test('health metadata includes only sanitized app release fields', () => {
  const metadata = activationReleaseMetadata({
    BLOFY_APP_VERSION_CODE: '2000008',
    BLOFY_APP_VERSION_NAME: '2.0.0-rc07',
    BLOFY_APP_MIN_SUPPORTED_VERSION_CODE: '2000001',
    BLOFY_APP_DOWNLOAD_URL: 'https://downloads.example.com/BLOFY.apk?channel=stable',
    BLOFY_APP_RELEASE_NOTES: 'إصدار تجريبي ثابت',
    BLOFY_ADMIN_TOKEN: 'must-not-leak'
  });

  assert.equal(metadata.app.versionCode, 2000008);
  assert.equal(metadata.app.minSupportedVersionCode, 2000001);
  assert.equal(metadata.app.downloadUrl, 'https://downloads.example.com/BLOFY.apk?channel=stable');
  assert.equal(JSON.stringify(metadata).includes('must-not-leak'), false);
});

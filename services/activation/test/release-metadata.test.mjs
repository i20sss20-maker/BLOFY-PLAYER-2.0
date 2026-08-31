import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ACTIVATION_SERVICE_VERSION,
  activationReleaseMetadata,
  sanitizeCommitSha
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
    commitSha
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
    commitSha
  });
});

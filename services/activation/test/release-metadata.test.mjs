import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { ACTIVATION_SERVICE_VERSION, activationReleaseMetadata, appReleaseMetadata, sanitizeCommitSha, sanitizeVersionCode, sanitizeVersionName, sanitizeHttpsUrl } from '../src/release-metadata.mjs';

test('health release version stays aligned with the activation package version', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(ACTIVATION_SERVICE_VERSION, packageJson.version);
});
test('commit metadata accepts only complete Git commit hashes', () => {
  assert.equal(sanitizeCommitSha('A'.repeat(40)), 'a'.repeat(40));
  assert.equal(sanitizeCommitSha('b'.repeat(64)), 'b'.repeat(64));
  assert.equal(sanitizeCommitSha('abc1234'), null);
  assert.equal(sanitizeCommitSha('secret-value-that-must-not-be-exposed'), null);
});
test('Vercel metadata contains only public service and app fields', () => {
  const commitSha = '0123456789abcdef0123456789abcdef01234567';
  const metadata = activationReleaseMetadata({VERCEL:'1', VERCEL_GIT_COMMIT_SHA:commitSha.toUpperCase(), DATABASE_URL:'postgresql://user:password@example.invalid/db', BLOFY_ADMIN_TOKEN:'must-not-be-exposed'});
  assert.deepEqual(metadata, {service:'blofy-activation',version:ACTIVATION_SERVICE_VERSION,platform:'vercel',commitSha,app:appReleaseMetadata({})});
  assert.equal(JSON.stringify(metadata).includes('password'),false);
  assert.equal(JSON.stringify(metadata).includes('must-not-be-exposed'),false);
  assert.deepEqual(Object.keys(metadata.app).sort(),['downloadUrl','minSupportedVersionCode','releaseNotes','versionCode','versionName']);
});
test('self-hosted metadata includes the published default app without leaking environment', () => {
  const commitSha='fedcba9876543210fedcba9876543210fedcba98';
  assert.deepEqual(activationReleaseMetadata({BLOFY_RELEASE_COMMIT_SHA:commitSha}),{service:'blofy-activation',version:ACTIVATION_SERVICE_VERSION,platform:'self-hosted',commitSha,app:appReleaseMetadata({})});
});
test('published fallback is complete, optional and safe',()=>{
  const app=appReleaseMetadata({});assert.ok(app.versionCode>0);assert.ok(app.versionName);assert.equal(app.minSupportedVersionCode,1);assert.equal(new URL(app.downloadUrl).protocol,'https:');assert.match(new URL(app.downloadUrl).pathname,/\.apk$/);assert.ok(app.releaseNotes.length<=600);
});
test('public metadata sanitizers reject invalid identity and unsafe URLs',()=>{
  for(const value of [0,-1,1.5,2100000001])assert.equal(sanitizeVersionCode(value),null);
  assert.equal(sanitizeVersionName('bad version'),null);
  for(const value of ['http://example.com/a.apk','javascript:alert(1)','https://user:password@example.com/a.apk'])assert.equal(sanitizeHttpsUrl(value),null);
});

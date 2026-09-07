import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createActivationCredentialCodec, createDeviceAuthenticator, createFixedWindowLimiter,
  DeviceAuthRateLimitError
} from '../src/auth-protection.mjs';
import { devicePool, loadHooks } from './helpers/hook-harness.mjs';

const key = 'ab'.repeat(32);
const codec = createActivationCredentialCodec(key);
const env = { DATABASE_URL: 'fixture', BLOFY_PLAYLIST_ENCRYPTION_KEY: key, BLOFY_PAYMENT_CHECKOUT_URL: 'https://checkout.example.test', BLOFY_PAYMENT_CHECKOUT_SECRET: 'checkout-fixture-secret-at-least-24' };
function fixture(id) {
  return { device_id: id, activation_code: codec.proof(id, '123456'), status: 'expired', auth_failed_attempts: 0, last_auth_failure_at: null, auth_locked_until: null };
}
function isolatedAuth(pool, options = {}) {
  return createDeviceAuthenticator({ pool, activationCredentials: codec,
    ipLimiter: createFixedWindowLimiter({ limit: 100 }), deviceLimiter: createFixedWindowLimiter({ limit: 100 }), ...options });
}

test('hook auth persists five failures and valid polling cannot clear the failure budget', async () => {
  const row = fixture('BLOFY-AUTH-FAILURES');
  const pool = devicePool(row);
  let now = 2_000_000;
  const auth = isolatedAuth(pool, { now: () => now });
  for (let i = 0; i < 4; i++) {
    assert.equal(await auth(row.device_id, '000000'), null);
    assert.ok(await auth(row.device_id, '123456'));
  }
  assert.equal(row.auth_failed_attempts, 4);
  assert.equal(await auth(row.device_id, '000000'), null);
  assert.equal(row.auth_failed_attempts, 5);
  assert.equal(await auth(row.device_id, '123456'), null);
  assert.ok(pool.calls.some(({ sql }) => sql.includes('FOR UPDATE')));
  now += 900_001;
  assert.ok(await auth(row.device_id, '123456'));
});

test('expired devices can renew with correct credentials and legacy credentials migrate safely', async () => {
  const row = fixture('BLOFY-AUTH-LEGACY');
  row.activation_code = '123456';
  const pool = devicePool(row);
  assert.equal((await isolatedAuth(pool)(row.device_id, '123456')).status, 'expired');
  assert.ok(codec.isProof(row.activation_code));
  assert.ok(codec.matches(row, '123456'));
});

test('hook rate limits stop excess requests before connecting to the database', async () => {
  const row = fixture('BLOFY-AUTH-RATE');
  const pool = devicePool(row);
  const auth = isolatedAuth(pool, { deviceLimiter: createFixedWindowLimiter({ limit: 2 }) });
  await auth(row.device_id, '123456');
  await auth(row.device_id, '123456');
  const queryCount = pool.calls.length;
  await assert.rejects(auth(row.device_id, '123456'), DeviceAuthRateLimitError);
  assert.equal(pool.calls.length, queryCount);
});

test('cloud, subscription, checkout, readiness and renewal share persisted device lockouts', async () => {
  const row = fixture('BLOFY-AUTH-ENDPOINTS');
  const pool = devicePool(row);
  const hooks = await loadHooks(['profile-cloud-hook.mjs', 'subscription-hook.mjs', 'payment-checkout-hook.mjs', 'commercial-readiness-hook.mjs', 'zid-commerce-hook.mjs'], { env, pool });
  const body = { deviceId: row.device_id, activationCode: '000000', profileId: 'default' };
  const attempts = [
    ['/api/v1/cloud/profile', 'PUT'],
    ['/api/v1/subscriptions/status', 'POST'],
    ['/api/v1/subscriptions/checkout', 'POST'],
    ['/api/v1/subscriptions/readiness', 'POST'],
    ['/api/v1/renew/validate', 'POST']
  ];
  for (const [path, method] of attempts) assert.equal((await hooks.request(path, { method, body })).status, 403);
  assert.equal(row.auth_failed_attempts, 5);
  assert.ok(row.auth_locked_until);
  const lockedRenewal = await hooks.request('/api/v1/renew/validate', { method: 'POST', body: { ...body, activationCode: '123456' } });
  assert.equal(lockedRenewal.status, 403);
  const lockedCloud = await hooks.request('/api/v1/cloud/profile?profileId=default', { headers: { 'x-blofy-device-id': row.device_id, 'x-blofy-activation-code': '123456' } });
  assert.equal(lockedCloud.status, 403);
});

test('cloud auth returns HTTP 429 with Retry-After instead of a generic server error', async () => {
  const row = fixture('BLOFY-AUTH-HTTPRATE');
  const pool = devicePool(row);
  const hooks = await loadHooks(['profile-cloud-hook.mjs'], { env, pool });
  const headers = { 'x-blofy-device-id': row.device_id, 'x-blofy-activation-code': '123456' };
  for (let i = 0; i < 20; i++) assert.equal((await hooks.request('/api/v1/cloud/profile?profileId=default', { headers })).status, 200);
  const blocked = await hooks.request('/api/v1/cloud/profile?profileId=default', { headers });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers['retry-after']) > 0);
  assert.deepEqual(JSON.parse(blocked.body), { error: 'rate_limited' });
});

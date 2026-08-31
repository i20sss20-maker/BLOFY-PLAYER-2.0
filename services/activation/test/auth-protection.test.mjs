import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createActivationCredentialCodec,
  createFixedWindowLimiter,
  isAuthLocked,
  nextAuthFailureState,
  requestClientKey
} from '../src/auth-protection.mjs';

test('activation credentials are stored as versioned keyed proofs', () => {
  const codec = createActivationCredentialCodec('ab'.repeat(32));
  const deviceId = 'BLOFY-ABCD-EF12';
  const proof = codec.proof(deviceId, '123456');
  assert.match(proof, /^v1:[a-f0-9]{64}$/);
  assert.equal(proof.includes('123456'), false);
  assert.equal(codec.matches({ device_id: deviceId, activation_code: proof }, '123456'), true);
  assert.equal(codec.matches({ device_id: deviceId, activation_code: proof }, '654321'), false);
  assert.equal(codec.matches({ device_id: 'BLOFY-OTHER-01', activation_code: proof }, '123456'), false);
});

test('legacy plaintext credentials match only for one-time migration', () => {
  const codec = createActivationCredentialCodec('cd'.repeat(32));
  const legacy = { device_id: 'BLOFY-LEGACY-01', activation_code: '482731' };
  assert.equal(codec.isProof(legacy.activation_code), false);
  assert.equal(codec.matches(legacy, '482731'), true);
  assert.equal(codec.matches(legacy, '482732'), false);
  assert.equal(codec.isProof(codec.proof(legacy.device_id, '482731')), true);
});

test('fixed-window limiter blocks excess attempts and resets after the window', () => {
  const limiter = createFixedWindowLimiter({ limit: 2, windowMs: 1_000 });
  assert.equal(limiter.consume('device', 10_000).allowed, true);
  assert.equal(limiter.consume('device', 10_001).allowed, true);
  const blocked = limiter.consume('device', 10_002);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  assert.equal(limiter.consume('device', 11_000).allowed, true);
});

test('limiter bounds memory without dropping the newest key', () => {
  const limiter = createFixedWindowLimiter({ limit: 1, windowMs: 60_000, maxEntries: 2 });
  limiter.consume('first', 1_000);
  limiter.consume('second', 1_000);
  assert.equal(limiter.consume('third', 1_000).allowed, true);
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.consume('third', 1_001).allowed, false);
});

test('failure state locks on the configured threshold', () => {
  const now = 100_000;
  const state = nextAuthFailureState(
    { auth_failed_attempts: 4, last_auth_failure_at: new Date(now - 1_000) },
    now,
    { maxFailures: 5, failureWindowMs: 60_000, lockMs: 120_000 }
  );
  assert.equal(state.failedAttempts, 5);
  assert.equal(state.lastFailureAt.getTime(), now);
  assert.equal(state.lockedUntil.getTime(), now + 120_000);
  assert.equal(isAuthLocked({ auth_locked_until: state.lockedUntil }, now), true);
  assert.equal(isAuthLocked({ auth_locked_until: state.lockedUntil }, now + 120_000), false);
});

test('old failures do not count toward a new lockout window', () => {
  const now = 1_000_000;
  const state = nextAuthFailureState(
    { auth_failed_attempts: 99, last_auth_failure_at: new Date(now - 60_000) },
    now,
    { maxFailures: 5, failureWindowMs: 30_000, lockMs: 120_000 }
  );
  assert.equal(state.failedAttempts, 1);
  assert.equal(state.lockedUntil, null);
});

test('client key is bounded and includes transport plus forwarded identity', () => {
  const req = {
    headers: { 'x-forwarded-for': `203.0.113.9, ${'x'.repeat(500)}` },
    socket: { remoteAddress: '10.0.0.8' }
  };
  assert.equal(requestClientKey(req), '10.0.0.8|203.0.113.9');
});

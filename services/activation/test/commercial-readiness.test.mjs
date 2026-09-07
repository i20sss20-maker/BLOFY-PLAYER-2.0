import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivationCredentialCodec } from '../src/auth-protection.mjs';
import { devicePool, loadHooks } from './helpers/hook-harness.mjs';

const key = 'cd'.repeat(32);
async function readiness(secretLength) {
  const deviceId = `BLOFY-READINESS-${secretLength}`;
  const row = { device_id: deviceId, activation_code: createActivationCredentialCodec(key).proof(deviceId, '123456'), status: 'expired' };
  const pool = devicePool(row, async (sql) => {
    if (sql.includes('COUNT(*)')) {
      // Match the checked-in schema: inactive plans must not count as purchasable.
      if (!sql.includes('WHERE active=TRUE')) throw new Error('column enabled does not exist');
      return { rows: [{ count: 1 }] };
    }
    return { rows: [] };
  });
  const env = { DATABASE_URL: 'fixture', BLOFY_PLAYLIST_ENCRYPTION_KEY: key,
    BLOFY_PAYMENT_CHECKOUT_URL: 'https://checkout.example.test', BLOFY_PUBLIC_BASE_URL: 'https://app.example.test',
    BLOFY_PAYMENT_CHECKOUT_SECRET: 'x'.repeat(24), BLOFY_PAYMENT_WEBHOOK_SECRET: 'x'.repeat(secretLength) };
  const hooks = await loadHooks(['commercial-readiness-hook.mjs'], { env, pool });
  return hooks.request('/api/v1/subscriptions/readiness', { method: 'POST', body: { deviceId, activationCode: '123456' } });
}

test('commercial readiness uses active plans from the actual schema and reports ready', async () => {
  const response = await readiness(24);
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.plansAvailable, 1);
  assert.equal(body.readyForLivePayments, true);
});

test('commercial readiness rejects webhook secrets shorter than the webhook handler accepts', async () => {
  for (const length of [16, 23]) {
    const response = await readiness(length);
    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.webhookConfigured, false);
    assert.equal(body.readyForLivePayments, false);
  }
});

import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { loadHooks } from './helpers/hook-harness.mjs';

const deviceId = 'BLOFY-ZID-FIXTURE';
const env = { DATABASE_URL: 'fixture', BLOFY_ADMIN_TOKEN: 'fixture-admin-token-at-least-24', BLOFY_ZID_PRODUCT_PLAN_MAP: '{"fixture-product":"annual"}' };
async function zidFixture({ existingOrder = false, lifetime = false } = {}) {
  const writes = [];
  const pool = {
    async query(sql, values = []) {
      if (sql.includes('CREATE TABLE')) return { rows: [] };
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (sql.includes('INSERT INTO payment_events')) return { rows: [{ id: 1 }] };
      if (sql.includes('SELECT device_id FROM devices')) return { rows: [{ device_id: deviceId }] };
      if (sql.includes('FROM subscription_plans')) return { rows: [{ plan_key: 'annual', duration_days: 365, price_minor: 100, currency: 'SAR' }] };
      if (sql.includes("FROM subscription_orders WHERE payment_provider='zid'")) return { rows: existingOrder ? [{ id: 'existing-order' }] : [] };
      if (sql.includes('SELECT expires_at FROM device_subscriptions')) return { rows: lifetime ? [{ expires_at: null }] : [] };
      if (sql.startsWith('SELECT expires_at,status FROM devices')) return { rows: [{ expires_at: null, status: lifetime ? 'active' : 'expired' }] };
      writes.push({ sql, values });
      return { rows: [] };
    },
    async connect() { return { query: pool.query, release() {} }; }
  };
  const hooks = await loadHooks(['zid-commerce-hook.mjs'], { env, pool });
  return { grant: vm.runInContext('grantPaidZidOrder', hooks.contexts[0]), writes, hooks };
}

test('another paid notification for the same Zid order cannot extend the subscription again', async () => {
  const fixture = await zidFixture({ existingOrder: true });
  const response = await fixture.grant({ event: 'order.paid', id: 'same-order', status: 'completed', deviceId, product_id: 'fixture-product' });
  assert.equal(response.duplicate, true);
  assert.ok(!fixture.writes.some(({ sql }) => sql.includes('INSERT INTO device_subscriptions')));
  assert.ok(!fixture.writes.some(({ sql }) => sql.includes('UPDATE devices')));
  assert.ok(fixture.writes.some(({ sql }) => sql.includes("processing_status='ignored'")));
});

test('a dated Zid renewal does not turn an existing lifetime device into an expiring one', async () => {
  const fixture = await zidFixture({ lifetime: true });
  const response = await fixture.grant({ event: 'order.paid', id: 'new-order', payment_status: 'paid', deviceId, product_id: 'fixture-product' });
  assert.equal(response.applied, true);
  assert.equal(response.expiresAt, null);
  const update = fixture.writes.find(({ sql }) => sql.includes('UPDATE devices'));
  assert.equal(update.values[1], null);
});

test('a first paid Zid order still records a dated entitlement', async () => {
  const fixture = await zidFixture();
  const response = await fixture.grant({ event: 'order.paid', id: 'new-order', payment_status: 'paid', deviceId, product_id: 'fixture-product' });
  assert.equal(response.applied, true);
  assert.ok(response.expiresAt > Date.now());
  assert.ok(fixture.writes.some(({ sql }) => sql.includes('INSERT INTO device_subscriptions')));
});

test('a manual dated grant preserves a lifetime device but can activate an expired device', async () => {
  for (const lifetime of [true, false]) {
    const fixture = await zidFixture({ lifetime });
    const response = await fixture.hooks.request('/api/v1/admin/grant', {
      method: 'POST', headers: { authorization: `Bearer ${env.BLOFY_ADMIN_TOKEN}` },
      body: { deviceId, planKey: 'annual' }
    });
    assert.equal(response.status, 200);
    const expiry = JSON.parse(response.body).expiresAt;
    if (lifetime) assert.equal(expiry, null);
    else assert.ok(expiry > Date.now());
  }
});

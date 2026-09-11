import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { releaseCouponReservations } from '../src/payment-coupon-reservations.mjs';

const ORDER_ID = '11223344-1122-4122-8122-112233445566';
const DEVICE_ID = 'BLOFY-1234-ABCD';

// Execute the production hook without opening a Postgres pool or patching process-wide HTTP.
// The database double below models only the statements exercised by these transaction tests;
// any unrecognized statement fails the test rather than succeeding silently.
async function loadHook(filename, database) {
  const source = await readFile(new URL(`../src/${filename}`, import.meta.url), 'utf8');
  const dependencies = {};
  for (const [, path] of source.matchAll(/^import .* from '(\.\/[^']+)';$/gm)) {
    Object.assign(dependencies, await import(new URL(`../src/${path}`, import.meta.url)));
  }
  const context = vm.createContext({
    http: { createServer() {} }, crypto,
    pg: { Pool: class { async connect() { return database; } } },
    process: { env: { DATABASE_URL: 'test-only' } },
    setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }),
    ...dependencies,
  });
  return vm.runInContext(
    source.replace(/\r\n/g, '\n').replace(/^import .*;\n/gm, '').replace(/^export /gm, '') +
      '\n({ applyPaymentEvent: typeof applyPaymentEvent === "function" ? applyPaymentEvent : null, cleanupStalePaymentOrders: typeof cleanupStalePaymentOrders === "function" ? cleanupStalePaymentOrders : null })',
    context,
  );
}

class PaymentDatabase {
  constructor({ status = 'pending', blocked = false, coupon = false } = {}) {
    this.order = { id: ORDER_ID, device_id: DEVICE_ID, plan_key: 'annual', status,
      duration_days: 365, amount_minor: 16500, currency: 'SAR', coupon_code: coupon ? 'SAVE' : null };
    this.device = { status: blocked ? 'blocked' : 'expired', expires_at: null };
    this.subscriptions = [];
    this.events = new Map();
    this.redemptions = coupon ? [{ code: 'SAVE', order_id: ORDER_ID }] : [];
    this.couponCount = coupon ? 1 : 0;
    this.stale = true;
    this.released = false;
    this.lockedDevice = false;
    this.lockedRefundSubscriptions = false;
    this.renewalSnapshot = false;
  }

  release() { this.released = true; }

  async query(statement, parameters = []) {
    const sql = statement.replace(/\s+/g, ' ').trim();
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    if (sql.startsWith('INSERT INTO payment_events')) {
      const key = `${parameters[0]}:${parameters[1]}`;
      if (this.events.has(key)) return { rows: [] };
      const event = { id: this.events.size + 1, status: 'received' };
      this.events.set(key, event);
      return { rows: [{ id: event.id }] };
    }
    if (sql.startsWith('SELECT so.*,sp.duration_days')) return { rows: [{ ...this.order }] };
    if (sql === 'SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE') {
      this.lockedDevice = true;
      return { rows: [{ device_id: DEVICE_ID }] };
    }
    if (sql === 'SELECT id FROM device_subscriptions WHERE order_id=$1 FOR UPDATE') {
      this.lockedRefundSubscriptions = true;
      return { rows: this.subscriptions.filter((row) => row.order_id === parameters[0]) };
    }
    if (sql.startsWith("UPDATE subscription_orders SET status='paid'")) {
      this.order.status = 'paid';
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE subscription_orders SET status='refunded'")) {
      this.order.status = 'refunded';
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE subscription_orders SET status=$2')) {
      this.order.status = parameters[1];
      return { rows: [] };
    }
    if (sql.startsWith('SELECT expires_at FROM device_subscriptions')) {
      if (sql.includes('ORDER BY expires_at DESC')) this.renewalSnapshot = true;
      const subscriptions = this.subscriptions.filter((row) => row.status === 'active');
      if (sql.includes('expires_at>NOW()')) subscriptions.sort((a, b) =>
        (b.expires_at?.getTime() ?? Infinity) - (a.expires_at?.getTime() ?? Infinity));
      return { rows: subscriptions.slice(0, 1) };
    }
    if (sql.startsWith('INSERT INTO device_subscriptions')) {
      this.subscriptions.push({ id: parameters[0], order_id: parameters[3], expires_at: parameters[4], status: 'active' });
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE device_subscriptions SET status='refunded'")) {
      for (const row of this.subscriptions) if (row.order_id === parameters[0]) row.status = 'refunded';
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE devices SET status=')) {
      if (this.device.status === 'blocked' && sql.includes("status!='blocked'")) return { rows: [] };
      this.device.status = sql.includes("status='active'") ? 'active' : 'expired';
      this.device.expires_at = parameters[1] ?? null;
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE payment_events SET processing_status=')) {
      const event = [...this.events.values()].find((row) => row.id === parameters[0]);
      event.status = sql.includes("processing_status='ignored'") ? 'ignored' : 'applied';
      return { rows: [] };
    }
    if (sql.startsWith('DELETE FROM coupon_redemptions')) {
      const ids = Array.isArray(parameters[0]) ? parameters[0] : [parameters[0]];
      const removed = this.redemptions.filter((row) => ids.includes(row.order_id));
      this.redemptions = this.redemptions.filter((row) => !ids.includes(row.order_id));
      return { rows: removed };
    }
    if (sql.startsWith('UPDATE coupons SET redemption_count=GREATEST')) {
      this.couponCount = Math.max(0, this.couponCount - (parameters[1] ?? 1));
      return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO coupon_redemptions')) {
      if (this.redemptions.some((row) => row.order_id === parameters[2] && row.code === parameters[0])) return { rows: [] };
      const row = { code: parameters[0], order_id: parameters[2] };
      this.redemptions.push(row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE coupons SET redemption_count=redemption_count+1')) {
      this.couponCount++;
      return { rows: [] };
    }
    if (sql.startsWith('SELECT id FROM subscription_orders')) {
      const pending = this.order.status === 'pending' && this.stale;
      const abandoned = sql.includes("status IN ('failed','cancelled')") &&
        ['failed', 'cancelled'].includes(this.order.status) && this.redemptions.length > 0;
      return { rows: pending || abandoned ? [{ id: ORDER_ID }] : [] };
    }
    if (sql.startsWith("UPDATE subscription_orders SET status='cancelled'")) {
      if (this.order.status === 'pending') this.order.status = 'cancelled';
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  }
}

function event(type, eventId = `event-${type}`) {
  return { eventId, type, provider: 'test', orderId: ORDER_ID, amountMinor: 16500, currency: 'SAR' };
}

async function paymentHook(database) {
  return loadHook('subscription-hook.mjs', database);
}

test('a paid webhook records payment without unblocking a blocked device', async () => {
  const database = new PaymentDatabase({ blocked: true });
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('paid'));
  assert.equal(database.order.status, 'paid');
  assert.equal(database.subscriptions.length, 1);
  assert.equal(database.device.status, 'blocked');
});

test('a delayed paid event after refund cannot recreate an entitlement', async () => {
  const database = new PaymentDatabase();
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('paid'));
  await hook.applyPaymentEvent(database, event('refunded'));
  await hook.applyPaymentEvent(database, event('paid', 'event-paid-delayed'));
  assert.equal(database.order.status, 'refunded');
  assert.equal(database.device.status, 'expired');
  assert.equal(database.subscriptions.length, 1);
  assert.equal(database.subscriptions[0].status, 'refunded');
  assert.equal(database.events.get('test:event-paid-delayed').status, 'ignored');
});

for (const type of ['failed', 'cancelled']) {
  test(`${type} webhooks release a coupon reservation exactly once`, async () => {
    const database = new PaymentDatabase({ coupon: true });
    const hook = await paymentHook(database);
    await hook.applyPaymentEvent(database, event(type));
    await hook.applyPaymentEvent(database, event(type, `event-${type}-again`));
    assert.equal(database.order.status, type);
    assert.equal(database.redemptions.length, 0);
    assert.equal(database.couponCount, 0);
  });
}

test('a normal paid event consumes its existing coupon once even with multiple success event IDs', async () => {
  const database = new PaymentDatabase({ coupon: true });
  const hook = await paymentHook(database);
  const first = await hook.applyPaymentEvent(database, event('paid'));
  const duplicate = await hook.applyPaymentEvent(database, event('paid'));
  await hook.applyPaymentEvent(database, event('paid', 'event-paid-replayed'));
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(database.device.status, 'active');
  assert.equal(database.subscriptions.length, 1);
  assert.equal(database.redemptions.length, 1);
  assert.equal(database.couponCount, 1);
});

test('late paid confirmation after cancellation restores released coupon usage exactly once', async () => {
  const database = new PaymentDatabase({ coupon: true });
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('cancelled'));
  assert.equal(database.couponCount, 0);
  await hook.applyPaymentEvent(database, event('paid'));
  await hook.applyPaymentEvent(database, event('paid', 'event-paid-again'));
  assert.equal(database.order.status, 'paid');
  assert.equal(database.subscriptions.length, 1);
  assert.equal(database.redemptions.length, 1);
  assert.equal(database.couponCount, 1);
});

test('failure or cancellation after confirmed payment does not release consumed coupons', async () => {
  const database = new PaymentDatabase({ coupon: true });
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('paid'));
  await hook.applyPaymentEvent(database, event('failed'));
  await hook.applyPaymentEvent(database, event('cancelled'));
  assert.equal(database.order.status, 'paid');
  assert.equal(database.device.status, 'active');
  assert.equal(database.couponCount, 1);
});

test('paid events require an exact integer amount in minor currency units', async () => {
  for (const amountMinor of [16499.6, 16500.4, 16499, 16501, Number.MAX_SAFE_INTEGER + 1]) {
    const database = new PaymentDatabase();
    const hook = await paymentHook(database);
    await assert.rejects(
      hook.applyPaymentEvent(database, { ...event('paid'), amountMinor }),
      /payment_amount_mismatch/,
    );
    assert.equal(database.order.status, 'pending');
    assert.equal(database.subscriptions.length, 0);
  }
});

test('renewal extends the furthest active expiry even when subscription insertion timestamps differ', async () => {
  const database = new PaymentDatabase();
  const furthest = new Date(Date.now() + 100 * 86_400_000);
  // A transaction that started earlier can commit later after waiting on the
  // device lock. Its NOW()/starts_at need not be the newest timestamp.
  database.subscriptions = [
    { order_id: 'other-newer-start', status: 'active', expires_at: new Date(Date.now() + 30 * 86_400_000) },
    { order_id: 'other-older-start', status: 'active', expires_at: furthest },
  ];
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('paid'));
  assert.equal(database.device.expires_at.getTime(), furthest.getTime() + 365 * 86_400_000);
});

test('finite renewal and its later refund both preserve a prior lifetime entitlement', async () => {
  const database = new PaymentDatabase();
  database.subscriptions = [{ order_id: 'lifetime-order', status: 'active', expires_at: null }];
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('paid'));
  assert.equal(database.device.status, 'active');
  assert.equal(database.device.expires_at, null);
  await hook.applyPaymentEvent(database, event('refunded'));
  assert.equal(database.device.status, 'active');
  assert.equal(database.device.expires_at, null);
});

test('renewal reads entitlement under its device lock without waiting on subscription locks', async () => {
  const database = new PaymentDatabase();
  const query = database.query.bind(database);
  database.query = async (sql, parameters) => {
    if (sql.includes('SELECT expires_at FROM device_subscriptions') && sql.includes('ORDER BY expires_at DESC')) {
      assert.equal(database.lockedDevice, true, 'device must be locked before the renewal snapshot');
      assert.doesNotMatch(sql, /FOR UPDATE/, 'expiry maintenance may own the subscription lock while waiting for this device');
    }
    return query(sql, parameters);
  };
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('paid'));
  assert.equal(database.renewalSnapshot, true);
  assert.equal(database.device.status, 'active');
});

test('refund locks its subscription rows before the device, matching expiry maintenance order', async () => {
  const database = new PaymentDatabase({ status: 'paid' });
  database.subscriptions = [{ order_id: ORDER_ID, status: 'active', expires_at: new Date(Date.now() + 30 * 86_400_000) }];
  const query = database.query.bind(database);
  database.query = async (sql, parameters) => {
    if (sql === 'SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE') {
      assert.equal(database.lockedRefundSubscriptions, true, 'subscription row locks precede the device lock');
    }
    if (sql.startsWith("UPDATE device_subscriptions SET status='refunded'")) {
      assert.equal(database.lockedDevice, true, 'device remains serialized during entitlement changes');
    }
    return query(sql, parameters);
  };
  const hook = await paymentHook(database);
  await hook.applyPaymentEvent(database, event('refunded'));
  assert.equal(database.order.status, 'refunded');
  assert.equal(database.device.status, 'expired');
});

for (const status of ['failed', 'cancelled']) {
  test(`maintenance repairs an existing ${status} order reservation once without rewriting its status`, async () => {
    const database = new PaymentDatabase({ status, coupon: true });
    const hook = await loadHook('payment-order-maintenance.mjs', database);
    assert.equal(await hook.cleanupStalePaymentOrders(), 1);
    assert.equal(database.order.status, status);
    assert.equal(database.redemptions.length, 0);
    assert.equal(database.couponCount, 0);
    assert.equal(await hook.cleanupStalePaymentOrders(), 0);
    assert.equal(database.couponCount, 0);
    assert.equal(database.released, true);
  });
}

test('maintenance expires stale pending orders but retains fresh pending and paid reservations', async () => {
  const stale = new PaymentDatabase({ coupon: true });
  const staleHook = await loadHook('payment-order-maintenance.mjs', stale);
  assert.equal(await staleHook.cleanupStalePaymentOrders(), 1);
  assert.equal(stale.order.status, 'cancelled');
  assert.equal(stale.couponCount, 0);
  for (const status of ['pending', 'paid', 'refunded']) {
    const database = new PaymentDatabase({ status, coupon: true });
    database.stale = false;
    const hook = await loadHook('payment-order-maintenance.mjs', database);
    assert.equal(await hook.cleanupStalePaymentOrders(), 0);
    assert.equal(database.order.status, status);
    assert.equal(database.couponCount, 1);
  }
});

test('batch coupon release returns only actual deleted reservations and groups counts per coupon', async () => {
  const updates = [];
  let redemptions = [{ code: 'SAVE' }, { code: 'SAVE' }, { code: 'OTHER' }];
  const database = { async query(sql, parameters) {
    if (sql.trim().startsWith('DELETE')) {
      const rows = redemptions;
      redemptions = [];
      return { rows };
    }
    updates.push(parameters);
    return { rows: [] };
  } };
  await releaseCouponReservations(database, [ORDER_ID]);
  await releaseCouponReservations(database, [ORDER_ID]);
  assert.deepEqual(updates, [['SAVE', 2], ['OTHER', 1]]);
});

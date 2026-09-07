import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

// This suite writes synthetic fixtures. Refuse remote HTTP and database targets,
// including accidentally inherited production credentials, before connecting.
function loopbackUrl(value, protocols, name) {
  assert.ok(value, `${name} must be explicitly configured`);
  const url = new URL(value);
  assert.ok(protocols.includes(url.protocol), `${name} has an unsupported protocol`);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), `${name} must use loopback`);
  return url;
}

const serviceUrl = loopbackUrl(process.env.BLOFY_E2E_BASE_URL, ['http:'], 'BLOFY_E2E_BASE_URL');
assert.equal(serviceUrl.username, '');
assert.equal(serviceUrl.password, '');
const databaseUrl = loopbackUrl(process.env.DATABASE_URL, ['postgres:', 'postgresql:'], 'DATABASE_URL');
assert.equal(process.env.PGSSLMODE, 'disable', 'Use the isolated CI PostgreSQL service');
assert.ok(!databaseUrl.search, 'Database URL query overrides are not allowed');
const webhookSecret = String(process.env.BLOFY_PAYMENT_WEBHOOK_SECRET || '');
assert.ok(webhookSecret.length >= 24, 'Configure the test webhook secret before starting the service');
const adminToken = String(process.env.BLOFY_ADMIN_TOKEN || '');
assert.ok(adminToken.length >= 24, 'Configure the isolated service admin token');

const pool = new pg.Pool({ connectionString: databaseUrl.href, ssl: false });
const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
const provider = `ci-reg-${suffix.toLowerCase()}`;
const deviceIds = [];
const planKeys = [];
const couponCodes = [];
const dayMs = 86_400_000;

async function request(path, { method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(new URL(path, serviceUrl), {
    method,
    redirect: 'error',
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000)
  });
  const json = await response.json();
  return { status: response.status, json };
}

function expectStatus(result, status) {
  assert.equal(result.status, status, `HTTP ${result.status}: ${JSON.stringify(result.json)}`);
  return result.json;
}

async function device(status = 'expired') {
  const identity = {
    deviceId: `BLOFY-REG-${suffix}-${deviceIds.length}`,
    activationCode: String(crypto.randomInt(100_000, 1_000_000))
  };
  deviceIds.push(identity.deviceId);
  await pool.query(
    `INSERT INTO devices(device_id,activation_code,status,expires_at)
     VALUES($1,$2,$3,NOW()-INTERVAL '1 day')`,
    [identity.deviceId, identity.activationCode, status]
  );
  return identity;
}

async function plan(days) {
  const key = `ci-reg-${suffix}-${planKeys.length}`;
  planKeys.push(key);
  await pool.query(
    `INSERT INTO subscription_plans(plan_key,name,duration_days,price_minor,currency)
     VALUES($1,'CI regression fixture',$2,1000,'SAR')`, [key, days]
  );
  return key;
}

async function coupon() {
  const code = `CI-REG-${suffix}-${couponCodes.length}`;
  couponCodes.push(code);
  await pool.query(
    `INSERT INTO coupons(code,discount_type,discount_value,currency,max_redemptions)
     VALUES($1,'fixed',100,'SAR',1)`, [code]
  );
  return code;
}

async function order(identity, planKey, couponCode) {
  return expectStatus(await request('/api/v1/subscriptions/orders', {
    body: { ...identity, planKey, couponCode }
  }), 201);
}

function payment(order, type, eventId = crypto.randomUUID(), overrides = {}) {
  return {
    provider, eventId, type, orderId: order.orderId,
    providerReference: order.orderId, amountMinor: order.amountMinor,
    currency: order.currency, ...overrides
  };
}

async function deliver(payload) {
  const signature = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(payload)).digest('hex');
  return request('/api/v1/subscriptions/payment/webhook', {
    body: payload, headers: { 'x-blofy-signature': signature }
  });
}

async function deviceRow(identity) {
  return (await pool.query('SELECT * FROM devices WHERE device_id=$1', [identity.deviceId])).rows[0];
}

async function couponCount(code, orderId) {
  const result = await pool.query(
    `SELECT c.redemption_count,
     (SELECT COUNT(*)::int FROM coupon_redemptions r WHERE r.code=c.code AND r.order_id=$2) AS reserved
     FROM coupons c WHERE c.code=$1`, [code, orderId]
  );
  return result.rows[0];
}

try {
  // A healthy fresh database must also have the commerce schema: its customer
  // table references devices and used to race the base schema during startup.
  const users = expectStatus(await request('/api/v1/admin/users?limit=1', {
    method: 'GET', headers: { authorization: `Bearer ${adminToken}` }
  }), 200);
  assert.ok(Array.isArray(users.items));
  assert.ok((await pool.query("SELECT to_regclass('device_customers') AS table_name")).rows[0].table_name);

  const month = await plan(30);
  const year = await plan(365);
  const lifetime = await plan(null);

  // Exercise the real schema: device_subscriptions has status, never an active column.
  // Lifetime entitlement must win over a newer finite subscription.
  const readyDevice = await device();
  await pool.query(
    `INSERT INTO device_subscriptions(id,device_id,plan_key,starts_at,expires_at,status)
     VALUES($1,$2,$3,NOW()-INTERVAL '1 day',NULL,'active'),
           ($4,$2,$5,NOW(),NOW()+INTERVAL '30 days','active')`,
    [crypto.randomUUID(), readyDevice.deviceId, lifetime, crypto.randomUUID(), month]
  );
  const pending = await order(readyDevice, month);
  const readiness = expectStatus(await request('/api/v1/subscriptions/readiness', { body: readyDevice }), 200);
  assert.equal(readiness.subscription?.plan_key, lifetime);
  assert.equal(readiness.subscription?.expires_at, null);
  assert.equal(readiness.pendingOrder?.id, pending.orderId);
  assert.equal(readiness.webhookConfigured, true);
  assert.equal(readiness.readyForLivePayments, false, 'CI must not configure a live checkout');
  assert.ok(readiness.plansAvailable >= 3);
  for (const event of ['paid', 'refunded']) {
    expectStatus(await deliver(payment(pending, event)), 200);
    const lifetimeDevice = await deviceRow(readyDevice);
    assert.equal(lifetimeDevice.status, 'active');
    assert.equal(lifetimeDevice.expires_at, null, 'A dated order/refund must preserve lifetime entitlement');
    const status = expectStatus(await request('/api/v1/subscriptions/status', { body: readyDevice }), 200);
    assert.equal(status.active, true);
    assert.equal(status.expiresAt, null);
    assert.equal(status.planKey, lifetime, 'Subscription status must return the surviving lifetime entitlement');
  }

  // Wrong PIN attempts share one durable failure budget across hook endpoints.
  // Valid polling between guesses must not reset that budget; expired devices can renew.
  const lockedDevice = await device();
  expectStatus(await request('/api/v1/renew/validate', { body: lockedDevice }), 200);
  const wrongCode = lockedDevice.activationCode === '000000' ? '999999' : '000000';
  const authPaths = [
    '/api/v1/cloud/profile?profileId=default', '/api/v1/subscriptions/status',
    '/api/v1/subscriptions/readiness', '/api/v1/renew/validate', '/api/v1/subscriptions/status'
  ];
  for (const [index, path] of authPaths.entries()) {
    const response = path.startsWith('/api/v1/cloud/')
      ? await request(path, { method: 'GET', headers: {
        'x-blofy-device-id': lockedDevice.deviceId, 'x-blofy-activation-code': wrongCode
      } })
      : await request(path, { body: { ...lockedDevice, activationCode: wrongCode } });
    expectStatus(response, 403);
    assert.equal((await deviceRow(lockedDevice)).auth_failed_attempts, index + 1);
    if (index < 4) expectStatus(await request('/api/v1/subscriptions/status', { body: lockedDevice }), 200);
  }
  assert.ok(new Date((await deviceRow(lockedDevice)).auth_locked_until).getTime() > Date.now());
  for (const path of ['/api/v1/subscriptions/status', '/api/v1/subscriptions/readiness', '/api/v1/renew/validate']) {
    expectStatus(await request(path, { body: lockedDevice }), 403);
  }
  expectStatus(await request('/api/v1/cloud/profile?profileId=default', { method: 'GET', headers: {
    'x-blofy-device-id': lockedDevice.deviceId, 'x-blofy-activation-code': lockedDevice.activationCode
  } }), 403);

  // First-write optimistic concurrency must retain exactly one complete payload.
  const cloudDevice = await device();
  const writes = ['first', 'second'].map((marker) => request('/api/v1/cloud/profile', {
    method: 'PUT', body: { ...cloudDevice, profileId: 'initial-race', expectedRevision: 0, payload: { watchlist: [marker] } }
  }));
  const cloudResults = await Promise.all(writes);
  assert.deepEqual(cloudResults.map((r) => r.status).sort(), [200, 409]);
  const winner = cloudResults.find((r) => r.status === 200).json;
  const snapshot = (await pool.query(
    'SELECT revision,payload_json FROM profile_cloud_snapshots WHERE device_id=$1 AND profile_id=$2',
    [cloudDevice.deviceId, 'initial-race']
  )).rows[0];
  assert.equal(Number(snapshot.revision), 1);
  assert.deepEqual(snapshot.payload_json, winner.payload);

  // A signed payment or refund must never clear an administrator's device block.
  const blocked = await device('blocked');
  const blockedOrder = await order(blocked, month);
  expectStatus(await deliver(payment(blockedOrder, 'paid')), 200);
  assert.equal((await deviceRow(blocked)).status, 'blocked');
  expectStatus(await deliver(payment(blockedOrder, 'refunded')), 200);
  assert.equal((await deviceRow(blocked)).status, 'blocked');

  // Validate exact minor units and terminal refunds through the actual webhook transaction.
  const refundedDevice = await device();
  const refundedOrder = await order(refundedDevice, month);
  const invalidAmount = payment(refundedOrder, 'paid', crypto.randomUUID(), { amountMinor: refundedOrder.amountMinor + 0.4 });
  assert.equal(expectStatus(await deliver(invalidAmount), 400).error, 'payment_amount_mismatch');
  assert.equal((await pool.query('SELECT status FROM subscription_orders WHERE id=$1', [refundedOrder.orderId])).rows[0].status, 'pending');
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM payment_events WHERE payment_provider=$1 AND provider_event_id=$2', [provider, invalidAmount.eventId])).rows[0].count, 0);
  expectStatus(await deliver(payment(refundedOrder, 'paid')), 200);
  expectStatus(await deliver(payment(refundedOrder, 'refunded')), 200);
  expectStatus(await deliver(payment(refundedOrder, 'paid')), 200);
  assert.equal((await deviceRow(refundedDevice)).status, 'expired');
  assert.equal((await pool.query('SELECT status FROM subscription_orders WHERE id=$1', [refundedOrder.orderId])).rows[0].status, 'refunded');
  const refundedLedger = await pool.query('SELECT status FROM device_subscriptions WHERE order_id=$1', [refundedOrder.orderId]);
  assert.deepEqual(refundedLedger.rows.map((row) => row.status), ['refunded']);

  // Cancellation/failure returns coupon capacity once; a late verified payment
  // records the consumed discount again without double counting repeated events.
  for (const terminalStatus of ['failed', 'cancelled']) {
    const buyer = await device();
    const code = await coupon();
    const discounted = await order(buyer, month, code);
    assert.deepEqual(await couponCount(code, discounted.orderId), { redemption_count: 1, reserved: 1 });
    const failure = payment(discounted, terminalStatus);
    expectStatus(await deliver(failure), 200);
    assert.equal(expectStatus(await deliver(failure), 200).duplicate, true);
    expectStatus(await deliver(payment(discounted, terminalStatus)), 200);
    assert.deepEqual(await couponCount(code, discounted.orderId), { redemption_count: 0, reserved: 0 });
    assert.equal((await pool.query('SELECT status FROM subscription_orders WHERE id=$1', [discounted.orderId])).rows[0].status, terminalStatus);
    expectStatus(await deliver(payment(discounted, 'paid')), 200);
    expectStatus(await deliver(payment(discounted, 'paid')), 200);
    assert.deepEqual(await couponCount(code, discounted.orderId), { redemption_count: 1, reserved: 1 });
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM device_subscriptions WHERE order_id=$1', [discounted.orderId])).rows[0].count, 1);
  }

  // Two distinct plans must serialize their expiry calculation for the same device.
  // Hold its row until both webhook transactions are waiting: the former code
  // calculated both expiries before its later FK/device lock and lost one renewal.
  const renewalDevice = await device();
  const renewalOrders = [await order(renewalDevice, month), await order(renewalDevice, year)];
  const blocker = await pool.connect();
  let deliveries = [];
  let barrierOpen = false;
  try {
    await blocker.query('BEGIN');
    barrierOpen = true;
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await blocker.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE', [renewalDevice.deviceId]);
    deliveries = renewalOrders.map((item) => deliver(payment(item, 'paid')));
    // Attach rejection handlers while polling; final assertions still require both successes.
    deliveries.forEach((delivery) => delivery.catch(() => {}));
    let waiters = 0;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && waiters < 2) {
      const result = await pool.query(
        `WITH RECURSIVE blocked(pid) AS (
           SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))
         ) SELECT COUNT(DISTINCT pid)::int AS count FROM blocked`, [blockerPid]
      );
      waiters = result.rows[0].count;
      if (waiters < 2) await delay(25);
    }
    assert.ok(waiters >= 2, 'Both payment transactions must overlap at the device lock');
    await blocker.query('COMMIT');
    barrierOpen = false;
    for (const result of await Promise.all(deliveries)) expectStatus(result, 200);
  } finally {
    if (barrierOpen) await blocker.query('ROLLBACK').catch(() => {});
    blocker.release();
    await Promise.allSettled(deliveries);
  }
  const renewal = await deviceRow(renewalDevice);
  assert.equal(renewal.status, 'active');
  const remainingDays = (new Date(renewal.expires_at).getTime() - Date.now()) / dayMs;
  assert.ok(remainingDays > 394.99 && remainingDays <= 395.01, `Expected both renewals (395 days), got ${remainingDays}`);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM device_subscriptions WHERE device_id=$1 AND status='active'", [renewalDevice.deviceId])).rows[0].count, 2);
  const nextRenewal = await order(renewalDevice, month);
  expectStatus(await deliver(payment(nextRenewal, 'paid')), 200);
  const extendedDays = (new Date((await deviceRow(renewalDevice)).expires_at).getTime() - Date.now()) / dayMs;
  assert.ok(extendedDays > 424.99 && extendedDays <= 425.01, `The next renewal must extend the longest entitlement to 425 days, got ${extendedDays}`);

  console.log('BLOFY PostgreSQL commercial regressions passed: readiness, shared auth lockout, cloud concurrency, payment/refund/coupon integrity and concurrent renewals');
} finally {
  try {
    await pool.query('DELETE FROM payment_events WHERE payment_provider=$1', [provider]);
    await pool.query('DELETE FROM devices WHERE device_id=ANY($1::text[])', [deviceIds]);
    await pool.query('DELETE FROM coupons WHERE code=ANY($1::text[])', [couponCodes]);
    await pool.query('DELETE FROM subscription_plans WHERE plan_key=ANY($1::text[])', [planKeys]);
  } finally {
    await pool.end();
  }
}

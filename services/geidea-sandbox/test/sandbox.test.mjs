import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { loadConfig, amountMinor } from '../src/config.mjs';
import { OrderStore } from '../src/store.mjs';
import { createSandboxServer } from '../src/server.mjs';
import { verifyCallback } from '../src/provider.mjs';

// Deliberately synthetic credentials. The provider below accepts no traffic to
// any real service; end-to-end tests use real HTTP only on 127.0.0.1.
const key = crypto.randomUUID();
const password = 'synthetic-test-api-password';
const admin = 'synthetic-sandbox-administrator-token-only';
const env = {
  BLOFY_GEIDEA_TEST_MODE: 'enabled', GEIDEA_CREDENTIALS_ENVIRONMENT: 'test',
  GEIDEA_TEST_MERCHANT_PUBLIC_KEY: key, GEIDEA_TEST_API_PASSWORD: password,
  BLOFY_GEIDEA_ADMIN_TOKEN: admin,
  BLOFY_GEIDEA_PUBLIC_URL: 'https://sandbox-test.up.railway.app',
};
const authorization = 'Basic ' + Buffer.from('sandbox:' + admin).toString('base64');

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'blofy-geidea-sandbox-'));
  const config = loadConfig({ ...env, BLOFY_GEIDEA_DB_PATH: join(dir, 'orders.sqlite') });
  const provider = { creates: 0, reads: 0, orders: new Map(), rejectCreate: false, rejectRead: false };
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'Basic ' + Buffer.from(key + ':' + password).toString('base64'));
    if (url === 'https://api.ksamerchant.geidea.net/payment-intent/api/v2/direct/session') {
      provider.creates++;
      const body = JSON.parse(options.body);
      assert.equal(body.amount, '1.00');
      assert.equal(body.currency, 'SAR');
      assert.equal(body.callbackUrl, config.publicOrigin + '/api/geidea/callback');
      const expected = crypto.createHmac('sha256', password).update(key + '1.00SAR' + body.merchantReferenceId + body.timestamp).digest('base64');
      assert.equal(body.signature, expected);
      if (provider.rejectCreate) throw new Error(password + ' raw network failure');
      await new Promise(resolve => setTimeout(resolve, 10));
      return { ok: true, json: async () => ({ responseCode: '000', detailedResponseCode: '000', session: {
        id: crypto.randomUUID(), amount: 1, currency: 'SAR', merchantReferenceId: body.merchantReferenceId,
        expiryDate: new Date(Date.now() + 900000).toISOString(),
      } }) };
    }
    assert.ok(url.startsWith('https://api.ksamerchant.geidea.net/pgw/api/v1/direct/order'));
    provider.reads++;
    if (provider.rejectRead) throw new Error(password + ' raw network failure');
    const parsed = new URL(url);
    const reference = parsed.searchParams.get('MerchantReferenceId');
    const order = reference ? provider.orders.get(reference) :
      [...provider.orders.values()].find(value => value.orderId === parsed.pathname.split('/').at(-1));
    return { ok: true, json: async () => ({ responseCode: '000', detailedResponseCode: '000',
      ...(reference ? { orders: order ? [order] : [] } : { order }) }) };
  };
  const { server, store } = createSandboxServer({ config, fetchImpl });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const request = async (path, { body, method = body === undefined ? 'GET' : 'POST', auth = true,
    origin = config.publicOrigin, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: {
      ...(auth ? { authorization } : {}), ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...headers,
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const content = await response.text();
    return { status: response.status, headers: response.headers, text: content,
      data: response.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(content) : null };
  };
  const create = async (network = 'visa', scenario = 'success', idempotencyKey = crypto.randomUUID()) =>
    request('/api/sessions', { body: { network, scenario }, headers: { 'idempotency-key': idempotencyKey } });
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); await rm(dir, { recursive: true, force: true }); });
  return { request, create, provider, store, config };
}

function paid(reference, brand = 'visa') {
  return { orderId: crypto.randomUUID(), merchantReferenceId: reference,
    merchantPublicKey: key, merchantId: crypto.randomUUID(), isTest: true,
    amount: 1, totalAmount: 1, currency: 'SAR', status: 'Success', detailedStatus: 'Paid',
    totalCapturedAmount: 1, totalRefundedAmount: 0, paymentOperation: 'Pay',
    paymentMethod: { brand, maskedCardNumber: 'DO-NOT-STORE-CARD-DATA', cardholderName: 'DO-NOT-STORE-NAME' },
    transactions: [{ type: 'Pay', status: 'Success', amount: 1, currency: 'SAR',
      codes: { responseCode: '000', detailedResponseCode: '000' } }],
  };
}
function signed(order, stamp = '2026/10/23 01:00:00') {
  const message = key + Number(order.amount).toFixed(2) + order.currency + order.orderId +
    order.status + order.merchantReferenceId + stamp;
  return { order, responseCode: '000', detailedResponseCode: '000', timeStamp: stamp,
    signature: crypto.createHmac('sha256', password).update(message).digest('base64') };
}

test('startup requires explicit test flags, dedicated secrets, fixed price and isolated Railway project/volume', () => {
  assert.throws(() => loadConfig({}), /sandbox_test_mode_required/);
  for (const overrides of [
    { GEIDEA_CREDENTIALS_ENVIRONMENT: 'production' }, { GEIDEA_TEST_PRICE_MINOR: '200' },
    { BLOFY_GEIDEA_ADMIN_TOKEN: 'short' }, { GEIDEA_TEST_MERCHANT_PUBLIC_KEY: 'bad' },
    { DATABASE_URL: 'postgresql://production' }, { BLOFY_ADMIN_TOKEN: 'production-token' },
    { BLOFY_GEIDEA_PUBLIC_URL: 'https://blofysat.example' },
    { BLOFY_GEIDEA_PUBLIC_URL: 'http://sandbox-test.up.railway.app' },
  ]) assert.throws(() => loadConfig({ ...env, ...overrides }));
  const id = crypto.randomUUID();
  const railway = { ...env, RAILWAY_PROJECT_ID: id, BLOFY_GEIDEA_SANDBOX_PROJECT_ID: id,
    RAILWAY_PROJECT_NAME: 'BLOFY-Geidea-Sandbox', RAILWAY_PUBLIC_DOMAIN: 'sandbox-test.up.railway.app',
    RAILWAY_VOLUME_MOUNT_PATH: '/data' };
  assert.equal(loadConfig(railway).host, '0.0.0.0');
  for (const overrides of [
    { RAILWAY_PROJECT_NAME: 'BLOFY-Update-Distribution' }, { BLOFY_GEIDEA_SANDBOX_PROJECT_ID: crypto.randomUUID() },
    { RAILWAY_VOLUME_MOUNT_PATH: '/production' }, { BLOFY_GEIDEA_DB_PATH: '/data/licenses.sqlite' },
    { RAILWAY_PUBLIC_DOMAIN: 'real-production.up.railway.app' },
  ]) assert.throws(() => loadConfig({ ...railway, ...overrides }), /sandbox_/);
});

test('money is parsed as exact halalas and malformed or excess precision amounts are rejected', () => {
  assert.equal(amountMinor(1), 100);
  assert.equal(amountMinor('1.00'), 100);
  assert.equal(amountMinor('0.01'), 1);
  for (const input of [null, [], true, '1.001', '-1', '1e2', NaN, Infinity, '1.00SAR']) {
    assert.throws(() => amountMinor(input), /geidea_invalid_amount/);
  }
});

test('health exposes no credentials; UI, evidence, production routes and mutations are protected', async t => {
  const f = await fixture(t);
  const health = await f.request('/health', { auth: false });
  assert.equal(health.status, 200);
  assert.equal(health.data.mode, 'sandbox');
  assert.equal(health.data.activationsEnabled, false);
  for (const path of ['/', '/app.js', '/api/orders', '/api/evidence', '/return?responseCode=000&status=Success']) {
    assert.equal((await f.request(path, { auth: false })).status, 401);
  }
  const page = await f.request('/');
  assert.equal(page.status, 200);
  assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal((await f.request('/api/v1/activation/check', { body: {} })).status, 404);
  const rejected = await f.request('/api/sessions', { body: { network: 'visa', scenario: 'success' },
    origin: 'https://attacker.example', headers: { 'idempotency-key': crypto.randomUUID() } });
  assert.equal(rejected.status, 403);
  const tampered = await f.request('/api/sessions', { body: { network: 'visa', scenario: 'success', amount: 0.01 },
    headers: { 'idempotency-key': crypto.randomUUID() } });
  assert.equal(tampered.status, 400);
  assert.equal(f.provider.creates, 0);
  assert.ok(!JSON.stringify(health.data).includes(password));
});

test('parallel repeated create requests make one provider session; conflicting reuse fails', async t => {
  const f = await fixture(t);
  const idempotencyKey = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.create('visa', 'success', idempotencyKey)));
  assert.ok(results.every(result => result.status === 200));
  assert.equal(new Set(results.map(result => result.data.order.reference)).size, 1);
  assert.equal(f.provider.creates, 1);
  assert.equal((await f.create('mada', 'success', idempotencyKey)).status, 409);
  const order = results[0].data.order;
  assert.equal(order.amountMinor, 100);
  assert.equal(order.currency, 'SAR');
  assert.match(results[0].data.checkoutUrl, /^https:\/\/www\.ksamerchant\.geidea\.net\/hpp\/checkout\/\?/);
  assert.equal((await f.request('/return?reference=' + order.reference + '&status=Success')).status, 200);
  assert.equal(f.store.get(order.reference).status, 'pending');
});

test('Visa, Mastercard and Mada paid results require signed callback plus server-side test-order verification', async t => {
  const f = await fixture(t);
  for (const network of ['visa', 'mastercard', 'mada']) {
    const created = await f.create(network);
    const reference = created.data.order.reference;
    const order = paid(reference, network);
    f.provider.orders.set(reference, order);
    const payload = signed(order);
    const callback = await f.request('/api/geidea/callback', { auth: false, body: payload });
    assert.equal(callback.status, 200);
    assert.equal(f.store.get(reference).status, 'paid');
    assert.equal(f.store.get(reference).callbackVerified, 1);
    const reads = f.provider.reads;
    assert.equal((await f.request('/api/geidea/callback', { auth: false, body: payload })).status, 200);
    assert.equal(f.provider.reads, reads, 'a duplicate callback is acknowledged without processing twice');
  }
  const evidence = (await f.request('/api/evidence')).data;
  assert.ok(evidence.matrix.every(row => row.scenarios.find(scenario => scenario.scenario === 'success').verified));
  assert.equal(evidence.activationsEnabled, false);
  for (const secret of [password, admin, key, 'DO-NOT-STORE-CARD-DATA', 'DO-NOT-STORE-NAME']) {
    assert.ok(!JSON.stringify(evidence).includes(secret));
    const db = await readFile(f.config.dbPath);
    assert.ok(!db.includes(Buffer.from(secret)));
  }
});

test('bad signatures, wrong amounts, currency, references, merchant keys and live orders cannot be accepted', async t => {
  const f = await fixture(t);
  const reference = (await f.create()).data.order.reference;
  const original = paid(reference);
  for (const overrides of [
    { amount: 2 }, { currency: 'USD' }, { merchantPublicKey: crypto.randomUUID() },
    { merchantReferenceId: crypto.randomUUID() }, { isTest: false }, { isTest: undefined },
  ]) {
    const result = await f.request('/api/geidea/callback', { auth: false, body: signed({ ...original, ...overrides }) });
    assert.notEqual(result.status, 200);
  }
  const corrupted = signed(original);corrupted.signature = 'A'.repeat(43) + '=';
  assert.equal((await f.request('/api/geidea/callback', { auth: false, body: corrupted })).status, 401);
  assert.equal(f.provider.reads, 0);
  assert.equal(f.store.get(reference).status, 'pending');
});

test('a signed success cannot override provider mismatch, refund, missing capture or missing successful payment', async t => {
  const f = await fixture(t);
  const reference = (await f.create()).data.order.reference;
  const original = paid(reference);
  for (const overrides of [
    { amount: 2 }, { merchantPublicKey: crypto.randomUUID() }, { isTest: false },
    { merchantReferenceId: crypto.randomUUID() }, { totalCapturedAmount: 0 },
    { totalRefundedAmount: 1 }, { transactions: [] }, { orderId: crypto.randomUUID() },
  ]) {
    f.provider.orders.set(reference, { ...original, ...overrides });
    const result = await f.request('/api/geidea/callback', { auth: false, body: signed(original) });
    assert.notEqual(result.status, 200);
    assert.equal(f.store.get(reference).status, 'pending');
    assert.equal(f.store.get(reference).callbackVerified, 0);
  }
});

test('provider failures do not leak credentials and callback retry recovers safely', async t => {
  const f = await fixture(t);
  const reference = (await f.create()).data.order.reference;
  const order = paid(reference);
  f.provider.orders.set(reference, order);
  f.provider.rejectRead = true;
  const first = await f.request('/api/geidea/callback', { auth: false, body: signed(order) });
  assert.equal(first.status, 503);
  assert.ok(!first.text.includes(password));
  assert.equal(f.store.get(reference).callbackVerified, 0);
  f.provider.rejectRead = false;
  const retry = await f.request('/api/geidea/callback', { auth: false, body: signed(order) });
  assert.equal(retry.status, 200);
  assert.equal(f.store.get(reference).status, 'paid');
});

test('decline and cancellation are recorded without declaring success or activating a subscription', async t => {
  const f = await fixture(t);
  for (const [scenario, status, detail, result] of [
    ['decline', 'Failed', 'OrderFailed', 'failed'], ['cancel', 'Cancelled', 'Cancelled', 'cancelled'],
  ]) {
    const reference = (await f.create('visa', scenario)).data.order.reference;
    const order = { ...paid(reference), status, detailedStatus: detail, transactions: [], totalCapturedAmount: 0 };
    f.provider.orders.set(reference, order);
    assert.equal((await f.request('/api/geidea/callback', { auth: false, body: signed(order) })).status, 200);
    assert.equal(f.store.get(reference).status, result);
  }
});

test('manual reconciliation works without callback; selected card network never becomes unverified evidence', async t => {
  const f = await fixture(t);
  const reference = (await f.create('mada')).data.order.reference;
  // No provider order has been created while the user has not submitted a card.
  assert.equal((await f.request('/api/orders/' + reference + '/reconcile', { body: {} })).data.order.status, 'pending');
  const order = paid(reference, 'visa');
  f.provider.orders.set(reference, order);
  const result = await f.request('/api/orders/' + reference + '/reconcile', { body: {} });
  assert.equal(result.status, 200);
  assert.equal(result.data.order.status, 'paid');
  assert.equal(result.data.order.callbackVerified, 0);
  assert.equal((await f.request('/api/geidea/callback', { auth: false, body: signed(order) })).status, 200);
  const evidence = (await f.request('/api/evidence')).data;
  assert.equal(evidence.matrix.find(row => row.network === 'mada').scenarios[0].verified, false);
  assert.equal(evidence.matrix.find(row => row.network === 'visa').scenarios[0].verified, true);
});

test('ambiguous session creation is persistent and never retried automatically under the same key', async t => {
  const f = await fixture(t);
  f.provider.rejectCreate = true;
  const idempotencyKey = crypto.randomUUID();
  const first = await f.create('visa', 'success', idempotencyKey);
  assert.equal(first.status, 502);
  assert.equal(first.data.order.status, 'create_unknown');
  assert.ok(!first.text.includes(password));
  f.provider.rejectCreate = false;
  assert.equal((await f.create('visa', 'success', idempotencyKey)).status, 502);
  assert.equal(f.provider.creates, 1);
});

test('SQLite survives restart, recovers interrupted creation and preserves callback receipts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'blofy-geidea-persist-'));
  const path = join(dir, 'orders.sqlite');
  let store = new OrderStore(path);
  try {
    const idempotencyKey = crypto.randomUUID();
    const order = store.create(idempotencyKey, 'mada', 'success');
    const second = store.create(crypto.randomUUID(), 'visa', 'success');
    const evidence = { status: 'paid', providerVerified: 1, callbackVerified: 1 };
    store.commitVerified(second.reference, evidence, 'test-digest');
    store.close();store = new OrderStore(path);
    assert.equal(store.byKey(idempotencyKey).reference, order.reference);
    assert.equal(store.get(order.reference).status, 'create_unknown');
    assert.equal(store.get(second.reference).status, 'paid');
    assert.equal(store.hasCallback('test-digest'), true);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('callback signature supports documented timeStamp and rejects ambiguous timestamp fields', () => {
  const reference = crypto.randomUUID();
  const order = paid(reference);
  const payload = signed(order);
  const expected = { reference, amountMinor: 100 };
  const config = loadConfig(env);
  assert.match(verifyCallback(payload, expected, config), /^[a-f0-9]{64}$/);
  assert.throws(() => verifyCallback({ ...payload, timestamp: 'different' }, expected, config), /signature/);
});

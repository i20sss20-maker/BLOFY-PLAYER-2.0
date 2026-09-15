import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivationCredentialCodec } from '../src/auth-protection.mjs';

const KEY = '11'.repeat(32);
process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY = KEY;
const { authenticatePortalDevice, normalizePortalDeviceId } = await import('../src/portal-pending-auth.mjs?portal-pending-auth-test');

function fakePool({ row = null } = {}) {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT * FROM devices')) return { rows: row ? [row] : [] };
      if (sql.startsWith('INSERT INTO devices')) {
        return {
          rows: [{
            device_id: params[0],
            activation_code: params[1],
            status: 'expired',
            trial_registration_pending: true
          }]
        };
      }
      if (sql.startsWith('UPDATE devices SET activation_code')) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  return { pool: { async connect() { return client; } }, queries };
}

test('normalizes copied device IDs without changing identity', () => {
  assert.equal(normalizePortalDeviceId('  blofy-abcd – ef23  '), 'BLOFY-ABCD-EF23');
});

test('existing entitled device uses hardened authorization path without pending registration', async () => {
  const existing = { device_id: 'BLOFY-ABCD-EF23', status: 'trial' };
  const { pool, queries } = fakePool();
  const auth = await authenticatePortalDevice({
    pool,
    authorizedDevice: async (id, code) => id === existing.device_id && code === '123456' ? existing : null,
    deviceId: 'blofy-abcd-ef23',
    activationCode: '123456',
    req: {}
  });
  assert.deepEqual(auth, { deviceId: existing.device_id, activationCode: '123456', pending: false });
  assert.equal(queries.length, 0);
});

test('brand-new portal pairing creates only a pending expired row and authenticates portal', async () => {
  const { pool, queries } = fakePool();
  const auth = await authenticatePortalDevice({
    pool,
    authorizedDevice: async () => null,
    deviceId: 'blofy-abcd-ef23',
    activationCode: '123456',
    req: {}
  });
  assert.deepEqual(auth, { deviceId: 'BLOFY-ABCD-EF23', activationCode: '123456', pending: true });
  const insert = queries.find((entry) => entry.sql.startsWith('INSERT INTO devices'));
  assert.ok(insert, 'pending device must be inserted');
  assert.match(insert.params[1], /^v1:[a-f0-9]{64}$/);
  assert.match(insert.sql, /'expired'/);
  assert.match(insert.sql, /TRUE/);
});

test('existing pending device is accepted only with its matching activation proof', async () => {
  const codec = createActivationCredentialCodec(KEY);
  const row = {
    device_id: 'BLOFY-ABCD-EF23',
    activation_code: codec.proof('BLOFY-ABCD-EF23', '123456'),
    status: 'expired',
    trial_registration_pending: true,
    data_deleted_at: null,
    auth_locked_until: null
  };
  const good = fakePool({ row });
  assert.deepEqual(await authenticatePortalDevice({
    pool: good.pool,
    authorizedDevice: async () => null,
    deviceId: row.device_id,
    activationCode: '123456',
    req: {}
  }), { deviceId: row.device_id, activationCode: '123456', pending: true });

  const bad = fakePool({ row });
  assert.equal(await authenticatePortalDevice({
    pool: bad.pool,
    authorizedDevice: async () => null,
    deviceId: row.device_id,
    activationCode: '654321',
    req: {}
  }), null);
});

test('expired non-pending devices remain rejected', async () => {
  const codec = createActivationCredentialCodec(KEY);
  const row = {
    device_id: 'BLOFY-ABCD-EF23',
    activation_code: codec.proof('BLOFY-ABCD-EF23', '123456'),
    status: 'expired',
    trial_registration_pending: false,
    data_deleted_at: null,
    auth_locked_until: null
  };
  const { pool } = fakePool({ row });
  assert.equal(await authenticatePortalDevice({
    pool,
    authorizedDevice: async () => null,
    deviceId: row.device_id,
    activationCode: '123456',
    req: {}
  }), null);
});

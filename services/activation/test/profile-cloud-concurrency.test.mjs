import assert from 'node:assert/strict';
import test from 'node:test';
import { createActivationCredentialCodec } from '../src/auth-protection.mjs';
import { devicePool, loadHooks } from './helpers/hook-harness.mjs';

const key = 'ef'.repeat(32);
const env = { DATABASE_URL: 'fixture', BLOFY_PLAYLIST_ENCRYPTION_KEY: key };
const codec = createActivationCredentialCodec(key);

test('two initial cloud writes with revision zero cannot both succeed', async () => {
  const deviceId = 'BLOFY-CLOUD-CONCURRENT';
  const row = { device_id: deviceId, activation_code: codec.proof(deviceId, '123456'), status: 'active' };
  let snapshot = null;
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      let releaseLock;
      return {
        async query(sql, values = []) {
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'COMMIT' || sql === 'ROLLBACK') { releaseLock?.(); releaseLock = null; return { rows: [] }; }
          if (sql.startsWith('SELECT * FROM devices')) return { rows: [{ ...row }] };
          if (sql.startsWith('SELECT device_id FROM devices')) {
            const previous = tail;
            tail = new Promise((resolve) => { releaseLock = resolve; });
            await previous;
            return { rows: [{ device_id: deviceId }] };
          }
          if (sql.includes('SELECT revision FROM profile_cloud_snapshots')) {
            const result = snapshot ? [{ revision: snapshot.revision }] : [];
            await new Promise((resolve) => setImmediate(resolve));
            return { rows: result };
          }
          if (sql.includes('INSERT INTO profile_cloud_snapshots')) {
            snapshot = { revision: values[2], payload: JSON.parse(values[3]) };
            return { rows: [] };
          }
          throw new Error(`Unexpected fixture query: ${sql}`);
        },
        release() { releaseLock?.(); }
      };
    }
  };
  const hooks = await loadHooks(['profile-cloud-hook.mjs'], { env, pool });
  const write = (title) => hooks.request('/api/v1/cloud/profile', { method: 'PUT', body: {
    deviceId, activationCode: '123456', profileId: 'default', expectedRevision: 0, payload: { watchlist: [title] }
  } });
  const responses = await Promise.all([write('first'), write('second')]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(snapshot.revision, 1);
  const winning = JSON.parse(responses.find((r) => r.status === 200).body);
  assert.deepEqual(snapshot.payload, winning.payload);
});

test('cloud GET supports header credentials with precedence and legacy URL credentials', async () => {
  const deviceId = 'BLOFY-CLOUD-HEADERS';
  const row = { device_id: deviceId, activation_code: codec.proof(deviceId, '123456'), status: 'active' };
  const hooks = await loadHooks(['profile-cloud-hook.mjs'], { env, pool: devicePool(row) });
  const modern = await hooks.request('/api/v1/cloud/profile?profileId=default', { headers: {
    'x-blofy-device-id': deviceId, 'x-blofy-activation-code': '123456'
  } });
  assert.equal(modern.status, 200);
  const legacy = await hooks.request(`/api/v1/cloud/profile?profileId=default&deviceId=${deviceId}&activationCode=123456`);
  assert.equal(legacy.status, 200);
  const precedence = await hooks.request(`/api/v1/cloud/profile?profileId=default&deviceId=${deviceId}&activationCode=000000`, { headers: {
    'x-blofy-device-id': deviceId, 'x-blofy-activation-code': '123456'
  } });
  assert.equal(precedence.status, 200);
  assert.equal(row.auth_failed_attempts, undefined);
});

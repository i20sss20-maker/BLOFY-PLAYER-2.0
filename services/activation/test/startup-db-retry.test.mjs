import test from 'node:test';
import assert from 'node:assert/strict';
import { isTransientDatabaseStartError, withDatabaseStartRetry } from '../src/startup-db-retry.mjs';

const failure = (code) => Object.assign(new Error('internal unavailable'), { code });

test('retry transient Railway DNS until Postgres becomes reachable; keep original result', async () => {
  let attempts = 0;
  const delays = [];
  const notifications = [];
  const result = await withDatabaseStartRetry(async () => {
    if (++attempts < 4) throw failure('ENOTFOUND');
    return 'database-ready';
  }, {
    attempts: 7,
    wait: ms => { delays.push(ms); },
    notify: (n, code) => notifications.push({ n, code })
  });
  assert.equal(result, 'database-ready');
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
  assert.equal(notifications.length, 3);
});

test('transient Postgres startup and network codes are retried', async () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT',
      'ENETUNREACH', 'EHOSTUNREACH', '57P03']) {
    assert.equal(isTransientDatabaseStartError(failure(code)), true, code);
  }
  assert.equal(isTransientDatabaseStartError(new Error('wrapper', { cause: failure('EAI_AGAIN') })), true);
});

test('configuration, SQL permission, auth, and TLS errors fail without retries', async () => {
  for (const code of ['28P01', '42501', '42P01', 'SELF_SIGNED_CERT_IN_CHAIN', 'ENOTFOUND_EVIL']) {
    const e = failure(code);
    let n = 0;
    await assert.rejects(
      withDatabaseStartRetry(async () => { ++n; throw e; }, { wait: () => { throw new Error('unexpected retry'); } }),
      error => error === e
    );
    assert.equal(n, 1);
  }
});

test('exhausted DNS retries surface failure, never fake database ready', async () => {
  let n = 0;
  const delays = [];
  await assert.rejects(
    withDatabaseStartRetry(async () => { ++n; throw failure('ENOTFOUND'); }, {
      attempts: 3,
      wait: ms => { delays.push(ms); },
      notify: () => {}
    }), { code: 'ENOTFOUND' }
  );
  assert.equal(n, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test('bad retry policy fails safely', async () => {
  await assert.rejects(withDatabaseStartRetry(null), /invalid_startup_retry_configuration/);
  await assert.rejects(withDatabaseStartRetry(async () => true, { attempts: 20 }), /invalid_startup_retry_configuration/);
});

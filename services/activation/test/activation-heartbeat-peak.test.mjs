import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('activation verification remains per-request, while writes of last_seen are throttled to one per minute',async()=>{
  const code=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
  const start=code.indexOf('async function activationCheck(req, res)');
  const end=code.indexOf('async function activationRotate(req, res)',start);
  assert.ok(start>0&&end>start);
  const section=code.slice(start,end);
  assert.match(section,/consumeDeviceAuthAttempt\(req, deviceId\)/);
  assert.match(section,/verifyDeviceCredential\(client, row, activationCode\)/);
  assert.match(section,/await bindExistingTrial\(client, row/);
  assert.match(section,/await completePendingTrial\(client, row/);
  assert.match(section,/const status = normalizeStatus\(row\)/);
  assert.match(section,/last_seen_at IS NULL/);
  assert.match(section,/last_seen_at <= NOW\(\)-INTERVAL '60 seconds'/);
  assert.match(section,/last_app_version IS DISTINCT FROM \$2/);
  assert.match(section,/last_platform IS DISTINCT FROM \$3/);
  assert.match(section,/WHERE device_id=\$1 AND \(/);
  assert.match(section,/await client\.query\('COMMIT'\)/);
  assert.ok(section.indexOf('verifyDeviceCredential')<
    section.indexOf('last_seen_at IS NULL'),'authorization must happen before heartbeat');
  assert.ok(section.indexOf('const status = normalizeStatus')<
    section.indexOf('last_seen_at IS NULL'),'expiry still calculated on every check');
  assert.doesNotMatch(section,/setInterval|setTimeout|localStorage/);
});

test('device heartbeat SQL preserves the previous device identity and app data arguments',async()=>{
  const code=await readFile(new URL('../src/server.mjs',import.meta.url),'utf8');
  assert.match(code,/SET last_seen_at=NOW\(\), last_app_version=\$2, last_platform=\$3/);
  assert.match(code,/\[deviceId, appVersion, platform\]/);
  assert.match(code,/last_seen_at IS NULL OR last_seen_at <= NOW\(\)-INTERVAL '60 seconds'/);
  // This test intentionally does not connect to live customer data or
  // assume an activation frequency, and cannot prove load capacity.
});

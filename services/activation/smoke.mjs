import assert from 'node:assert/strict';

const base = String(process.env.BLOFY_SMOKE_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const adminToken = String(process.env.BLOFY_ADMIN_TOKEN || '');
const deviceId = 'BLOFY-QA12-AB34';
const activationCode = '482731';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { response, body };
}

const health = await request('/health');
assert.equal(health.response.status, 200);
assert.equal(health.body?.ok, true);
assert.equal(health.body?.release?.service, 'blofy-activation');
assert.match(String(health.body?.release?.version || ''), /^[0-9A-Za-z._-]{1,64}$/);
assert.ok(['vercel', 'self-hosted'].includes(health.body?.release?.platform));
const expectedReleaseCommit = String(process.env.BLOFY_RELEASE_COMMIT_SHA || '').trim().toLowerCase();
if (expectedReleaseCommit) assert.equal(health.body?.release?.commitSha, expectedReleaseCommit);

const trial = await request('/api/v1/activation/check', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ deviceId, activationCode, appVersion: 'smoke', platform: 'ci' })
});
assert.equal(trial.response.status, 200);
assert.ok(['trial', 'active'].includes(trial.body?.status));
assert.ok(Number(trial.body?.serverTime) > 0);

const wrongCode = await request('/api/v1/activation/check', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ deviceId, activationCode: '000000', appVersion: 'smoke', platform: 'ci' })
});
assert.equal(wrongCode.response.status, 403);
assert.equal(wrongCode.body?.status, 'blocked');

const lockDeviceId = 'BLOFY-LOCK-QA01';
const lockCode = '593841';
const lockRegistered = await request('/api/v1/activation/check', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ deviceId: lockDeviceId, activationCode: lockCode, appVersion: 'smoke', platform: 'ci' })
});
assert.equal(lockRegistered.response.status, 200);
for (let attempt = 0; attempt < 5; attempt += 1) {
  const failed = await request('/api/v1/activation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      deviceId: lockDeviceId,
      activationCode: String(100_000 + attempt),
      appVersion: 'smoke',
      platform: 'ci'
    })
  });
  assert.equal(failed.response.status, 403);
}
const lockedCorrectCode = await request('/api/v1/activation/check', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ deviceId: lockDeviceId, activationCode: lockCode, appVersion: 'smoke', platform: 'ci' })
});
assert.equal(lockedCorrectCode.response.status, 403);
assert.equal(lockedCorrectCode.body?.message, 'unauthorized_device');

if (adminToken) {
  const block = await request(`/api/v1/admin/devices/${encodeURIComponent(deviceId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'blocked' })
  });
  assert.equal(block.response.status, 200);
  assert.equal(block.body?.status, 'blocked');

  const blocked = await request('/api/v1/activation/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, activationCode, appVersion: 'smoke', platform: 'ci' })
  });
  assert.equal(blocked.response.status, 200);
  assert.equal(blocked.body?.status, 'blocked');
}

console.log('BLOFY activation smoke checks passed');

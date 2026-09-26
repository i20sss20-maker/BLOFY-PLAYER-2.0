import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const baseUrl = String(process.env.BLOFY_E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
const deviceId = `BLOFY-E2E-${suffix}`;
const activationCode = String(crypto.randomInt(100_000, 1_000_000));
let rotatedActivationCode = String(crypto.randomInt(100_000, 1_000_000));
while (rotatedActivationCode === activationCode) {
  rotatedActivationCode = String(crypto.randomInt(100_000, 1_000_000));
}
const playlistId = crypto.randomUUID();
const stableDeviceId = `BLOFY-${suffix.slice(0, 4)}-${suffix.slice(4, 8)}`;
let stableActivationCode = String(crypto.randomInt(100_000, 1_000_000));
while (stableActivationCode === rotatedActivationCode) {
  stableActivationCode = String(crypto.randomInt(100_000, 1_000_000));
}

async function request(path, { method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await response.text();
  let json = null;
  const contentType = response.headers.get('content-type') || '';
  if (text && /^application\/json\b/i.test(contentType)) {
    try {
      json = JSON.parse(text);
    } catch {
      assert.fail(`${method} ${path} returned non-JSON: ${text.slice(0, 200)}`);
    }
  }
  return { response, json, text };
}

function assertNumberOrNull(value, field) {
  assert.ok(value === null || Number.isFinite(value), `${field} must be a number or null`);
}

const portal = await request('/portal', { method: 'GET' });
assert.equal(portal.response.status, 200);
assert.match(portal.response.headers.get('content-type') || '', /^text\/html\b/);
assert.match(portal.text, /\/api\/v1\/portal\/playlists\/list/);

let identity = { deviceId, activationCode };

const beforeActivation = await request('/api/v1/portal/playlists/list', { body: identity });
assert.equal(beforeActivation.response.status, 403);
assert.deepEqual(beforeActivation.json, { error: 'unauthorized_device' });

const activation = await request('/api/v1/activation/check', {
  body: { ...identity, appVersion: 'e2e-contract', platform: 'ci' }
});
assert.equal(activation.response.status, 200);
assert.ok(['trial', 'active'].includes(activation.json?.status));
assertNumberOrNull(activation.json?.expiresAt, 'expiresAt');
assert.ok(Number.isFinite(activation.json?.serverTime));

const rotated = await request('/api/v1/activation/rotate', {
  body: { deviceId, currentActivationCode: activationCode, newActivationCode: rotatedActivationCode }
});
assert.equal(rotated.response.status, 200);
assert.deepEqual(rotated.json, { rotated: true });

// Retrying the exact tuple is safe when the first successful response was lost.
const retriedRotation = await request('/api/v1/activation/rotate', {
  body: { deviceId, currentActivationCode: activationCode, newActivationCode: rotatedActivationCode }
});
assert.equal(retriedRotation.response.status, 200);
assert.deepEqual(retriedRotation.json, { rotated: true });

const oldCode = await request('/api/v1/portal/playlists/list', { body: identity });
assert.equal(oldCode.response.status, 403);
identity = { deviceId, activationCode: rotatedActivationCode };

const saved = await request('/api/v1/portal/playlists', {
  body: {
    ...identity,
    id: playlistId,
    name: 'E2E Android Sync',
    providerType: 'xtream',
    baseUrl: 'https://provider.example.test',
    username: 'e2e-user',
    password: 'e2e-password',
    active: true
  }
});
assert.equal(saved.response.status, 200);
assert.equal(saved.json?.id, playlistId);
assert.equal(saved.json?.active, true);
assert.ok(Number.isInteger(saved.json?.revision) && saved.json.revision >= 1);
assert.ok(Number.isFinite(saved.json?.updatedAt));

// Upgrading an existing install binds a deterministic reinstall alias but keeps the
// original canonical BLOFY device ID and all device-owned data exactly where it is.
const aliasBound = await request('/api/v1/device/identity/migrate', {
  body: {
    deviceId: identity.deviceId,
    activationCode: identity.activationCode,
    targetDeviceId: stableDeviceId,
    targetActivationCode: stableActivationCode
  }
});
assert.equal(aliasBound.response.status, 200);
assert.equal(aliasBound.json?.migrated, false);
assert.equal(aliasBound.json?.aliasBound, true);
assert.equal(aliasBound.json?.deviceId, deviceId);

// A lost response is safe: rebinding the same alias to the same canonical device is idempotent.
const aliasRetry = await request('/api/v1/device/identity/migrate', {
  body: {
    deviceId: identity.deviceId,
    activationCode: identity.activationCode,
    targetDeviceId: stableDeviceId,
    targetActivationCode: stableActivationCode
  }
});
assert.equal(aliasRetry.response.status, 200);
assert.equal(aliasRetry.json?.aliasBound, true);

// The old installation still works and still owns its playlist after the update.
const beforeReinstall = await request('/api/v1/portal/playlists/list', { body: identity });
assert.equal(beforeReinstall.response.status, 200);
assert.ok(beforeReinstall.json?.items?.some((item) => item.id === playlistId));

// Simulate a clean reinstall on the same Android identity. The stable alias resolves back to the
// canonical old device and rotates that canonical credential to the recovered six-digit code.
const recovered = await request('/api/v1/activation/check', {
  body: {
    deviceId: stableDeviceId,
    activationCode: stableActivationCode,
    appVersion: 'e2e-reinstall',
    platform: 'ci'
  }
});
assert.equal(recovered.response.status, 200);
assert.equal(recovered.json?.recovered, true);
assert.equal(recovered.json?.canonicalDeviceId, deviceId);
identity = { deviceId, activationCode: stableActivationCode };

// This is the exact endpoint and response shape consumed by PortalPlaylistClient.fetchRemote().
const sync = await request('/api/v1/portal/playlists/list', { body: identity });
assert.equal(sync.response.status, 200);
assert.ok(Array.isArray(sync.json?.items));
const playlist = sync.json.items.find((item) => item.id === playlistId);
assert.deepEqual(
  {
    id: playlist?.id,
    name: playlist?.name,
    providerType: playlist?.providerType,
    baseUrl: playlist?.baseUrl,
    username: playlist?.username,
    password: playlist?.password,
    active: playlist?.active
  },
  {
    id: playlistId,
    name: 'E2E Android Sync',
    providerType: 'xtream',
    baseUrl: 'https://provider.example.test',
    username: 'e2e-user',
    password: 'e2e-password',
    active: true
  }
);
assert.ok(Number.isFinite(playlist?.updatedAt));

const removed = await request(`/api/v1/portal/playlists/${encodeURIComponent(playlistId)}`, {
  method: 'DELETE',
  body: identity
});
assert.equal(removed.response.status, 200);
assert.equal(removed.json?.deleted, true);
assert.ok(Array.isArray(removed.json?.deletedIds));
assert.ok(removed.json.deletedIds.includes(playlistId));

// A subsequent pull must not resurrect the remotely deleted playlist.
const afterDelete = await request('/api/v1/portal/playlists/list', { body: identity });
assert.equal(afterDelete.response.status, 200);
assert.ok(!afterDelete.json?.items?.some((item) => item.id === playlistId));

console.log('BLOFY portal -> activation -> Android playlist sync E2E contract passed');

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const baseUrl = String(process.env.BLOFY_E2E_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const suffix = crypto.randomBytes(6).toString('hex').toUpperCase();
const deviceId = `BLOFY-E2E-${suffix}`;
const activationCode = String(crypto.randomInt(100_000, 1_000_000));
const trialScope = crypto.randomBytes(32).toString('hex');
let rotatedActivationCode = String(crypto.randomInt(100_000, 1_000_000));
while (rotatedActivationCode === activationCode) {
  rotatedActivationCode = String(crypto.randomInt(100_000, 1_000_000));
}
const playlistId = crypto.randomUUID();

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

const databaseUrl = String(process.env.DATABASE_URL || '');
const db = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, ssl: false }) : null;

try {
  const portal = await request('/portal', { method: 'GET' });
  assert.equal(portal.response.status, 200);
  assert.match(portal.response.headers.get('content-type') || '', /^text\/html\b/);
  assert.match(portal.text, /\/api\/v1\/portal\/playlists\/list/);
  assert.match(portal.text, /\/api\/v1\/portal\/contact\/status/);

  let identity = { deviceId, activationCode };

  // The web portal may be used as soon as the app shows its locally generated Device ID + PIN.
  // This creates only a pending proof row; it must not grant any trial/paid entitlement.
  const beforeActivation = await request('/api/v1/portal/playlists/list', { body: identity });
  assert.equal(beforeActivation.response.status, 200);
  assert.deepEqual(beforeActivation.json?.items, []);

  if (db) {
    const pending = (await db.query(
      `SELECT status,trial_started_at,expires_at,trial_registration_pending,last_platform,last_app_version
       FROM devices WHERE device_id=$1`,
      [deviceId]
    )).rows[0];
    assert.ok(pending, 'portal pairing must create a pending device row');
    assert.equal(pending.status, 'expired');
    assert.equal(pending.trial_registration_pending, true);
    assert.equal(pending.trial_started_at, null);
    assert.equal(pending.last_platform, 'web');
    assert.equal(pending.last_app_version, 'web-portal');
    assert.ok(new Date(pending.expires_at).getTime() <= Date.now() + 5_000, 'pending web pairing must not grant future entitlement');
  }

  // Contact collection belongs to the same authenticated device and must work while pairing is
  // pending, without granting a trial. The browser receives only a masked copy after save.
  const contactBefore = await request('/api/v1/portal/contact/status', { body: identity });
  assert.equal(contactBefore.response.status, 200);
  assert.equal(contactBefore.json?.hasPhone, false);
  assert.equal(contactBefore.json?.maskedPhone, '');

  const badContact = await request('/api/v1/portal/contact/status', {
    body: { deviceId, activationCode: activationCode === '000000' ? '999999' : '000000' }
  });
  assert.equal(badContact.response.status, 403);

  const contactSave = await request('/api/v1/portal/contact', {
    body: { ...identity, phone: '٠٥٥١٢٣٤٥٦٧' }
  });
  assert.equal(contactSave.response.status, 200);
  assert.equal(contactSave.json?.ok, true);
  assert.equal(contactSave.json?.maskedPhone, '+966••••4567');

  const contactAfter = await request('/api/v1/portal/contact/status', { body: identity });
  assert.equal(contactAfter.response.status, 200);
  assert.equal(contactAfter.json?.hasPhone, true);
  assert.equal(contactAfter.json?.maskedPhone, '+966••••4567');

  if (db) {
    const customer = (await db.query('SELECT customer_phone FROM device_customers WHERE device_id=$1', [deviceId])).rows[0];
    assert.equal(customer?.customer_phone, '+966551234567');
    const stillPending = (await db.query('SELECT status,trial_registration_pending FROM devices WHERE device_id=$1', [deviceId])).rows[0];
    assert.equal(stillPending.status, 'expired');
    assert.equal(stillPending.trial_registration_pending, true);
  }

  // Playlist management must already work while registration is pending so a customer can pair
  // through the website before Android performs its first server activation check.
  const savedPending = await request('/api/v1/portal/playlists', {
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
  assert.equal(savedPending.response.status, 200);
  assert.equal(savedPending.json?.id, playlistId);
  assert.equal(savedPending.json?.active, true);

  // Polling without the Android-scoped trial identity must not turn a pending web record into a
  // free trial, even in CI where legacy first-registration compatibility is enabled.
  const noScope = await request('/api/v1/activation/check', {
    body: { ...identity, appVersion: 'e2e-contract', platform: 'android' }
  });
  assert.equal(noScope.response.status, 200);
  assert.equal(noScope.json?.status, 'expired');

  // The real Android call supplies trialScope. It binds or reuses the scope clock and completes
  // the same pending row rather than creating another device or losing website data.
  const activation = await request('/api/v1/activation/check', {
    body: { ...identity, appVersion: 'e2e-contract', platform: 'android', trialScope }
  });
  assert.equal(activation.response.status, 200);
  assert.equal(activation.json?.status, 'trial');
  assertNumberOrNull(activation.json?.expiresAt, 'expiresAt');
  assert.ok(Number.isFinite(activation.json?.expiresAt) && activation.json.expiresAt > Date.now());
  assert.ok(Number.isFinite(activation.json?.serverTime));

  if (db) {
    const completed = (await db.query(
      'SELECT status,trial_started_at,expires_at,trial_registration_pending,last_platform FROM devices WHERE device_id=$1',
      [deviceId]
    )).rows[0];
    assert.equal(completed.status, 'trial');
    assert.equal(completed.trial_registration_pending, false);
    assert.ok(completed.trial_started_at);
    assert.ok(new Date(completed.expires_at).getTime() > Date.now());
    assert.equal(completed.last_platform, 'android');
    const customer = (await db.query('SELECT customer_phone FROM device_customers WHERE device_id=$1', [deviceId])).rows[0];
    assert.equal(customer?.customer_phone, '+966551234567');
  }

  // This is the exact endpoint and response shape consumed by PortalPlaylistClient.fetchRemote().
  const syncBeforeRotation = await request('/api/v1/portal/playlists/list', { body: identity });
  assert.equal(syncBeforeRotation.response.status, 200);
  assert.ok(Array.isArray(syncBeforeRotation.json?.items));
  const playlist = syncBeforeRotation.json.items.find((item) => item.id === playlistId);
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
  const oldContact = await request('/api/v1/portal/contact/status', { body: identity });
  assert.equal(oldContact.response.status, 403);
  identity = { deviceId, activationCode: rotatedActivationCode };

  const sync = await request('/api/v1/portal/playlists/list', { body: identity });
  assert.equal(sync.response.status, 200);
  assert.deepEqual(sync.json.items.find(item => item.id === playlistId), playlist);
  const rotatedContact = await request('/api/v1/portal/contact/status', { body: identity });
  assert.equal(rotatedContact.response.status, 200);
  assert.equal(rotatedContact.json?.maskedPhone, '+966••••4567');

  // A valid second device must never receive or change the first device's playlist,
  // including when a client reuses a deterministic playlist UUID.
  const otherIdentity = { deviceId: `BLOFY-E2E-OTHER-${suffix}`, activationCode: String(crypto.randomInt(100_000, 1_000_000)) };
  const otherActivation = await request('/api/v1/activation/check', {
    body: { ...otherIdentity, appVersion: 'e2e-contract', platform: 'ci', trialScope: crypto.randomBytes(32).toString('hex') }
  });
  assert.equal(otherActivation.response.status, 200);
  const otherList = await request('/api/v1/portal/playlists/list', { body: otherIdentity });
  assert.equal(otherList.response.status, 200);
  assert.deepEqual(otherList.json.items, []);
  const otherContact = await request('/api/v1/portal/contact/status', { body: otherIdentity });
  assert.equal(otherContact.response.status, 200);
  assert.equal(otherContact.json?.hasPhone, false);
  const crossDeviceSave = await request('/api/v1/portal/playlists', { body: {
    ...otherIdentity, id: playlistId, name: 'Must not replace', providerType: 'xtream',
    baseUrl: 'https://provider.example.test', username: 'other-user', password: 'other-password', active: true
  } });
  assert.equal(crossDeviceSave.response.status, 404);
  const crossDeviceDelete = await request(`/api/v1/portal/playlists/${playlistId}`, { method: 'DELETE', body: otherIdentity });
  assert.equal(crossDeviceDelete.response.status, 404);
  const unchanged = await request('/api/v1/portal/playlists/list', { body: identity });
  assert.deepEqual(unchanged.json.items.find(item => item.id === playlistId), playlist);

  const removed = await request(`/api/v1/portal/playlists/${encodeURIComponent(playlistId)}`, {
    method: 'DELETE',
    body: identity
  });
  assert.equal(removed.response.status, 200);
  assert.deepEqual(removed.json, { deleted: true });

  console.log('BLOFY portal pending pairing -> one-time phone -> Android activation -> playlist sync E2E contract passed');
} finally {
  await db?.end().catch(() => {});
}

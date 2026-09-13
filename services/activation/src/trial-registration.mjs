import crypto from 'node:crypto';

/** The Android-scoped digest reduces reinstall abuse; it is not remote attestation. */
export async function registerDeviceTrial(client, { deviceId, proof, appVersion, platform, trialScope, trialDays, keyHex, requireScope = true }) {
  const days = Number.isFinite(trialDays) && trialDays > 0 ? Math.min(trialDays, 30) : 7;
  const validScope = /^[a-f0-9]{64}$/.test(String(trialScope || ''));
  let startedAt = new Date(), expiresAt = new Date(Date.now() + days * 86400000);
  let status = validScope || !requireScope ? 'trial' : 'expired';
  if (status === 'expired') expiresAt = new Date();
  if (validScope) {
    const hash = crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update('blofy-trial-v1:' + trialScope).digest('hex');
    // Only the first registration starts the clock. Concurrent reinstalls share that clock.
    await client.query(`INSERT INTO device_trial_claims(scope_hash,first_device_id,expires_at)
      VALUES($1,$2,$3) ON CONFLICT(scope_hash) DO NOTHING`, [hash, deviceId, expiresAt]);
    const claim = (await client.query('SELECT started_at,expires_at FROM device_trial_claims WHERE scope_hash=$1 FOR UPDATE', [hash])).rows[0];
    startedAt = claim.started_at; expiresAt = claim.expires_at;
    status = new Date(expiresAt).getTime() > Date.now() ? 'trial' : 'expired';
  }
  return (await client.query(`INSERT INTO devices(device_id,activation_code,status,trial_started_at,expires_at,last_seen_at,last_app_version,last_platform)
    VALUES($1,$2,$3,$4,$5,NOW(),$6,$7) RETURNING *`,
  [deviceId, proof, status, validScope || !requireScope ? startedAt : null, expiresAt, appVersion, platform])).rows[0];
}

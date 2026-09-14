import crypto from 'node:crypto';

/** A QR/web request may register the ID before the app submits its trial scope. */
export async function completePendingTrial(client, row, trialScope, keyHex) {
  if (!row.trial_registration_pending || row.status !== 'expired' || row.data_deleted_at ||
      !/^[a-f0-9]{64}$/.test(String(trialScope || ''))) return row;
  const hash=crypto.createHmac('sha256',Buffer.from(keyHex,'hex')).update('blofy-trial-v1:'+trialScope).digest('hex');
  const claim=(await client.query('SELECT started_at,expires_at FROM device_trial_claims WHERE scope_hash=$1 FOR UPDATE',[hash])).rows[0];
  if (!claim) return row;
  const status=new Date(claim.expires_at).getTime()>Date.now()?'trial':'expired';
  return (await client.query(`UPDATE devices SET status=$2,trial_started_at=$3,expires_at=$4,
    trial_registration_pending=FALSE,updated_at=NOW() WHERE device_id=$1 RETURNING *`,
    [row.device_id,status,claim.started_at,claim.expires_at])).rows[0];
}

export async function bindExistingTrial(client, row, trialScope, trialDays, keyHex) {
  if (!/^[a-f0-9]{64}$/.test(String(trialScope || '')) || row.data_deleted_at) return;
  const hash=crypto.createHmac('sha256',Buffer.from(keyHex,'hex')).update('blofy-trial-v1:'+trialScope).digest('hex');
  const started=row.trial_started_at || row.created_at;
  if (!started) return;
  const days=Number.isFinite(trialDays) && trialDays>0 ? Math.min(trialDays,30) : 7;
  // Paid renewals must never become a new long free trial after reinstalling.
  const expiry=row.status==='trial' && row.expires_at ? row.expires_at : new Date(new Date(started).getTime()+days*86400000);
  await client.query(`INSERT INTO device_trial_claims(scope_hash,first_device_id,started_at,expires_at)
    VALUES($1,$2,$3,$4) ON CONFLICT(scope_hash) DO UPDATE SET
      started_at=LEAST(device_trial_claims.started_at,EXCLUDED.started_at),
      expires_at=LEAST(device_trial_claims.expires_at,EXCLUDED.expires_at)`,[hash,row.device_id,started,expiry]);
}

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
  return (await client.query(`INSERT INTO devices(device_id,activation_code,status,trial_started_at,expires_at,last_seen_at,last_app_version,last_platform,trial_registration_pending)
    VALUES($1,$2,$3,$4,$5,NOW(),$6,$7,$8) RETURNING *`,
  [deviceId, proof, status, validScope || !requireScope ? startedAt : null, expiresAt, appVersion, platform, !validScope && requireScope])).rows[0];
}

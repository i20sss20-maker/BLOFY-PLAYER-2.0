import { createActivationCredentialCodec, isAuthLocked } from './auth-protection.mjs';

const KEY_HEX = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();

export function normalizePortalDeviceId(value) {
  return String(value || '')
    .trim()
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function validPortalIdentity(deviceId, activationCode) {
  return /^BLOFY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceId) && /^\d{6}$/.test(activationCode);
}

/**
 * Portal pairing is allowed before Android submits its trial scope, but the web portal must never
 * grant an entitlement. A brand-new web pairing therefore creates only an expired/pending device
 * row holding the activation proof. The app later submits trialScope through /activation/check,
 * which upgrades the same row through completePendingTrial().
 */
export async function authenticatePortalDevice({ pool, authorizedDevice, deviceId, activationCode, req }) {
  const canonicalId = normalizePortalDeviceId(deviceId);
  const code = String(activationCode || '').trim();
  if (!validPortalIdentity(canonicalId, code)) return null;

  // Normal trial/paid devices keep the existing hardened authentication path and rate limits.
  const entitled = await authorizedDevice(canonicalId, code, req);
  if (entitled) {
    return {
      deviceId: String(entitled.device_id || canonicalId),
      activationCode: code,
      pending: false
    };
  }

  const credentials = createActivationCredentialCodec(KEY_HEX);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Coordinate with activationCheck(), which uses the same advisory-lock namespace.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`blofy-register:${canonicalId}`]);
    const result = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [canonicalId]);
    let row = result.rows[0];

    if (row) {
      const allowedPending = row.trial_registration_pending === true &&
        row.status === 'expired' &&
        !row.data_deleted_at &&
        !isAuthLocked(row) &&
        credentials.matches(row, code);
      if (!allowedPending) {
        await client.query('COMMIT');
        return null;
      }
      if (!credentials.isProof(row.activation_code)) {
        const proof = credentials.proof(canonicalId, code);
        await client.query('UPDATE devices SET activation_code=$2,updated_at=NOW() WHERE device_id=$1', [canonicalId, proof]);
        row.activation_code = proof;
      }
      await client.query('COMMIT');
      return { deviceId: canonicalId, activationCode: code, pending: true };
    }

    const proof = credentials.proof(canonicalId, code);
    row = (await client.query(
      `INSERT INTO devices(
         device_id,activation_code,status,trial_started_at,expires_at,last_seen_at,
         last_app_version,last_platform,trial_registration_pending
       ) VALUES($1,$2,'expired',NULL,NOW(),NOW(),'web-portal','web',TRUE)
       RETURNING *`,
      [canonicalId, proof]
    )).rows[0];
    await client.query('COMMIT');
    return row ? { deviceId: canonicalId, activationCode: code, pending: true } : null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

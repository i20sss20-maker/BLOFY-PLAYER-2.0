import {
  createActivationCredentialCodec, createFixedWindowLimiter, isAuthLocked,
  nextAuthFailureState, requestClientKey
} from './auth-protection.mjs';

// Session creation must enforce the same persistent PIN budget as activation and
// playlist access. An alternate login route must not become an unlimited PIN oracle.
export function createSubscriberSessionAuthorizer({ pool, keyHex, now = Date.now, env = process.env, requireActive = true }) {
  const codec = createActivationCredentialCodec(keyHex);
  const windowMs = Number(env.BLOFY_AUTH_RATE_WINDOW_MS || 60_000);
  const ips = createFixedWindowLimiter({ limit: Number(env.BLOFY_AUTH_IP_RATE_LIMIT || 60), windowMs });
  const devices = createFixedWindowLimiter({ limit: Number(env.BLOFY_AUTH_DEVICE_RATE_LIMIT || 20), windowMs });
  const denied = { allowed: false, status: 403, error: 'unauthorized_device' };
  return async function authorize(req, deviceId, pin) {
    const ip = ips.consume(requestClientKey(req), now());
    const device = devices.consume(String(deviceId).toUpperCase(), now());
    if (!ip.allowed || !device.allowed) return {
      allowed: false, status: 429, error: 'rate_limited',
      retryAfterSeconds: Math.max(ip.retryAfterSeconds, device.retryAfterSeconds)
    };
    if (!/^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) || !/^\d{6}$/.test(pin)) return denied;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId])).rows[0];
      if (!row || isAuthLocked(row, now())) { await client.query('COMMIT'); return denied; }
      if (!codec.matches(row, pin)) {
        const state = nextAuthFailureState(row, now(), {
          maxFailures: Number(env.BLOFY_AUTH_MAX_FAILURES || 5),
          failureWindowMs: Number(env.BLOFY_AUTH_FAILURE_WINDOW_MS || 900_000),
          lockMs: Number(env.BLOFY_AUTH_LOCK_MS || 900_000)
        });
        await client.query(`UPDATE devices SET auth_failed_attempts=$2,last_auth_failure_at=$3,
          auth_locked_until=$4,updated_at=NOW() WHERE device_id=$1`,
        [deviceId, state.failedAttempts, state.lastFailureAt, state.lockedUntil]);
        await client.query('COMMIT');
        return denied;
      }
      const expiry = row.expires_at == null ? null : new Date(row.expires_at).getTime();
      const allowed = !requireActive || ['trial', 'active'].includes(row.status) &&
        (expiry === null || Number.isFinite(expiry) && expiry > now());
      // A legitimate poll must not reset the wrong-PIN budget.
      await client.query('COMMIT');
      return allowed ? { allowed: true, sessionVersion: Number(row.session_version || 0) } : denied;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  };
}

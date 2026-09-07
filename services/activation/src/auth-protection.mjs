import crypto from 'node:crypto';

const DEFAULT_MAX_ENTRIES = 10_000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createActivationCredentialCodec(secretHex) {
  if (!/^[a-fA-F0-9]{64}$/.test(String(secretHex || ''))) {
    throw new Error('activation credential proof requires a 32-byte hexadecimal secret');
  }
  const proofKey = crypto
    .createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update('blofy-activation-code-proof-key:v1', 'utf8')
    .digest();

  function proof(deviceId, activationCode) {
    return `v1:${crypto
      .createHmac('sha256', proofKey)
      .update(`blofy-activation-code:v1:${deviceId}:${activationCode}`, 'utf8')
      .digest('hex')}`;
  }

  function isProof(value) {
    return /^v1:[a-f0-9]{64}$/.test(String(value || ''));
  }

  function matches(row, activationCode) {
    const stored = String(row?.activation_code || '');
    if (isProof(stored)) return constantTimeEqual(stored, proof(row?.device_id || '', activationCode));
    return /^\d{6}$/.test(stored) && constantTimeEqual(stored, activationCode);
  }

  return { proof, isProof, matches };
}

export function createFixedWindowLimiter({ limit, windowMs, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const safeLimit = positiveInteger(limit, 20);
  const safeWindowMs = positiveInteger(windowMs, 60_000);
  const safeMaxEntries = positiveInteger(maxEntries, DEFAULT_MAX_ENTRIES);
  const entries = new Map();

  function prune(nowMs) {
    if (entries.size < safeMaxEntries) return;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= nowMs) entries.delete(key);
    }
    while (entries.size >= safeMaxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  return {
    consume(rawKey, nowMs = Date.now()) {
      const key = String(rawKey || 'unknown').slice(0, 256);
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= nowMs) {
        prune(nowMs);
        entry = { count: 0, resetAt: nowMs + safeWindowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
      return {
        allowed: entry.count <= safeLimit,
        remaining: Math.max(0, safeLimit - entry.count),
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - nowMs) / 1_000))
      };
    },
    reset(rawKey) {
      entries.delete(String(rawKey || 'unknown').slice(0, 256));
    },
    size() {
      return entries.size;
    }
  };
}

export function requestClientKey(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '')
    .split(',')[0]
    .trim()
    .slice(0, 128);
  const remote = String(req?.socket?.remoteAddress || '').trim().slice(0, 128);
  return `${remote || 'unknown'}|${forwarded || 'direct'}`;
}

export function isAuthLocked(row, nowMs = Date.now()) {
  if (!row?.auth_locked_until) return false;
  const lockedUntil = new Date(row.auth_locked_until).getTime();
  return Number.isFinite(lockedUntil) && lockedUntil > nowMs;
}

export function nextAuthFailureState(
  row,
  nowMs = Date.now(),
  { maxFailures = 5, failureWindowMs = 15 * 60_000, lockMs = 15 * 60_000 } = {}
) {
  const safeMaxFailures = positiveInteger(maxFailures, 5);
  const safeFailureWindowMs = positiveInteger(failureWindowMs, 15 * 60_000);
  const safeLockMs = positiveInteger(lockMs, 15 * 60_000);
  const previousFailureAt = row?.last_auth_failure_at
    ? new Date(row.last_auth_failure_at).getTime()
    : Number.NaN;
  const withinWindow = Number.isFinite(previousFailureAt) && nowMs - previousFailureAt < safeFailureWindowMs;
  const previousFailures = withinWindow ? Math.max(0, Number(row?.auth_failed_attempts) || 0) : 0;
  const failedAttempts = previousFailures + 1;
  return {
    failedAttempts,
    lastFailureAt: new Date(nowMs),
    lockedUntil: failedAttempts >= safeMaxFailures ? new Date(nowMs + safeLockMs) : null
  };
}

export class DeviceAuthRateLimitError extends Error {
  constructor(retryAfterSeconds) {
    super('rate_limited');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const sharedIpLimiter = createFixedWindowLimiter({
  limit: process.env.BLOFY_AUTH_IP_RATE_LIMIT || 60,
  windowMs: process.env.BLOFY_AUTH_RATE_WINDOW_MS || 60_000
});
const sharedDeviceLimiter = createFixedWindowLimiter({
  limit: process.env.BLOFY_AUTH_DEVICE_RATE_LIMIT || 20,
  windowMs: process.env.BLOFY_AUTH_RATE_WINDOW_MS || 60_000
});

/** Credential-only access also serves expired devices renewing their subscription. */
export function createDeviceAuthenticator({
  pool,
  activationCredentials,
  ipLimiter = sharedIpLimiter,
  deviceLimiter = sharedDeviceLimiter,
  now = Date.now,
  maxFailures = process.env.BLOFY_AUTH_MAX_FAILURES || 5,
  failureWindowMs = process.env.BLOFY_AUTH_FAILURE_WINDOW_MS || 900_000,
  lockMs = process.env.BLOFY_AUTH_LOCK_MS || 900_000
}) {
  return async function authorizedDevice(deviceId, activationCode, req) {
    if (!pool || !activationCredentials) return null;
    const currentTime = now();
    const ipRate = ipLimiter.consume(requestClientKey(req), currentTime);
    const deviceRate = deviceLimiter.consume(String(deviceId || 'invalid').toUpperCase(), currentTime);
    if (!ipRate.allowed || !deviceRate.allowed) {
      throw new DeviceAuthRateLimitError(Math.max(ipRate.retryAfterSeconds, deviceRate.retryAfterSeconds));
    }
    if (!/^BLOFY-[A-Z0-9-]{4,32}$/i.test(deviceId) || !/^\d{6}$/.test(activationCode)) return null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT * FROM devices WHERE device_id=$1 FOR UPDATE', [deviceId]);
      const row = result.rows[0];
      if (!row || isAuthLocked(row, currentTime)) {
        await client.query('COMMIT');
        return null;
      }
      if (!activationCredentials.matches(row, activationCode)) {
        const state = nextAuthFailureState(row, currentTime, { maxFailures, failureWindowMs, lockMs });
        await client.query(
          `UPDATE devices SET auth_failed_attempts=$2,last_auth_failure_at=$3,
           auth_locked_until=$4,updated_at=NOW() WHERE device_id=$1`,
          [deviceId, state.failedAttempts, state.lastFailureAt, state.lockedUntil]
        );
        await client.query('COMMIT');
        return null;
      }
      if (!activationCredentials.isProof(row.activation_code)) {
        const proof = activationCredentials.proof(deviceId, activationCode);
        await client.query('UPDATE devices SET activation_code=$2,updated_at=NOW() WHERE device_id=$1', [deviceId, proof]);
        row.activation_code = proof;
      }
      // Routine successful polling must not reset an attacker's failure budget.
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
}

export function sendDeviceAuthRateLimit(res, error) {
  if (!(error instanceof DeviceAuthRateLimitError)) return false;
  const payload = JSON.stringify({ error: 'rate_limited' });
  res.writeHead(429, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'retry-after': String(error.retryAfterSeconds)
  });
  res.end(payload);
  return true;
}

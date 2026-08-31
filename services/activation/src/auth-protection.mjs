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

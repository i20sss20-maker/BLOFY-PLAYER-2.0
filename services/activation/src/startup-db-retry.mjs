/**
 * Railway private DNS can temporarily return ENOTFOUND while Postgres or the
 * service's private-network attachment is restarting. A rejected bootstrap
 * query must not immediately terminate every activation/API route.
 *
 * Never retry misconfiguration, invalid credentials, TLS verification errors,
 * or application-level SQL errors. This only helps short infrastructure outages.
 */
export function isTransientDatabaseStartError(error) {
  const retryable = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED',
    'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', '57P03']);
  let current = error;
  for (let i = 0; current && i < 5; i++, current = current.cause) {
    if (retryable.has(String(current.code || ''))) return true;
  }
  return false;
}

export async function withDatabaseStartRetry(operation, {
  attempts = 7,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  notify = (tryNumber, code) => console.warn(
    'BLOFY database startup connection temporarily unavailable', { tryNumber, code })
} = {}) {
  if (typeof operation !== 'function' || !Number.isInteger(attempts) || attempts < 1 || attempts > 12) {
    throw new Error('invalid_startup_retry_configuration');
  }
  for (let index = 0; index < attempts; index++) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientDatabaseStartError(error) || index + 1 === attempts) throw error;
      // Limited to 31 seconds total at default values; Railway health readiness
      // stays gated by a successful PostgreSQL connection.
      notify(index + 1, String(error.code || 'transient'));
      await wait(Math.min(1000 * (2 ** index), 8000));
    }
  }
}

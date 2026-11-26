/** Use verified TLS for every remote database. URL sslmode must not override verification. */
export function databaseOptions(connectionString, overrides = {}, env = process.env) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('invalid_database_protocol');
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  const railwayPrivate = url.hostname.endsWith('.railway.internal');
  const trustedPrivate = local || railwayPrivate;
  const disable = env.PGSSLMODE === 'disable' || url.searchParams.get('sslmode') === 'disable';
  if (disable && !trustedPrivate) throw new Error('remote_database_requires_verified_tls');
  // node-postgres merges these URL parameters over the supplied ssl object.
  for (const name of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(name);
  const ca = String(env.BLOFY_DATABASE_CA || '').trim();
  if (ca && !ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('invalid_database_ca');
  // Railway's PostgreSQL 18 container can run out of /dev/shm when a
  // parallel worker tries to resize 4–8 MB DSM blocks under concurrent
  // catalog queries. The underlying DB is healthy; a larger disk does not
  // fix /dev/shm. This is a per-session USERSET startup option and needs no
  // PostgreSQL restart or database-level ALTER SYSTEM.
  // Keep the private Railway gateway's queries sequential to avoid 502s.
  // Operators can deliberately opt out after measuring available /dev/shm.
  const constrainParallel = railwayPrivate &&
    env.BLOFY_POSTGRES_PARALLEL_GATHER_SAFE_MODE !== '0';
  if (constrainParallel) url.searchParams.delete('options');
  const safeParallel = constrainParallel ?
    {options:'-c max_parallel_workers_per_gather=0'} : {};
  return {
    max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    statement_timeout: 10000, lock_timeout: 5000, idle_in_transaction_session_timeout: 15000,
    allowExitOnIdle: true, ...safeParallel, ...overrides, connectionString: url.toString(),
    ssl: disable ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
  };
}


// node-postgres removes a broken idle client before emitting pool "error".
// Without a listener EventEmitter throws and may terminate the whole API
// during a PostgreSQL restart or failover. Never replay a write transaction:
// later requests acquire a fresh client through the existing pool.
export function observeIdleDatabaseErrors(pool, {
  clock = Date.now,
  notify = event => console.warn('BLOFY_IDLE_DATABASE_DISCONNECT', JSON.stringify(event))
} = {}) {
  const known = new Set(['57P01','57P02','57P03','08006','08003','ECONNRESET','EPIPE','ETIMEDOUT','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH']);
  let last = null, suppressed = 0;
  const listener = error => {
    const now = clock();
    if(last !== null && now >= last && now-last < 30000) {
      suppressed = Math.min(Number.MAX_SAFE_INTEGER,suppressed+1);
      return;
    }
    const code = known.has(error?.code) ? error.code : 'idle_connection_error';
    const event = {code,suppressed};
    last=now;suppressed=0;
    // A failed telemetry sink must not turn a lost idle socket into a crash.
    try { notify(event); } catch {}
  };
  pool.on('error', listener);
  return () => pool.removeListener('error', listener);
}

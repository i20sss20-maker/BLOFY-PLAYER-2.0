/** Use verified TLS for every remote database. URL sslmode must not override verification. */
export function databaseOptions(connectionString, overrides = {}, env = process.env) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('invalid_database_protocol');
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  const disable = env.PGSSLMODE === 'disable' || url.searchParams.get('sslmode') === 'disable';
  if (disable && !local) throw new Error('remote_database_requires_verified_tls');
  // node-postgres merges these URL parameters over the supplied ssl object.
  for (const name of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(name);
  const ca = String(env.BLOFY_DATABASE_CA || '').trim();
  if (ca && !ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('invalid_database_ca');
  return {
    max: 4, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
    statement_timeout: 10000, lock_timeout: 5000, idle_in_transaction_session_timeout: 15000,
    allowExitOnIdle: true, ...overrides, connectionString: url.toString(),
    ssl: disable ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
  };
}

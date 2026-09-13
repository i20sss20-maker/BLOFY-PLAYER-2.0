import crypto from 'node:crypto';
import pg from 'pg';

const WINDOW_MS = 15 * 60 * 1000;
const CLIENT_LIMIT = 12;
const ACCOUNT_LIMIT = 120;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS admin_login_limits (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS admin_login_limits_expiry ON admin_login_limits(expires_at);
CREATE TABLE IF NOT EXISTS admin_web_sessions (
  scope TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, nonce_hash)
);
CREATE INDEX IF NOT EXISTS admin_web_sessions_expiry ON admin_web_sessions(expires_at);
`;

// Limits and session revocations must survive process restarts and multiple Vercel instances.
// No in-memory authorization fallback is allowed when PostgreSQL is unavailable.
export function createAdminSessionStore({ key, pool: suppliedPool } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('admin_session_key_required');
  const digest = (purpose, value) => crypto.createHmac('sha256', key)
    .update(JSON.stringify(['blofy-admin-store-v1', purpose, value])).digest('hex');
  const scope = digest('scope', 'admin');
  let pool = suppliedPool;
  let ready;
  function database() {
    if (!pool) {
      if (!process.env.DATABASE_URL) throw new Error('admin_database_required');
      pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
        ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
        max: 2, connectionTimeoutMillis: 4000, idleTimeoutMillis: 10000,
        statement_timeout: 4000, lock_timeout: 2000, idle_in_transaction_session_timeout: 5000,
        allowExitOnIdle: true });
      pool.on('error', () => console.error('admin session database unavailable'));
    }
    return pool;
  }
  async function transaction(action) {
    const client = await database().connect();
    let failure;
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      failure = error;
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(failure); }
  }
  function ensureReady() {
    if (!ready) ready = transaction(async client => {
      // Serialize cold-start DDL across instances, including an empty database.
      await client.query('SELECT pg_advisory_xact_lock(718420642)');
      await client.query(SCHEMA);
    }).catch(error => { ready = null; throw error; });
    return ready;
  }
  async function consume(client, keyHash, limit) {
    const { rows } = await client.query(`
      INSERT INTO admin_login_limits AS current (scope,key_hash,attempts,expires_at)
      VALUES ($1,$2,1,NOW()+($4::bigint * INTERVAL '1 millisecond'))
      ON CONFLICT (scope,key_hash) DO UPDATE SET
        attempts=CASE WHEN current.expires_at<=NOW() THEN 1 ELSE LEAST(current.attempts+1,$3::integer+1) END,
        expires_at=CASE WHEN current.expires_at<=NOW() THEN EXCLUDED.expires_at ELSE current.expires_at END
      RETURNING attempts, GREATEST(1,CEIL(EXTRACT(EPOCH FROM (expires_at-clock_timestamp()))))::integer AS retry_after
    `, [scope, keyHash, limit, WINDOW_MS]);
    return { allowed: rows[0].attempts <= limit, retryAfterSeconds: rows[0].retry_after };
  }
  return {
    async consumeLogin(clientKey) {
      await ensureReady();
      return transaction(async client => {
        // The account counter is locked first everywhere. Denied accounts cannot add client rows.
        const account = await consume(client, digest('limit', 'account'), ACCOUNT_LIMIT);
        if (!account.allowed) return account;
        // Bounded cleanup must not wait on another credential scope's active transaction.
        await client.query(`DELETE FROM admin_login_limits WHERE (scope,key_hash) IN (
          SELECT scope,key_hash FROM admin_login_limits WHERE expires_at<=NOW()
          ORDER BY expires_at LIMIT 256 FOR UPDATE SKIP LOCKED)`);
        await client.query(`DELETE FROM admin_web_sessions WHERE (scope,nonce_hash) IN (
          SELECT scope,nonce_hash FROM admin_web_sessions WHERE expires_at<=NOW()
          ORDER BY expires_at LIMIT 256 FOR UPDATE SKIP LOCKED)`);
        const address = digest('client', String(clientKey || 'unknown').slice(0, 128));
        return consume(client, address, CLIENT_LIMIT);
      });
    },
    async create(nonce, expiresAt) {
      await ensureReady();
      await database().query(`INSERT INTO admin_web_sessions(scope,nonce_hash,expires_at)
        VALUES ($1,$2,to_timestamp($3::double precision/1000))`,
      [scope, digest('nonce', nonce), expiresAt]);
    },
    async active(nonce) {
      await ensureReady();
      const result = await database().query(`SELECT 1 FROM admin_web_sessions
        WHERE scope=$1 AND nonce_hash=$2 AND expires_at>NOW()`, [scope, digest('nonce', nonce)]);
      return result.rowCount === 1;
    },
    async revoke(nonce) {
      await ensureReady();
      await database().query('DELETE FROM admin_web_sessions WHERE scope=$1 AND nonce_hash=$2',
        [scope, digest('nonce', nonce)]);
    }
  };
}

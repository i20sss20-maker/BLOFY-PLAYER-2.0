import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const RECONCILE_INTERVAL_MS = Math.min(
  6 * 60 * 60 * 1000,
  Math.max(5 * 60 * 1000, Number(process.env.BLOFY_SUBSCRIPTION_RECONCILE_INTERVAL_MS || 15 * 60 * 1000) || 15 * 60 * 1000)
);
const BATCH_SIZE = 500;

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
}) : null;

/**
 * Keeps commercial entitlement state deterministic even when a device stays offline across its
 * expiry boundary. This job never changes blocked devices and never expires lifetime plans.
 */
export async function reconcileExpiredSubscriptions() {
  if (!pool) return { subscriptions: 0, devices: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const expiredSubscriptions = await client.query(
      `WITH due AS (
         SELECT id
         FROM device_subscriptions
         WHERE status='active' AND expires_at IS NOT NULL AND expires_at <= NOW()
         ORDER BY expires_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE device_subscriptions ds
       SET status='expired',updated_at=NOW()
       FROM due
       WHERE ds.id=due.id
       RETURNING ds.device_id`,
      [BATCH_SIZE]
    );

    const candidateDevices = [...new Set(expiredSubscriptions.rows.map((row) => String(row.device_id || '')).filter(Boolean))];
    let expiredDeviceCount = 0;
    if (candidateDevices.length > 0) {
      const expiredDevices = await client.query(
        `UPDATE devices d
         SET status='expired',updated_at=NOW()
         WHERE d.device_id = ANY($1::text[])
           AND d.status='active'
           AND NOT EXISTS (
             SELECT 1 FROM device_subscriptions ds
             WHERE ds.device_id=d.device_id
               AND ds.status='active'
               AND (ds.expires_at IS NULL OR ds.expires_at > NOW())
           )
         RETURNING d.device_id`,
        [candidateDevices]
      );
      expiredDeviceCount = expiredDevices.rowCount || 0;
    }

    // Defensive reconciliation for devices whose entitlement timestamp elapsed while the service
    // was down, even if the corresponding subscription row was already marked expired earlier.
    const staleDevices = await client.query(
      `WITH due AS (
         SELECT d.device_id
         FROM devices d
         WHERE d.status='active'
           AND d.expires_at IS NOT NULL
           AND d.expires_at <= NOW()
           AND NOT EXISTS (
             SELECT 1 FROM device_subscriptions ds
             WHERE ds.device_id=d.device_id
               AND ds.status='active'
               AND (ds.expires_at IS NULL OR ds.expires_at > NOW())
           )
         ORDER BY d.expires_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       UPDATE devices d
       SET status='expired',updated_at=NOW()
       FROM due
       WHERE d.device_id=due.device_id
       RETURNING d.device_id`,
      [BATCH_SIZE]
    );

    await client.query('COMMIT');
    return {
      subscriptions: expiredSubscriptions.rowCount || 0,
      devices: expiredDeviceCount + (staleDevices.rowCount || 0)
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (pool) {
  const run = () => reconcileExpiredSubscriptions().catch(() => {});
  const startup = setTimeout(run, 7_500);
  startup.unref?.();
  const timer = setInterval(run, RECONCILE_INTERVAL_MS);
  timer.unref?.();
}

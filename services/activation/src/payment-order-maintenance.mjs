import pg from 'pg';

const { Pool } = pg;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const STALE_PENDING_MS = Math.min(
  24 * 60 * 60 * 1000,
  Math.max(15 * 60 * 1000, Number(process.env.BLOFY_PAYMENT_PENDING_TTL_MS || 30 * 60 * 1000) || 30 * 60 * 1000)
);
const CLEANUP_INTERVAL_MS = Math.min(
  60 * 60 * 1000,
  Math.max(5 * 60 * 1000, Number(process.env.BLOFY_PAYMENT_CLEANUP_INTERVAL_MS || 15 * 60 * 1000) || 15 * 60 * 1000)
);
const BATCH_SIZE = 200;

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
}) : null;

/**
 * Orders reserve coupon capacity when they are created. A customer can leave before opening the
 * hosted checkout, so return/cancel handlers alone are not enough to release every reservation.
 * This bounded maintenance pass closes stale pending orders and returns coupon capacity safely.
 */
export async function cleanupStalePaymentOrders() {
  if (!pool) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stale = await client.query(
      `SELECT id
       FROM subscription_orders
       WHERE status='pending'
         AND created_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $2`,
      [STALE_PENDING_MS, BATCH_SIZE]
    );
    const ids = stale.rows.map((row) => row.id);
    if (ids.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    await client.query(
      `UPDATE subscription_orders
       SET status='cancelled',updated_at=NOW()
       WHERE id = ANY($1::uuid[]) AND status='pending'`,
      [ids]
    );

    const released = await client.query(
      `DELETE FROM coupon_redemptions
       WHERE order_id = ANY($1::uuid[])
       RETURNING code`,
      [ids]
    );
    const counts = new Map();
    for (const row of released.rows) {
      const code = String(row.code || '').trim();
      if (code) counts.set(code, (counts.get(code) || 0) + 1);
    }
    for (const [code, count] of counts) {
      await client.query(
        `UPDATE coupons
         SET redemption_count=GREATEST(0,redemption_count-$2),updated_at=NOW()
         WHERE code=$1`,
        [code, count]
      );
    }

    await client.query('COMMIT');
    return ids.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (pool) {
  const run = () => cleanupStalePaymentOrders().catch(() => {});
  const startup = setTimeout(run, 5_000);
  startup.unref?.();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}

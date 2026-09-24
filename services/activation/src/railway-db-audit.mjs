import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

const { Pool } = pg;
const TABLES = [
  'devices','provider_profiles','device_trial_claims','device_customers','device_admin_metadata',
  'device_playlists','playback_diagnostics','profile_cloud_snapshots','cloud_pair_codes',
  'license_recovery_keys','subscription_plans','subscription_orders','device_subscriptions',
  'support_tickets','device_audit','app_release_catalog','app_release_selection','app_release_audit'
];

if (process.env.RAILWAY_ENVIRONMENT && process.env.DATABASE_URL) {
  const pool = new Pool({
    ...databaseOptions(process.env.DATABASE_URL),
    max:1,
    connectionTimeoutMillis:5000,
    statement_timeout:5000,
    lock_timeout:2000,
    idle_in_transaction_session_timeout:5000,
    allowExitOnIdle:true
  });
  try {
    const counts = {};
    for (const table of TABLES) {
      try {
        const exists = (await pool.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0]?.name;
        counts[table] = exists
          ? Number((await pool.query('SELECT COUNT(*)::bigint AS count FROM public."'+table+'"')).rows[0].count)
          : null;
      } catch {
        counts[table] = null;
      }
    }
    const db = (await pool.query('SELECT current_database() AS database')).rows[0]?.database || '';
    const cryptoExists = Boolean((await pool.query("SELECT to_regclass('public.blofy_crypto_state') AS name")).rows[0]?.name);
    let cryptoState = { exists:cryptoExists, rows:0, fingerprint:'' };
    if (cryptoExists) {
      const rows = await pool.query('SELECT data_key_fingerprint FROM public.blofy_crypto_state WHERE singleton=TRUE');
      cryptoState = {
        exists:true,
        rows:rows.rowCount,
        fingerprint:String(rows.rows[0]?.data_key_fingerprint || '')
      };
    }
    console.log('BLOFY_DB_AUDIT '+JSON.stringify({database:db,counts,cryptoState}));
  } catch (error) {
    console.error('BLOFY_DB_AUDIT_ERROR '+String(error?.message || error));
  } finally {
    await pool.end().catch(()=>{});
  }
}

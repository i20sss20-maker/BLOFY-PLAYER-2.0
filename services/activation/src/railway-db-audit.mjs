import http from 'node:http';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

const { Pool } = pg;
const AUDIT_PATH = '/__internal/db-audit-0b058fb25b2858f6340df6f4ec17b69e5d8ffd11ff3f8d4f';
const TABLES = [
  'devices','provider_profiles','device_trial_claims','device_customers','device_admin_metadata',
  'device_playlists','playback_diagnostics','profile_cloud_snapshots','cloud_pair_codes',
  'license_recovery_keys','subscription_plans','subscription_orders','device_subscriptions',
  'support_tickets','device_audit','app_release_catalog','app_release_selection','app_release_audit'
];

async function collectAudit() {
  if (!process.env.DATABASE_URL) throw new Error('database_url_unavailable');
  const pool = new Pool({
    ...databaseOptions(process.env.DATABASE_URL),
    max:1, connectionTimeoutMillis:5000, statement_timeout:5000,
    lock_timeout:2000, idle_in_transaction_session_timeout:5000, allowExitOnIdle:true
  });
  try {
    const counts = {};
    for (const table of TABLES) {
      const exists = Boolean((await pool.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0]?.name);
      counts[table] = exists ? Number((await pool.query('SELECT COUNT(*)::bigint AS count FROM public."'+table+'"')).rows[0].count) : null;
    }
    const database = (await pool.query('SELECT current_database() AS database')).rows[0]?.database || '';
    const cryptoExists = Boolean((await pool.query("SELECT to_regclass('public.blofy_crypto_state') AS name")).rows[0]?.name);
    let cryptoState = { exists:cryptoExists, rows:0, fingerprint:'' };
    if (cryptoExists) {
      const rows = await pool.query('SELECT data_key_fingerprint FROM public.blofy_crypto_state WHERE singleton=TRUE');
      cryptoState = { exists:true, rows:rows.rowCount, fingerprint:String(rows.rows[0]?.data_key_fingerprint || '') };
    }
    return { platform:process.env.VERCEL==='1'?'vercel':'railway', database, counts, cryptoState };
  } finally {
    await pool.end().catch(()=>{});
  }
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withTemporaryDbAudit(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req,res)=>{
    try {
      const url = new URL(req.url || '/','http://blofy.local');
      if (req.method === 'GET' && url.pathname === AUDIT_PATH) {
        const payload = JSON.stringify(await collectAudit());
        res.writeHead(200,{
          'content-type':'application/json; charset=utf-8',
          'content-length':Buffer.byteLength(payload),
          'cache-control':'no-store',
          'x-content-type-options':'nosniff'
        });
        return res.end(payload);
      }
    } catch (error) {
      if ((req.url || '').includes(AUDIT_PATH)) {
        const payload = JSON.stringify({error:String(error?.message || error)});
        res.writeHead(503,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
        return res.end(payload);
      }
    }
    return listener(req,res);
  });
};

import crypto from 'node:crypto';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import { MIGRATION_EXPORT_PUBLIC_KEY, MIGRATION_EXPORT_EXPIRES_AT } from './migration-export-config.mjs';

const ROOT = '/api/v1/internal/migration-export';
const TABLES = [
  'devices','provider_profiles','device_trial_claims','device_customers','device_admin_metadata',
  'device_playlists','playback_diagnostics','profile_cloud_snapshots','cloud_pair_codes',
  'license_recovery_keys','subscription_plans','subscription_orders','device_subscriptions',
  'support_tickets','device_audit','app_release_catalog','app_release_selection','app_release_audit'
];
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const sourceKey = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const pool = databaseUrl ? new pg.Pool({
  ...databaseOptions(databaseUrl), max: 1, connectionTimeoutMillis: 8000,
  statement_timeout: 30000, lock_timeout: 5000, idle_in_transaction_session_timeout: 120000
}) : null;
pool?.on('error', () => console.error('migration_export_database_unavailable'));

function enabled() {
  return Boolean(pool && /^[a-fA-F0-9]{64}$/.test(sourceKey) && MIGRATION_EXPORT_PUBLIC_KEY &&
    Number(MIGRATION_EXPORT_EXPIRES_AT) > Date.now());
}
function fingerprint() {
  if (!MIGRATION_EXPORT_PUBLIC_KEY) return '';
  try {
    const der = crypto.createPublicKey(MIGRATION_EXPORT_PUBLIC_KEY).export({ type:'spki', format:'der' });
    return crypto.createHash('sha256').update(der).digest('hex');
  } catch { return ''; }
}
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(payload),
    'cache-control':'no-store',
    'x-content-type-options':'nosniff'
  });
  res.end(payload);
}
const q = value => `"${String(value).replaceAll('"','""')}"`;
async function tableExists(client, table) {
  return Boolean((await client.query('SELECT to_regclass($1) AS name',[`public.${table}`])).rows[0]?.name);
}
async function columns(client, table) {
  return (await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[table])).rows.map(row=>row.column_name);
}
async function buildBundle() {
  if (!enabled()) throw new Error('migration_export_disabled');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const identity = (await client.query('SELECT current_database() AS database')).rows[0];
    const bundle = {
      protocol:'blofy-migration-v1',
      bundleId:crypto.randomUUID(),
      generatedAt:Date.now(),
      source:{ database:identity.database },
      sourcePlaylistEncryptionKey:sourceKey,
      counts:{},
      tables:{}
    };
    for (const table of TABLES) {
      if (!await tableExists(client, table)) throw new Error(`migration_export_table_missing:${table}`);
      const names = await columns(client, table);
      if (!names.length || names.some(name=>!/^[a-z_][a-z0-9_]*$/i.test(name))) throw new Error(`migration_export_columns_invalid:${table}`);
      const rows = (await client.query(`SELECT ${names.map(q).join(',')} FROM public.${q(table)}`)).rows;
      bundle.counts[table] = rows.length;
      bundle.tables[table] = { columns:names, rows };
    }
    await client.query('ROLLBACK');
    return bundle;
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally { client.release(); }
}
function encryptBundle(bundle) {
  const plaintext = gzipSync(Buffer.from(JSON.stringify(bundle),'utf8'), { level:9 });
  const aesKey = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrappedKey = crypto.publicEncrypt({
    key:MIGRATION_EXPORT_PUBLIC_KEY,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256'
  }, aesKey);
  return {
    protocol:'blofy-migration-envelope-v1',
    fingerprint:fingerprint(),
    key:wrappedKey.toString('base64url'),
    iv:iv.toString('base64url'),
    tag:tag.toString('base64url'),
    data:ciphertext.toString('base64url')
  };
}
let cachedExport;
async function exportEnvelope() {
  if (!cachedExport) cachedExport = buildBundle().then(encryptBundle).catch(error=>{ cachedExport=null; throw error; });
  return cachedExport;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withMigrationExport(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req,res)=>{
    try {
      const url = new URL(req.url || '/','http://blofy.local');
      if (url.pathname === `${ROOT}/status` && req.method === 'GET') {
        return sendJson(res,200,{ protocol:'blofy-migration-v1', enabled:enabled(), fingerprint:fingerprint(), expiresAt:Number(MIGRATION_EXPORT_EXPIRES_AT)||0 });
      }
      if (url.pathname === ROOT) {
        if (req.method !== 'POST') return sendJson(res,405,{error:'method_not_allowed'});
        if (!enabled()) return sendJson(res,404,{error:'migration_export_disabled'});
        const envelope = await exportEnvelope();
        return sendJson(res,200,envelope);
      }
    } catch (error) {
      console.error(`migration_export_failed:${String(error?.message || 'unknown').slice(0,160)}`);
      return sendJson(res,503,{error:'migration_export_unavailable'});
    }
    return listener(req,res);
  });
};

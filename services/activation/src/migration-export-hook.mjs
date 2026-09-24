import crypto from 'node:crypto';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

const ROOT = '/api/v1/internal/migration-export';
const WINDOW_URL = String(process.env.BLOFY_MIGRATION_EXPORT_WINDOW_URL ||
  'https://raw.githubusercontent.com/i20sss20-maker/BLOFY-PLAYER-2.0/main/ops/blofy-migration-export-window.json').trim();
const VERCEL_RUNTIME = process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production';
const TABLES = [
  'devices','provider_profiles','device_trial_claims','device_customers','device_admin_metadata',
  'device_playlists','playback_diagnostics','profile_cloud_snapshots','cloud_pair_codes',
  'license_recovery_keys','subscription_plans','subscription_orders','device_subscriptions',
  'support_tickets','device_audit','app_release_catalog','app_release_selection','app_release_audit'
];
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const sourceKey = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const sourceSubscriberHost = String(process.env.BLOFY_SUBSCRIBER_HOST || '').trim();
const pool = databaseUrl ? new pg.Pool({
  ...databaseOptions(databaseUrl), max: 1, connectionTimeoutMillis: 8000,
  statement_timeout: 30000, lock_timeout: 5000, idle_in_transaction_session_timeout: 120000
}) : null;
pool?.on('error', () => console.error('migration_export_database_unavailable'));

function publicKeyFingerprint(publicKeyPem) {
  if (!publicKeyPem) return '';
  try {
    const der = crypto.createPublicKey(publicKeyPem).export({ type:'spki', format:'der' });
    return crypto.createHash('sha256').update(der).digest('hex');
  } catch { return ''; }
}
function validSubscriberHost(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
async function exportWindow({ requireMigrationContext = true } = {}) {
  // Both export paths are source-only. Full database migration additionally
  // requires the source database and production data key. The subscriber-host
  // transfer does not need either secret and must not be coupled to their shape.
  if (!VERCEL_RUNTIME) return null;
  if (requireMigrationContext && (!pool || !/^[a-fA-F0-9]{64}$/.test(sourceKey))) return null;
  let parsed;
  try {
    const url = new URL(WINDOW_URL);
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com') return null;
    url.searchParams.set('blofyMigrationWindow', String(Date.now()));
    const response = await fetch(url, {
      redirect:'error', cache:'no-store', signal:AbortSignal.timeout(8000),
      headers:{accept:'application/json','cache-control':'no-cache'}
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (Buffer.byteLength(text) > 16_384) return null;
    parsed = JSON.parse(text);
  } catch { return null; }
  const publicKeyPem = typeof parsed?.publicKeyPem === 'string' ? parsed.publicKeyPem.trim() : '';
  const expiresAt = Number(parsed?.expiresAt || 0);
  const fingerprint = publicKeyFingerprint(publicKeyPem);
  // A committed window is deliberately short. A stale or far-future file fails closed.
  if (!fingerprint || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now()+30*60*1000) return null;
  return { publicKeyPem, expiresAt, fingerprint };
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
function buildSubscriberHostBundle() {
  if (!validSubscriberHost(sourceSubscriberHost)) throw new Error('subscriber_host_invalid');
  return {
    protocol:'blofy-subscriber-host-v1',
    generatedAt:Date.now(),
    subscriberHost:sourceSubscriberHost
  };
}
function encryptBundle(bundle, window) {
  const plaintext = gzipSync(Buffer.from(JSON.stringify(bundle),'utf8'), { level:9 });
  const aesKey = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrappedKey = crypto.publicEncrypt({
    key:window.publicKeyPem,
    padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash:'sha256'
  }, aesKey);
  return {
    protocol:'blofy-migration-envelope-v1',
    fingerprint:window.fingerprint,
    key:wrappedKey.toString('base64url'),
    iv:iv.toString('base64url'),
    tag:tag.toString('base64url'),
    data:ciphertext.toString('base64url')
  };
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withMigrationExport(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req,res)=>{
    try {
      const url = new URL(req.url || '/','http://blofy.local');
      if (url.pathname === `${ROOT}/status` && req.method === 'GET') {
        const window = await exportWindow();
        return sendJson(res,200,{ protocol:'blofy-migration-v1', enabled:Boolean(window),
          fingerprint:window?.fingerprint || '', expiresAt:window?.expiresAt || 0,
          source:VERCEL_RUNTIME?'github-main-runtime-window':'not-production-vercel-runtime' });
      }
      if (url.pathname === `${ROOT}/subscriber-host/status` && req.method === 'GET') {
        const window = await exportWindow({ requireMigrationContext:false });
        return sendJson(res,200,{ protocol:'blofy-subscriber-host-v1', supported:true,
          enabled:Boolean(window), hostConfigured:validSubscriberHost(sourceSubscriberHost),
          fingerprint:window?.fingerprint || '', expiresAt:window?.expiresAt || 0,
          source:VERCEL_RUNTIME?'production-vercel-runtime':'not-production-vercel-runtime' });
      }
      if (url.pathname === `${ROOT}/subscriber-host`) {
        if (req.method !== 'POST') return sendJson(res,405,{error:'method_not_allowed'});
        const window = await exportWindow({ requireMigrationContext:false });
        if (!window) return sendJson(res,404,{error:'migration_export_disabled'});
        if (!validSubscriberHost(sourceSubscriberHost)) return sendJson(res,503,{error:'subscriber_host_unavailable'});
        return sendJson(res,200,encryptBundle(buildSubscriberHostBundle(), window));
      }
      if (url.pathname === `${ROOT}/pull` && req.method === 'GET') {
        const window = await exportWindow();
        if (!window) return sendJson(res,404,{error:'migration_export_disabled'});
        return sendJson(res,200,encryptBundle(await buildBundle(), window));
      }
      if (url.pathname === ROOT) {
        if (req.method !== 'POST') return sendJson(res,405,{error:'method_not_allowed'});
        const window = await exportWindow();
        if (!window) return sendJson(res,404,{error:'migration_export_disabled'});
        const envelope = encryptBundle(await buildBundle(), window);
        return sendJson(res,200,envelope);
      }
    } catch (error) {
      console.error(`migration_export_failed:${String(error?.message || 'unknown').slice(0,160)}`);
      return sendJson(res,503,{error:'migration_export_unavailable'});
    }
    return listener(req,res);
  });
};

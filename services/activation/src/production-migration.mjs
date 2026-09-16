import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import { ADMIN_CONSOLE_SCHEMA } from './admin-console-schema.mjs';
import { DEVICE_ADMIN_SCHEMA } from './device-admin.mjs';
import { persistDataKey, wrappingKeyFromEnv } from './data-key-state.mjs';

const APPLY_PHRASE = 'YES_COPY_BLOFY_PRODUCTION_TO_AZURE';
const sourceUrl = String(process.env.SOURCE_DATABASE_URL || '').trim();
const targetUrl = String(process.env.DATABASE_URL || '').trim();
const apply = process.env.BLOFY_MIGRATION_APPLY === APPLY_PHRASE;

if (!sourceUrl || !targetUrl) throw new Error('migration_database_urls_required');
if (sourceUrl === targetUrl) throw new Error('migration_source_equals_target');

const sourceKey = String(process.env.SOURCE_BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const targetKey = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
if (!/^[a-fA-F0-9]{64}$/.test(sourceKey)) throw new Error('migration_source_key_invalid');
if (!/^[a-fA-F0-9]{64}$/.test(targetKey)) throw new Error('migration_target_key_invalid');
const keyDigest = value => crypto.createHash('sha256').update(Buffer.from(value,'hex')).digest();
const keyCompatible = crypto.timingSafeEqual(keyDigest(sourceKey), keyDigest(targetKey));
const keyMigrationMode = keyCompatible ? 'same-data-key' : 'wrap-source-data-key';

const CORE_TABLES = [
  'devices',
  'provider_profiles',
  'device_trial_claims',
  'device_customers',
  'device_admin_metadata',
  'device_playlists',
  'playback_diagnostics',
  'profile_cloud_snapshots',
  'cloud_pair_codes',
  'license_recovery_keys',
  'subscription_plans',
  'subscription_orders',
  'device_subscriptions',
  'support_tickets',
  'device_audit',
  'app_release_catalog',
  'app_release_selection',
  'app_release_audit'
];

// Tables intentionally excluded from migration:
// - admin_login_limits/admin_web_sessions: short-lived security state must start fresh.
// - app_releases/blofy_app_release_catalog: legacy release migrations only.
// - coupons/coupon_redemptions/payment_events: no current production route consumes them.
// - blofy_release_store: owned by the Azure update-distribution service and preserved in place.
// - blofy_crypto_state: target-owned wrapping state; replaced atomically with the source data key.

const RELEASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS app_release_catalog (
  id UUID PRIMARY KEY, channel TEXT NOT NULL CHECK(channel IN ('stable','testing')),
  version_code INTEGER NOT NULL UNIQUE CHECK(version_code > 0 AND version_code <= 2100000000),
  version_name TEXT NOT NULL, download_url TEXT NOT NULL, release_notes TEXT,
  min_supported_version_code INTEGER NOT NULL DEFAULT 1 CHECK(min_supported_version_code > 0 AND min_supported_version_code <= version_code),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_release_selection (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
  primary_id UUID REFERENCES app_release_catalog(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 1, initialized BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO app_release_selection(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS app_release_audit (
  id BIGSERIAL PRIMARY KEY, action TEXT NOT NULL, release_id UUID NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

const sourcePool = new pg.Pool(databaseOptions(sourceUrl, {
  max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
  lock_timeout: 5_000, idle_in_transaction_session_timeout: 120_000
}));
const targetPool = new pg.Pool(databaseOptions(targetUrl, {
  max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 60_000,
  lock_timeout: 10_000, idle_in_transaction_session_timeout: 180_000
}));

const q = value => `"${String(value).replaceAll('"', '""')}"`;
const tableRef = table => `public.${q(table)}`;

async function tableExists(client, table) {
  return Boolean((await client.query('SELECT to_regclass($1) AS name', [`public.${table}`])).rows[0]?.name);
}
async function identity(client) {
  return (await client.query('SELECT current_database() AS name, current_schema() AS schema')).rows[0];
}
async function columns(client, table) {
  const result = await client.query(`SELECT column_name,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [table]);
  return result.rows;
}
async function countRows(client, table) {
  if (!await tableExists(client, table)) return null;
  return Number((await client.query(`SELECT COUNT(*)::bigint AS count FROM ${tableRef(table)}`)).rows[0].count);
}
async function counts(client) {
  const result = {};
  for (const table of CORE_TABLES) result[table] = await countRows(client, table);
  return result;
}
async function ensureTargetSchema(client) {
  const core = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await client.query(core);
  await client.query(ADMIN_CONSOLE_SCHEMA);
  await client.query(DEVICE_ADMIN_SCHEMA);
  await client.query(RELEASE_SCHEMA);
}
async function assertCompatibility(source, target) {
  for (const table of CORE_TABLES) {
    if (!await tableExists(source, table)) throw new Error(`migration_source_table_missing:${table}`);
    if (!await tableExists(target, table)) throw new Error(`migration_target_table_missing:${table}`);
    const sourceColumns = (await columns(source, table)).map(row => row.column_name);
    const targetColumns = new Set((await columns(target, table)).map(row => row.column_name));
    const missing = sourceColumns.filter(column => !targetColumns.has(column));
    if (missing.length) throw new Error(`migration_target_columns_missing:${table}:${missing.join(',')}`);
  }
}
async function insertRows(target, table, rows, columnNames) {
  const size = 100;
  for (let offset = 0; offset < rows.length; offset += size) {
    const batch = rows.slice(offset, offset + size);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const placeholders = columnNames.map((column, columnIndex) => {
        values.push(row[column]);
        return `$${rowIndex * columnNames.length + columnIndex + 1}`;
      });
      return `(${placeholders.join(',')})`;
    });
    await target.query(`INSERT INTO ${tableRef(table)} (${columnNames.map(q).join(',')}) VALUES ${tuples.join(',')}`, values);
  }
}
async function copyTable(source, target, table) {
  const columnNames = (await columns(source, table)).map(row => row.column_name);
  const rows = (await source.query(`SELECT ${columnNames.map(q).join(',')} FROM ${tableRef(table)}`)).rows;
  if (rows.length) await insertRows(target, table, rows, columnNames);
  return rows.length;
}
async function resetSerial(target, table, column='id') {
  const sequence = (await target.query('SELECT pg_get_serial_sequence($1,$2) AS seq', [`public.${table}`, column])).rows[0]?.seq;
  if (!sequence) return;
  const max = (await target.query(`SELECT MAX(${q(column)})::bigint AS value FROM ${tableRef(table)}`)).rows[0]?.value;
  if (max == null) await target.query('SELECT setval($1,1,false)', [sequence]);
  else await target.query('SELECT setval($1,$2,true)', [sequence, max]);
}
function backupName() {
  return `blofy_backup_${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`;
}
async function backupTarget(target, schema) {
  await target.query(`CREATE SCHEMA ${q(schema)}`);
  for (const table of CORE_TABLES) {
    await target.query(`CREATE TABLE ${q(schema)}.${q(table)} AS TABLE ${tableRef(table)}`);
  }
  if (await tableExists(target,'blofy_crypto_state')) {
    await target.query(`CREATE TABLE ${q(schema)}.blofy_crypto_state AS TABLE public.blofy_crypto_state`);
  }
}
async function clearTarget(target) {
  // Children first; devices and release catalog last.
  for (const table of [...CORE_TABLES].reverse()) await target.query(`DELETE FROM ${tableRef(table)}`);
}

let sourceClient, targetClient;
try {
  sourceClient = await sourcePool.connect();
  targetClient = await targetPool.connect();
  const [sourceIdentity, targetIdentity] = await Promise.all([identity(sourceClient), identity(targetClient)]);
  if (process.env.BLOFY_MIGRATION_CONFIRM_SOURCE && sourceIdentity.name !== process.env.BLOFY_MIGRATION_CONFIRM_SOURCE) {
    throw new Error('migration_source_database_confirmation_failed');
  }
  if (process.env.BLOFY_MIGRATION_CONFIRM_TARGET && targetIdentity.name !== process.env.BLOFY_MIGRATION_CONFIRM_TARGET) {
    throw new Error('migration_target_database_confirmation_failed');
  }

  await sourceClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const sourceCounts = await counts(sourceClient);
  const targetCountsBefore = await counts(targetClient);

  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      mode:'dry-run', keyCompatible, keyMigrationMode, source:sourceIdentity, target:targetIdentity,
      sourceCounts, targetCountsBefore, tables:CORE_TABLES,
      applyPhraseRequired:APPLY_PHRASE,
      privacy:'Counts and database names only; no row values or secret material are printed.'
    }, null, 2)}\n`);
    await sourceClient.query('ROLLBACK');
    process.exitCode = 0;
  } else {
    if (sourceCounts.devices == null || sourceCounts.devices < 1) throw new Error('migration_source_devices_empty');

    await targetClient.query('BEGIN');
    await targetClient.query('SELECT pg_advisory_xact_lock(718420699)');
    await ensureTargetSchema(targetClient);
    await assertCompatibility(sourceClient, targetClient);

    const backupSchema = backupName();
    await backupTarget(targetClient, backupSchema);
    await clearTarget(targetClient);

    const copied = {};
    for (const table of CORE_TABLES) copied[table] = await copyTable(sourceClient, targetClient, table);
    for (const table of ['playback_diagnostics','device_audit','app_release_audit']) await resetSerial(targetClient, table);

    const dataKeyState = await persistDataKey(targetClient, sourceKey, wrappingKeyFromEnv());
    const targetCountsAfter = await counts(targetClient);
    const mismatches = CORE_TABLES.filter(table => sourceCounts[table] !== targetCountsAfter[table]);
    if (mismatches.length) throw new Error(`migration_count_mismatch:${mismatches.join(',')}`);

    await targetClient.query('COMMIT');
    await sourceClient.query('ROLLBACK');
    process.stdout.write(`${JSON.stringify({
      mode:'applied', keyCompatible, keyMigrationMode, source:sourceIdentity, target:targetIdentity,
      backupSchema, copied, sourceCounts, targetCountsAfter,
      persistedDataKey:true, dataKeyFingerprint:dataKeyState.fingerprint, restartRequired:true,
      preservedTargetTables:['blofy_release_store'],
      privacy:'No row values or secret material were printed.'
    }, null, 2)}\n`);
  }
} catch (error) {
  if (targetClient) await targetClient.query('ROLLBACK').catch(() => {});
  if (sourceClient) await sourceClient.query('ROLLBACK').catch(() => {});
  console.error(`Production migration failed: ${String(error?.message || 'migration_failed').slice(0,300)}`);
  process.exitCode = 1;
} finally {
  sourceClient?.release();
  targetClient?.release();
  await Promise.allSettled([sourcePool.end(), targetPool.end()]);
}

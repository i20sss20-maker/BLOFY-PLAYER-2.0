import crypto from 'node:crypto';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import { ADMIN_CONSOLE_SCHEMA } from './admin-console-schema.mjs';
import { DEVICE_ADMIN_SCHEMA } from './device-admin.mjs';

const ROOT = '/api/v1/internal/migration-import';
const TABLES = [
  'devices','provider_profiles','device_trial_claims','device_customers','device_admin_metadata',
  'device_playlists','playback_diagnostics','profile_cloud_snapshots','cloud_pair_codes',
  'license_recovery_keys','subscription_plans','subscription_orders','device_subscriptions',
  'support_tickets','device_audit','app_release_catalog','app_release_selection','app_release_audit'
];
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
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
const pool = databaseUrl ? new pg.Pool({
  ...databaseOptions(databaseUrl), max:1, connectionTimeoutMillis:8000,
  statement_timeout:60000, lock_timeout:10000, idle_in_transaction_session_timeout:180000
}) : null;
pool?.on('error',()=>console.error('migration_import_database_unavailable'));

function privateKey() {
  const encoded = String(process.env.BLOFY_MIGRATION_PRIVATE_KEY_B64 || '').trim();
  if (!encoded) return '';
  try { return Buffer.from(encoded,'base64').toString('utf8'); } catch { return ''; }
}
function token() { return String(process.env.BLOFY_MIGRATION_IMPORT_TOKEN || '').trim(); }
function available() { return Boolean(pool && privateKey() && token()); }
function constantTimeEqual(a,b) {
  const left=Buffer.from(String(a)), right=Buffer.from(String(b));
  return left.length===right.length && crypto.timingSafeEqual(left,right);
}
function authorized(req) {
  const header=String(req.headers.authorization || '');
  return token() && header.startsWith('Bearer ') && constantTimeEqual(header.slice(7),token());
}
function sendJson(res,status,body) {
  const payload=JSON.stringify(body);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(payload),
    'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(payload);
}
async function readBody(req) {
  let body='';
  for await (const chunk of req) {
    body+=chunk;
    if (Buffer.byteLength(body)>16*1024*1024) throw new Error('migration_envelope_too_large');
  }
  return JSON.parse(body || '{}');
}
const q=value=>`"${String(value).replaceAll('"','""')}"`;
const tableRef=table=>`public.${q(table)}`;
async function tableExists(client,table) {
  return Boolean((await client.query('SELECT to_regclass($1) AS name',[`public.${table}`])).rows[0]?.name);
}
async function columns(client,table) {
  return (await client.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[table])).rows.map(row=>row.column_name);
}
async function counts(client) {
  const result={};
  for (const table of TABLES) result[table]=await tableExists(client,table)
    ? Number((await client.query(`SELECT COUNT(*)::bigint AS count FROM ${tableRef(table)}`)).rows[0].count) : null;
  return result;
}
function decryptEnvelope(envelope) {
  if (envelope?.protocol!=='blofy-migration-envelope-v1') throw new Error('migration_envelope_invalid');
  for (const name of ['key','iv','tag','data']) if (typeof envelope[name]!=='string' || !envelope[name]) throw new Error('migration_envelope_invalid');
  const aesKey=crypto.privateDecrypt({key:privateKey(),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.key,'base64url'));
  const decipher=crypto.createDecipheriv('aes-256-gcm',aesKey,Buffer.from(envelope.iv,'base64url'));
  decipher.setAuthTag(Buffer.from(envelope.tag,'base64url'));
  const compressed=Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64url')),decipher.final()]);
  return JSON.parse(gunzipSync(compressed).toString('utf8'));
}
function validateBundle(bundle) {
  if (!bundle || bundle.protocol!=='blofy-migration-v1' || !/^[0-9a-f-]{36}$/i.test(String(bundle.bundleId||''))) throw new Error('migration_bundle_invalid');
  if (!Number.isFinite(bundle.generatedAt) || Math.abs(Date.now()-bundle.generatedAt)>30*60*1000) throw new Error('migration_bundle_stale');
  const expected=String(process.env.BLOFY_MIGRATION_EXPECTED_SOURCE_DATABASE || '').trim();
  if (expected && bundle.source?.database!==expected) throw new Error('migration_source_database_confirmation_failed');
  if (!/^[a-fA-F0-9]{64}$/.test(String(bundle.sourcePlaylistEncryptionKey||''))) throw new Error('migration_source_key_invalid');
  const targetKey=String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
  const a=crypto.createHash('sha256').update(bundle.sourcePlaylistEncryptionKey).digest();
  const b=crypto.createHash('sha256').update(targetKey).digest();
  if (a.length!==b.length || !crypto.timingSafeEqual(a,b)) throw new Error('migration_encryption_key_mismatch');
  for (const table of TABLES) {
    const item=bundle.tables?.[table];
    if (!item || !Array.isArray(item.columns) || !Array.isArray(item.rows) || item.columns.length<1) throw new Error(`migration_bundle_table_invalid:${table}`);
    if (item.columns.some(name=>!/^[a-z_][a-z0-9_]*$/i.test(name))) throw new Error(`migration_bundle_columns_invalid:${table}`);
    if (Number(bundle.counts?.[table])!==item.rows.length) throw new Error(`migration_bundle_count_invalid:${table}`);
  }
  if (Object.keys(bundle.tables||{}).some(table=>!TABLES.includes(table))) throw new Error('migration_bundle_unknown_table');
  return bundle;
}
async function ensureTargetSchema(client) {
  const core=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  await client.query(core); await client.query(ADMIN_CONSOLE_SCHEMA); await client.query(DEVICE_ADMIN_SCHEMA); await client.query(RELEASE_SCHEMA);
}
async function assertCompatibility(client,bundle) {
  for (const table of TABLES) {
    if (!await tableExists(client,table)) throw new Error(`migration_target_table_missing:${table}`);
    const target=new Set(await columns(client,table));
    const missing=bundle.tables[table].columns.filter(name=>!target.has(name));
    if (missing.length) throw new Error(`migration_target_columns_missing:${table}:${missing.join(',')}`);
  }
}
async function insertRows(client,table,item) {
  const names=item.columns, rows=item.rows, batchSize=100;
  for (let offset=0;offset<rows.length;offset+=batchSize) {
    const batch=rows.slice(offset,offset+batchSize), values=[];
    const tuples=batch.map((row,rowIndex)=>`(${names.map((name,columnIndex)=>{ values.push(row[name]); return `$${rowIndex*names.length+columnIndex+1}`; }).join(',')})`);
    if (tuples.length) await client.query(`INSERT INTO ${tableRef(table)} (${names.map(q).join(',')}) VALUES ${tuples.join(',')}`,values);
  }
}
async function resetSerial(client,table,column='id') {
  const seq=(await client.query('SELECT pg_get_serial_sequence($1,$2) AS seq',[`public.${table}`,column])).rows[0]?.seq;
  if (!seq) return;
  const max=(await client.query(`SELECT MAX(${q(column)})::bigint AS value FROM ${tableRef(table)}`)).rows[0]?.value;
  if (max==null) await client.query('SELECT setval($1,1,false)',[seq]); else await client.query('SELECT setval($1,$2,true)',[seq,max]);
}
function backupName() { return `blofy_backup_${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}_${crypto.randomBytes(2).toString('hex')}`; }
async function applyBundle(bundle) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(718420699)');
    await ensureTargetSchema(client); await assertCompatibility(client,bundle);
    await client.query(`CREATE TABLE IF NOT EXISTS blofy_migration_journal (
      bundle_id UUID PRIMARY KEY, source_database TEXT NOT NULL, backup_schema TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const prior=(await client.query('SELECT backup_schema FROM blofy_migration_journal WHERE bundle_id=$1',[bundle.bundleId])).rows[0];
    if (prior) { await client.query('ROLLBACK'); return {mode:'already-applied',bundleId:bundle.bundleId,backupSchema:prior.backup_schema}; }
    const backupSchema=backupName();
    await client.query(`CREATE SCHEMA ${q(backupSchema)}`);
    for (const table of TABLES) await client.query(`CREATE TABLE ${q(backupSchema)}.${q(table)} AS TABLE ${tableRef(table)}`);
    for (const table of [...TABLES].reverse()) await client.query(`DELETE FROM ${tableRef(table)}`);
    for (const table of TABLES) await insertRows(client,table,bundle.tables[table]);
    for (const table of ['playback_diagnostics','device_audit','app_release_audit']) await resetSerial(client,table);
    for (const transient of ['admin_web_sessions','admin_login_limits']) if (await tableExists(client,transient)) await client.query(`DELETE FROM public.${q(transient)}`);
    const after=await counts(client), mismatches=TABLES.filter(table=>after[table]!==Number(bundle.counts[table]));
    if (mismatches.length) throw new Error(`migration_count_mismatch:${mismatches.join(',')}`);
    await client.query('INSERT INTO blofy_migration_journal(bundle_id,source_database,backup_schema) VALUES($1,$2,$3)',[bundle.bundleId,bundle.source.database,backupSchema]);
    await client.query('COMMIT');
    return {mode:'applied',bundleId:bundle.bundleId,backupSchema,source:{database:bundle.source.database},sourceCounts:bundle.counts,targetCountsAfter:after,preservedTargetTables:['blofy_release_store']};
  } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
}

const previousCreateServer=http.createServer.bind(http);
http.createServer=function withMigrationImport(listener) {
  if (typeof listener!=='function') return previousCreateServer(listener);
  return previousCreateServer(async (req,res)=>{
    try {
      const url=new URL(req.url||'/','http://blofy.local');
      if (url.pathname===`${ROOT}/status` && req.method==='GET') return sendJson(res,200,{protocol:'blofy-migration-v1',available:available()});
      if (url.pathname===ROOT || url.pathname===`${ROOT}/validate`) {
        if (req.method!=='POST') return sendJson(res,405,{error:'method_not_allowed'});
        if (!available()) return sendJson(res,404,{error:'migration_import_disabled'});
        if (!authorized(req)) return sendJson(res,401,{error:'unauthorized'});
        const bundle=validateBundle(decryptEnvelope(await readBody(req)));
        if (url.pathname.endsWith('/validate')) {
          const client=await pool.connect();
          try { return sendJson(res,200,{mode:'validated',keyCompatible:true,source:bundle.source,sourceCounts:bundle.counts,targetCountsBefore:await counts(client)}); }
          finally { client.release(); }
        }
        return sendJson(res,200,await applyBundle(bundle));
      }
    } catch(error) {
      console.error(`migration_import_failed:${String(error?.message||'unknown').slice(0,180)}`);
      return sendJson(res,409,{error:String(error?.message||'migration_import_failed').slice(0,180)});
    }
    return listener(req,res);
  });
};

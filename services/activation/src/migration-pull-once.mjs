import crypto from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import { installPersistedDataKey } from './data-key-state.mjs';
import { importEncryptedMigrationEnvelope } from './migration-import-hook.mjs';

const { Pool } = pg;
const sourceUrl = String(process.env.BLOFY_MIGRATION_SOURCE_URL || '').trim().replace(/\/+$/,'');
const pullToken = String(process.env.BLOFY_MIGRATION_PULL_TOKEN || '').trim();
const databaseUrl = String(process.env.DATABASE_URL || '').trim();

function enabled() {
  if (!sourceUrl || !pullToken || pullToken.length < 32 || !databaseUrl) return false;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch { return false; }
}

async function alreadyApplied(pool, tokenHash) {
  await pool.query(`CREATE TABLE IF NOT EXISTS blofy_migration_pull_once (
    token_hash TEXT PRIMARY KEY,
    source_url TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const row = (await pool.query('SELECT 1 FROM blofy_migration_pull_once WHERE token_hash=$1',[tokenHash])).rows[0];
  return Boolean(row);
}

async function markApplied(pool, tokenHash) {
  await pool.query(
    'INSERT INTO blofy_migration_pull_once(token_hash,source_url) VALUES($1,$2) ON CONFLICT(token_hash) DO NOTHING',
    [tokenHash, sourceUrl]
  );
}

async function pullOnce() {
  if (!enabled()) {
    console.log(`BLOFY Railway migration pull config: source=${Boolean(sourceUrl)} tokenLength=${pullToken.length} database=${Boolean(databaseUrl)}`);
    return { skipped:true, reason:'disabled' };
  }
  const tokenHash = crypto.createHash('sha256').update(pullToken).digest('hex');
  const pool = new Pool({
    ...databaseOptions(databaseUrl),
    max:1, connectionTimeoutMillis:8000, statement_timeout:10000,
    lock_timeout:5000, idle_in_transaction_session_timeout:15000,
    allowExitOnIdle:true
  });
  try {
    if (await alreadyApplied(pool, tokenHash)) return { skipped:true, reason:'already_applied' };
    const response = await fetch(`${sourceUrl}/api/v1/internal/migration-export`, {
      method:'POST', redirect:'error', cache:'no-store', signal:AbortSignal.timeout(180000),
      headers:{accept:'application/json','cache-control':'no-cache'}
    });
    if (!response.ok) throw new Error(`migration_source_http_${response.status}`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 20*1024*1024) throw new Error('migration_source_payload_too_large');
    const envelope = JSON.parse(text);
    const result = await importEncryptedMigrationEnvelope(envelope);
    if (!['applied','already-applied'].includes(result?.mode)) throw new Error('migration_apply_unexpected_result');
    await markApplied(pool, tokenHash);
    const installed = await installPersistedDataKey();
    if (!installed?.installed) throw new Error('migration_data_key_not_loaded');
    console.log(`BLOFY Railway migration pull complete: ${result.mode}`);
    return { skipped:false, mode:result.mode };
  } finally {
    await pool.end();
  }
}

const pullResult = await pullOnce();
if (pullResult?.skipped) console.log(`BLOFY Railway migration pull skipped: ${pullResult.reason}`);


import crypto from 'node:crypto';
import pg from 'pg';
import { databaseOptions } from './database-options.mjs';

const { Pool } = pg;
const CONTEXT = Buffer.from('blofy-persisted-data-key:v1', 'utf8');
const TABLE = 'blofy_crypto_state';

export const CRYPTO_STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${TABLE} (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
  wrapped_data_key TEXT NOT NULL,
  data_key_fingerprint TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;

function validKey(value) {
  return /^[a-fA-F0-9]{64}$/.test(String(value || '').trim());
}

function deriveWrappingKey(wrappingKeyHex) {
  if (!validKey(wrappingKeyHex)) throw new Error('data_key_wrapping_key_invalid');
  return crypto.createHmac('sha256', Buffer.from(wrappingKeyHex, 'hex'))
    .update(CONTEXT)
    .digest();
}

export function dataKeyFingerprint(dataKeyHex) {
  if (!validKey(dataKeyHex)) throw new Error('data_key_invalid');
  return crypto.createHash('sha256').update(Buffer.from(dataKeyHex, 'hex')).digest('hex');
}

export function wrapDataKey(dataKeyHex, wrappingKeyHex) {
  if (!validKey(dataKeyHex)) throw new Error('data_key_invalid');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveWrappingKey(wrappingKeyHex), iv);
  cipher.setAAD(CONTEXT);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(dataKeyHex, 'hex')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function unwrapDataKey(wrapped, wrappingKeyHex) {
  const parts = String(wrapped || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('wrapped_data_key_invalid');
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length !== 32) throw new Error('invalid_size');
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveWrappingKey(wrappingKeyHex), iv);
    decipher.setAAD(CONTEXT);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length !== 32) throw new Error('invalid_plaintext');
    return plaintext.toString('hex');
  } catch (error) {
    if (error?.message === 'data_key_wrapping_key_invalid') throw error;
    throw new Error('wrapped_data_key_decryption_failed');
  }
}

export async function persistDataKey(client, dataKeyHex, wrappingKeyHex) {
  if (!client?.query) throw new Error('data_key_database_client_required');
  const wrapped = wrapDataKey(dataKeyHex, wrappingKeyHex);
  const fingerprint = dataKeyFingerprint(dataKeyHex);
  await client.query(CRYPTO_STATE_SCHEMA);
  await client.query(`INSERT INTO ${TABLE}(singleton,wrapped_data_key,data_key_fingerprint,updated_at)
    VALUES(TRUE,$1,$2,NOW())
    ON CONFLICT(singleton) DO UPDATE SET wrapped_data_key=EXCLUDED.wrapped_data_key,
      data_key_fingerprint=EXCLUDED.data_key_fingerprint,updated_at=NOW()`, [wrapped, fingerprint]);
  return { fingerprint };
}

export async function loadPersistedDataKey(client, wrappingKeyHex) {
  if (!client?.query) throw new Error('data_key_database_client_required');
  const exists = (await client.query("SELECT to_regclass('public.blofy_crypto_state') AS name")).rows[0]?.name;
  if (!exists) return null;
  const row = (await client.query(`SELECT wrapped_data_key,data_key_fingerprint FROM ${TABLE} WHERE singleton=TRUE`)).rows[0];
  if (!row) return null;
  const dataKeyHex = unwrapDataKey(row.wrapped_data_key, wrappingKeyHex);
  if (!crypto.timingSafeEqual(Buffer.from(dataKeyFingerprint(dataKeyHex)), Buffer.from(String(row.data_key_fingerprint || '')))) {
    throw new Error('persisted_data_key_fingerprint_mismatch');
  }
  return dataKeyHex;
}

/**
 * Azure keeps BLOFY_PLAYLIST_ENCRYPTION_KEY as the stable wrapping key. When a
 * migrated production data key exists in PostgreSQL, unwrap it before any
 * crypto-aware handler is imported and expose it through the existing env name.
 * The original wrapping key remains process-local in BLOFY_PLAYLIST_WRAPPING_KEY.
 */
export async function installPersistedDataKey(env = process.env) {
  const wrappingKeyHex = String(env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!validKey(wrappingKeyHex) || !databaseUrl) return { installed: false, reason: 'configuration_unavailable' };

  env.BLOFY_PLAYLIST_WRAPPING_KEY = wrappingKeyHex;
  const pool = new Pool({
    ...databaseOptions(databaseUrl),
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    lock_timeout: 2000,
    idle_in_transaction_session_timeout: 5000,
    allowExitOnIdle: true
  });
  try {
    const dataKeyHex = await loadPersistedDataKey(pool, wrappingKeyHex);
    if (!dataKeyHex) return { installed: false, reason: 'no_persisted_data_key' };
    env.BLOFY_PLAYLIST_ENCRYPTION_KEY = dataKeyHex;
    return { installed: true, fingerprint: dataKeyFingerprint(dataKeyHex) };
  } finally {
    await pool.end();
  }
}

export function wrappingKeyFromEnv(env = process.env) {
  const value = String(env.BLOFY_PLAYLIST_WRAPPING_KEY || env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
  if (!validKey(value)) throw new Error('data_key_wrapping_key_invalid');
  return value;
}

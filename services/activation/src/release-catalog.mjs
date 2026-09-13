import crypto from 'node:crypto';
import {
  sanitizeHttpsUrl, sanitizeVersionCode, sanitizeVersionName, sanitizeReleaseNotes
} from './release-metadata.mjs';

// Same verified fallback already published in production. Initialization does not promote a new APK.
export const CURRENT_RELEASE = Object.freeze({
  versionCode: 2000051, versionName: '2.0.0-rc07.40', channel: 'testing',
  minSupportedVersionCode: 1,
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.40/BLOFY-PLAYER-2.0-rc07.40-signed.apk',
  releaseNotes: 'تحسين التحقق من حزمة التحديث. عند تعذر التحديث من 38 أو 39، ثبّت APK فوق النسخة الحالية دون حذف التطبيق.'
});
const TABLE = 'blofy_app_release_catalog';
const MAX_RELEASES = 500;
export class ReleaseError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function normalizeRelease(value) {
  if (!value || typeof value !== 'object') throw new ReleaseError('invalid_release');
  const versionCode = sanitizeVersionCode(value.versionCode);
  const versionName = sanitizeVersionName(value.versionName);
  const downloadUrl = sanitizeHttpsUrl(value.downloadUrl);
  const channel = value.channel;
  const minimum = value.minSupportedVersionCode == null ? 1 : sanitizeVersionCode(value.minSupportedVersionCode);
  if (!versionCode || !versionName || !downloadUrl || !['stable', 'testing'].includes(channel) ||
      !minimum || minimum > versionCode || downloadUrl.length > 2048 || new URL(downloadUrl).pathname === '/download/latest.apk') throw new ReleaseError('invalid_release');
  return { versionCode, versionName, channel, downloadUrl,
    minSupportedVersionCode: minimum, releaseNotes: sanitizeReleaseNotes(value.releaseNotes) || '' };
}
export function initialCatalog(legacy = [], seed = CURRENT_RELEASE) {
  const entries = new Map();
  for (const row of legacy) {
    try {
      const item = normalizeRelease({ channel: row.channel, versionCode: row.version_code,
        versionName: row.version_name, downloadUrl: row.download_url, releaseNotes: row.release_notes });
      entries.set(item.versionCode, item);
    } catch { /* Invalid legacy metadata must not disable download management. */ }
  }
  const current = normalizeRelease(seed);
  entries.set(current.versionCode, current);
  return { revision: 1, primaryVersionCode: current.versionCode, items: [...entries.values()] };
}
export function publicCatalog(state) {
  return { catalogId: state.catalogId || null, revision: state.revision, primaryVersionCode: state.primaryVersionCode,
    items: state.items.slice().sort((a, b) => Number(b.versionCode === state.primaryVersionCode) -
      Number(a.versionCode === state.primaryVersionCode) || b.versionCode - a.versionCode)
      .map(item => ({ ...item, isPrimary: item.versionCode === state.primaryVersionCode })) };
}
export function selectedRelease(state) {
  const value = state.items.find(item => item.versionCode === state.primaryVersionCode);
  if (!value) throw new ReleaseError('primary_release_missing', 503);
  const { channel, ...release } = normalizeRelease(value);
  return release;
}
/** Pure state transition, used only while holding the singleton row lock. */
export function changeCatalog(state, action, input) {
  if (!input || Number(input.revision) !== state.revision) throw new ReleaseError('release_conflict', 409);
  const next = { ...state, items: state.items.map(item => ({ ...item })) };
  const key = sanitizeVersionCode(input.targetVersionCode);
  const index = next.items.findIndex(item => item.versionCode === key);
  if (action === 'create') {
    const item = normalizeRelease(input);
    if (next.items.some(row => row.versionCode === item.versionCode)) throw new ReleaseError('release_exists', 409);
    if (next.items.length >= MAX_RELEASES) throw new ReleaseError('release_limit');
    next.items.push(item);
  } else {
    if (!key || index < 0) throw new ReleaseError('release_not_found', 404);
    if (action === 'edit') {
      const item = normalizeRelease(input);
      if (item.versionCode !== key) throw new ReleaseError('release_identity_locked');
      next.items[index] = item;
    } else if (action === 'delete') {
      if (key === state.primaryVersionCode) throw new ReleaseError('primary_release_protected', 409);
      next.items.splice(index, 1);
    } else if (action === 'primary') {
      normalizeRelease(next.items[index]);
      next.primaryVersionCode = key;
    } else throw new ReleaseError('invalid_release_action');
  }
  next.revision += 1;
  return next;
}

export function createReleaseCatalog({ pool, seed = CURRENT_RELEASE, audit = async () => {} }) {
  let initialized;
  async function ensure() {
    if (!initialized) initialized = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout = '10s'");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('blofy-release-catalog-v1'))");
        await client.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
          id SMALLINT PRIMARY KEY CHECK (id=1), state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        const old = await client.query(`SELECT state FROM ${TABLE} WHERE id=1`);
        if (!old.rows.length) {
          const legacyTable = await client.query("SELECT to_regclass('public.app_releases') AS name");
          const legacy = legacyTable.rows[0]?.name ? (await client.query('SELECT * FROM app_releases')).rows : [];
          await client.query(`INSERT INTO ${TABLE}(id,state) VALUES(1,$1::jsonb)`, [JSON.stringify({ ...initialCatalog(legacy, seed), catalogId: crypto.randomUUID() })]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    })().catch(error => { initialized = undefined; throw error; });
    return initialized;
  }
  async function read() {
    await ensure();
    const result = await pool.query(`SELECT state FROM ${TABLE} WHERE id=1`);
    if (!result.rows[0]) throw new ReleaseError('release_catalog_unavailable', 503);
    return result.rows[0].state;
  }
  async function mutate(action, input) {
    if (action==='create' || action==='edit') normalizeRelease(input);
    if (!Number.isSafeInteger(Number(input?.revision)) || Number(input.revision)<1) throw new ReleaseError('release_conflict',409);
    await ensure();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      const result = await client.query(`SELECT state FROM ${TABLE} WHERE id=1 FOR UPDATE`);
      if (!result.rows[0]) throw new ReleaseError('release_catalog_unavailable', 503);
      const next = changeCatalog(result.rows[0].state, action, input);
      await client.query(`UPDATE ${TABLE} SET state=$1::jsonb,updated_at=NOW() WHERE id=1`, [JSON.stringify(next)]);
      await audit(client, action, next.items.find(item => item.versionCode === (input.targetVersionCode || Number(input.versionCode))) || result.rows[0].state.items.find(item => item.versionCode === input.targetVersionCode));
      await client.query('COMMIT');
      return publicCatalog(next);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  return { read, list: async () => publicCatalog(await read()),
    appRelease: async () => selectedRelease(await read()), mutate };
}

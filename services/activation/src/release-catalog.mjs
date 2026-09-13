import crypto from 'node:crypto';
import { publishApprovedRc0742 } from './approved-release-rc0742.mjs';
import { sanitizeVersionCode, sanitizeVersionName, sanitizeReleaseNotes } from './release-metadata.mjs';

export class ReleaseError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
const integer = value => (typeof value === 'number' || /^\d+$/.test(String(value || ''))) ? sanitizeVersionCode(value) : null;
export function validateRelease(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReleaseError('invalid_release');
  const versionCode = integer(body.versionCode);
  const versionName = sanitizeVersionName(body.versionName);
  const minimum = integer(body.minSupportedVersionCode ?? 1);
  let url;
  try { url = new URL(String(body.downloadUrl || '').trim()); } catch { /* validated below */ }
  if (!['stable', 'testing'].includes(body.channel) || !versionCode || !versionName || !minimum || minimum > versionCode ||
      !url || url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash || !/\.apk$/i.test(url.pathname)) {
    throw new ReleaseError('invalid_release');
  }
  return { channel: body.channel, versionCode, versionName, minSupportedVersionCode: minimum,
    downloadUrl: url.toString(), releaseNotes: sanitizeReleaseNotes(body.releaseNotes) };
}
const SCHEMA = `
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
const columns = item => [item.channel, item.versionCode, item.versionName, item.downloadUrl, item.releaseNotes, item.minSupportedVersionCode];
const mapRow = row => ({ id: row.id, channel: row.channel, versionCode: Number(row.version_code), versionName: row.version_name,
  downloadUrl: row.download_url, releaseNotes: row.release_notes, minSupportedVersionCode: Number(row.min_supported_version_code),
  revision: Number(row.revision), isPrimary: row.is_primary === true, updatedAt: new Date(row.updated_at).getTime() });
const appMetadata = row => { const { versionCode, versionName, downloadUrl, releaseNotes, minSupportedVersionCode } = mapRow(row);
  return { versionCode, versionName, downloadUrl, releaseNotes, minSupportedVersionCode }; };

/** A durable catalogue, separate from legacy per-channel rows. No GitHub files are deleted. */
export function createReleaseCatalog(pool, configured = null) {
  let initialized;
  async function transaction(action) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') throw new ReleaseError('release_version_exists', 409);
      throw error;
    } finally { client.release(); }
  }
  async function insert(client, item) {
    return (await client.query(`INSERT INTO app_release_catalog(id,channel,version_code,version_name,download_url,release_notes,min_supported_version_code)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [crypto.randomUUID(), ...columns(item)])).rows[0];
  }
  function ensure() {
    if (!initialized) initialized = transaction(async client => {
      // Serialize first-use migrations across Vercel instances, including CREATE IF NOT EXISTS.
      await client.query('SELECT pg_advisory_xact_lock(718420640)');
      await client.query(SCHEMA);
      const state = (await client.query('SELECT * FROM app_release_selection WHERE singleton=TRUE FOR UPDATE')).rows[0];
      if (state.initialized) { await publishApprovedRc0742(client); return; }
      const legacy = await client.query("SELECT to_regclass('app_releases') AS name");
      const oldRows = legacy.rows[0]?.name ? (await client.query('SELECT * FROM app_releases ORDER BY version_code DESC')).rows : [];
      const candidates = [];
      if (configured?.downloadUrl) candidates.push({ ...configured, channel: /rc|beta|alpha/i.test(configured.versionName) ? 'testing' : 'stable' });
      for (const row of oldRows) candidates.push({ channel: row.channel, versionCode: row.version_code, versionName: row.version_name,
        downloadUrl: row.download_url, releaseNotes: row.release_notes });
      let first = null;
      const seen = new Set();
      for (const candidate of candidates) {
        let item; try { item = validateRelease(candidate); } catch { continue; }
        if (seen.has(item.versionCode)) continue;
        seen.add(item.versionCode);
        const row = await insert(client, item);
        first ||= row.id;
      }
      // Mark migration even when empty. Deleted versions must never reappear on a cold start.
      await client.query('UPDATE app_release_selection SET primary_id=$1,initialized=TRUE WHERE singleton=TRUE', [first]);
      await publishApprovedRc0742(client);
    }).catch(error => { initialized = null; throw error; });
    return initialized;
  }
  async function list() {
    await ensure();
    // The state and rows are read in one statement so primaryId and badges cannot disagree.
    const result = await pool.query(`SELECT c.*, s.primary_id, s.revision AS selection_revision, (c.id=s.primary_id) AS is_primary
      FROM app_release_selection s LEFT JOIN app_release_catalog c ON TRUE WHERE s.singleton=TRUE
      ORDER BY is_primary DESC NULLS LAST,c.version_code DESC`);
    return { items: result.rows.filter(row => row.id).map(mapRow), primaryId: result.rows[0]?.primary_id || null,
      selectionRevision: Number(result.rows[0]?.selection_revision || 1) };
  }
  async function primary() {
    await ensure();
    const result = await pool.query(`SELECT c.* FROM app_release_selection s JOIN app_release_catalog c ON c.id=s.primary_id WHERE s.singleton=TRUE`);
    return result.rows[0] ? appMetadata(result.rows[0]) : null;
  }
  async function mutate(action, id, body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReleaseError('invalid_release_request');
    if (typeof id === 'string') id = id.toLowerCase();
    if (!['create','update','delete','primary'].includes(action)) throw new ReleaseError('invalid_release_action');
    if (action !== 'create' && (!uuid(id) || !integer(body.expectedRevision))) throw new ReleaseError('invalid_release_request');
    const item = ['create','update'].includes(action) ? validateRelease(body) : null;
    await ensure();
    return transaction(async client => {
      const state = (await client.query('SELECT * FROM app_release_selection WHERE singleton=TRUE FOR UPDATE')).rows[0];
      let row;
      if (action !== 'create') {
        row = (await client.query('SELECT * FROM app_release_catalog WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!row) throw new ReleaseError('release_not_found', 404);
        if (Number(row.revision) !== Number(body.expectedRevision)) throw new ReleaseError('release_changed', 409);
      }
      if (action === 'create') {
        const count = await client.query('SELECT COUNT(*)::int AS count FROM app_release_catalog');
        if (count.rows[0].count >= 200) throw new ReleaseError('release_catalog_full', 409);
        row = await insert(client, item);
      } else if (action === 'delete') {
        if (state.primary_id === id) throw new ReleaseError('primary_release_delete_forbidden', 409);
        await client.query('DELETE FROM app_release_catalog WHERE id=$1', [id]);
      } else if (action === 'primary') {
        if (Number(body.expectedSelectionRevision) !== Number(state.revision)) throw new ReleaseError('release_changed', 409);
        validateRelease(mapRow(row));
        await client.query('UPDATE app_release_selection SET primary_id=$1,revision=revision+1 WHERE singleton=TRUE', [id]);
      } else {
        row = (await client.query(`UPDATE app_release_catalog SET channel=$2,version_code=$3,version_name=$4,download_url=$5,
          release_notes=$6,min_supported_version_code=$7,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *`, [id, ...columns(item)])).rows[0];
        if (state.primary_id === id) await client.query('UPDATE app_release_selection SET revision=revision+1 WHERE singleton=TRUE');
      }
      await client.query('INSERT INTO app_release_audit(action,release_id,details) VALUES($1,$2,$3::jsonb)',
        [action, row.id, JSON.stringify({ versionCode: row.version_code, versionName: row.version_name, previousPrimaryId: state.primary_id })]);
      return { ok: true, id: row.id };
    });
  }
  return { ensure, list, primary, mutate };
}

export async function handleReleaseAdmin(catalog, req, res, pathname, { requireAdmin, readJson, json }) {
  const root = '/api/v1/admin/experience/releases';
  if (pathname !== root && !pathname.startsWith(root + '/')) return false;
  if (!requireAdmin(req, res)) return true;
  try {
    if (pathname === root && req.method === 'GET') { json(res, 200, await catalog.list()); return true; }
    const match = pathname.slice(root.length).match(/^\/([0-9a-f-]{36})(\/primary)?$/i);
    const action = pathname === root && req.method === 'POST' ? 'create' : match &&
      (match[2] ? (req.method === 'POST' ? 'primary' : null) : ({ PATCH: 'update', DELETE: 'delete' })[req.method]);
    if (!action) { json(res, 405, { error: 'method_not_allowed' }); return true; }
    json(res, 200, await catalog.mutate(action, match?.[1], await readJson(req)));
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error;
    json(res, error.status, { error: error.message });
  }
  return true;
}

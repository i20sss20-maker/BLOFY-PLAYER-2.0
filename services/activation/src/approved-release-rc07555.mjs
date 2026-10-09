import crypto from 'node:crypto';

// Owner-approved Google Play production release. This intentionally does not follow
// arbitrary newer GitHub builds, and never overrides a later administrator choice.
export const APPROVED_RC07555 = Object.freeze({
  versionCode: 2000073,
  versionName: '2.0.0-rc07.55.5',
  channel: 'testing', // rc-prefixed builds use the existing catalogue channel.
  downloadUrl: 'https://updates.blofyplayer.com/files/releases/BLOFY-PLAYER-2.0-rc07.55.5-PRODUCTION-SIGNED.apk',
  minSupportedVersionCode: 1,
  releaseNotes: 'BLOFY PLAYER 55.5 — تحسين توافق أفلام 4K/HEVC، مع Media3 كمحرك أساسي والانتقال إلى LibVLC الداخلي عند الحاجة.'
});

const LEGACY_RC0749 = Object.freeze({
  versionCode: 2000060,
  versionName: '2.0.0-rc07.49',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.49/BLOFY-PLAYER-2.0-rc07.49-signed.apk'
});
export const RC07555_PUBLICATION_ACTION = 'publish_rc07555_from_legacy_20261010';

const isProduction = env => (
  env?.RAILWAY_ENVIRONMENT_NAME === 'production' ||
  (env?.VERCEL === '1' && env?.VERCEL_ENV === 'production')
);

/**
 * Run from the catalogue's existing serialized initialization transaction.
 * Only replace the observed legacy rc07.49 primary. Any other selection
 * (including manually chosen releases) wins. No deletion or bulk updates.
 */
export async function publishApprovedRc07555(client, env = process.env) {
  if (!isProduction(env)) return 'not-production';

  const state = (await client.query('SELECT * FROM app_release_selection WHERE singleton=TRUE FOR UPDATE')).rows[0];
  if (!state?.initialized || !state.primary_id) return 'no-primary';
  const current = (await client.query('SELECT * FROM app_release_catalog WHERE id=$1', [state.primary_id])).rows[0];
  if (!current) return 'no-primary';
  if (Number(current.version_code) === APPROVED_RC07555.versionCode) return 'already-approved';

  // Explicitly preserve every newer/changed administrator-selected release.
  if (Number(current.version_code) !== LEGACY_RC0749.versionCode ||
      current.version_name !== LEGACY_RC0749.versionName ||
      current.download_url !== LEGACY_RC0749.downloadUrl) return 'selection-changed';

  const prior = await client.query('SELECT 1 FROM app_release_audit WHERE action=$1 LIMIT 1', [RC07555_PUBLICATION_ACTION]);
  if (prior.rows.length) return 'already-recorded';

  async function audit(outcome, releaseId = current.id) {
    await client.query('INSERT INTO app_release_audit(action,release_id,details) VALUES($1,$2,$3::jsonb)', [
      RC07555_PUBLICATION_ACTION,
      releaseId,
      JSON.stringify({
        outcome,
        previousPrimaryId: current.id,
        previousVersionCode: LEGACY_RC0749.versionCode,
        versionCode: APPROVED_RC07555.versionCode
      })
    ]);
    return outcome;
  }

  let target = (await client.query('SELECT * FROM app_release_catalog WHERE version_code=$1 FOR UPDATE',
    [APPROVED_RC07555.versionCode])).rows[0];
  if (target && (
    target.version_name !== APPROVED_RC07555.versionName ||
    target.download_url !== APPROVED_RC07555.downloadUrl ||
    target.channel !== APPROVED_RC07555.channel ||
    Number(target.min_supported_version_code) !== APPROVED_RC07555.minSupportedVersionCode
  )) return audit('release-conflict', target.id);

  if (!target) {
    const total = await client.query('SELECT COUNT(*)::int AS count FROM app_release_catalog');
    if (Number(total.rows[0].count) >= 200) return audit('catalog-full');
    target = (await client.query(
      'INSERT INTO app_release_catalog(id,channel,version_code,version_name,download_url,release_notes,min_supported_version_code) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [crypto.randomUUID(), APPROVED_RC07555.channel, APPROVED_RC07555.versionCode,
        APPROVED_RC07555.versionName, APPROVED_RC07555.downloadUrl, APPROVED_RC07555.releaseNotes,
        APPROVED_RC07555.minSupportedVersionCode]
    )).rows[0];
  }

  await client.query('UPDATE app_release_selection SET primary_id=$1,revision=revision+1 WHERE singleton=TRUE', [target.id]);
  return audit('published', target.id);
}

import crypto from 'node:crypto';

// One explicit owner-approved publication, not an automatic "latest GitHub" policy.
export const APPROVED_RC0742 = Object.freeze({
  versionCode: 2000053,
  versionName: '2.0.0-rc07.42',
  channel: 'testing',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.42/BLOFY-PLAYER-2.0-rc07.42-signed.apk',
  sha256: 'ded52c0abc0408e592feed82b5bafd214f4de9f1ad083b003330eab9f721dd58',
  minSupportedVersionCode: 1,
  releaseNotes: 'BLOFY PLAYER 42 — تحسين تحديث قوائم الموقع يدويًا ومعالجة القوائم الجزئية مع الحفاظ على المحتوى المحفوظ. التحديث اختياري. إذا تعذر التحديث من إصدار 38 أو 39، حمّل APK من الموقع وثبّته فوق النسخة الحالية دون حذف التطبيق.'
});
export const RC0742_PUBLICATION_ACTION = 'publish_rc0742_20260913';
const previousUrl = 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.40/BLOFY-PLAYER-2.0-rc07.40-signed.apk';

/** Called inside the catalogue's existing transaction and first-use advisory lock.
 * Preview/CI never publish. Audit and selection commit together. A later admin
 * rollback, deletion or new selection is never reversed by a cold start.
 */
export async function publishApprovedRc0742(client, environment = process.env.VERCEL_ENV) {
  if (environment !== 'production') return 'not-production';
  const state = (await client.query('SELECT * FROM app_release_selection WHERE singleton=TRUE FOR UPDATE')).rows[0];
  const done = await client.query('SELECT 1 FROM app_release_audit WHERE action=$1 LIMIT 1', [RC0742_PUBLICATION_ACTION]);
  if (done.rows.length) return 'already-recorded';
  const current = state?.primary_id ? (await client.query('SELECT * FROM app_release_catalog WHERE id=$1', [state.primary_id])).rows[0] : null;
  async function record(outcome, releaseId = current?.id || crypto.randomUUID()) {
    await client.query('INSERT INTO app_release_audit(action,release_id,details) VALUES($1,$2,$3::jsonb)',
      [RC0742_PUBLICATION_ACTION, releaseId, JSON.stringify({ outcome, previousPrimaryId: state?.primary_id || null,
        versionCode: APPROVED_RC0742.versionCode, sha256: APPROVED_RC0742.sha256 })]);
    return outcome;
  }
  // Compare against the observed production selection; do not overwrite concurrent admin intent.
  if (!current || Number(current.version_code) !== 2000051 || current.version_name !== '2.0.0-rc07.40' || current.download_url !== previousUrl) {
    return record('skipped-selection-changed');
  }
  let target = (await client.query('SELECT * FROM app_release_catalog WHERE version_code=$1 FOR UPDATE', [APPROVED_RC0742.versionCode])).rows[0];
  if (target && (target.version_name !== APPROVED_RC0742.versionName || target.download_url !== APPROVED_RC0742.downloadUrl ||
      target.channel !== APPROVED_RC0742.channel || Number(target.min_supported_version_code) !== 1)) {
    return record('skipped-release-conflict', target.id);
  }
  if (!target) {
    const count = (await client.query('SELECT COUNT(*)::int AS count FROM app_release_catalog')).rows[0].count;
    if (count >= 200) return record('skipped-catalog-full');
    target = (await client.query(`INSERT INTO app_release_catalog(id,channel,version_code,version_name,download_url,release_notes,min_supported_version_code)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [crypto.randomUUID(), APPROVED_RC0742.channel, APPROVED_RC0742.versionCode,
      APPROVED_RC0742.versionName, APPROVED_RC0742.downloadUrl, APPROVED_RC0742.releaseNotes, APPROVED_RC0742.minSupportedVersionCode])).rows[0];
  }
  await client.query('UPDATE app_release_selection SET primary_id=$1,revision=revision+1 WHERE singleton=TRUE', [target.id]);
  return record('published', target.id);
}

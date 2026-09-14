import crypto from 'node:crypto';
import { publishApprovedRc0747 } from './approved-release-rc0747.mjs';

// One explicit owner-approved publication. Never follow GitHub "latest" automatically.
export const APPROVED_RC0746 = Object.freeze({
  versionCode: 2000057,
  versionName: '2.0.0-rc07.46',
  channel: 'testing',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.46/BLOFY-PLAYER-2.0-rc07.46-signed.apk',
  sha256: '4130e95b65228db9ec56741c09ba00fca74f216b7a8b29d2bd19709a4fcc1663',
  minSupportedVersionCode: 1,
  releaseNotes: 'BLOFY PLAYER 46 — تحسين حماية بيانات الدخول واستعادة الرخصة والخصوصية وحذف البيانات والتشخيص الاختياري، مع تحقق دوري من الرخصة وتجربة أكثر ثباتًا. تم التحقق من الترقية فوق النسخ المتوافقة ومن التوقيع وFFmpeg ودعم 16 KB. ثبّت التحديث فوق النسخة الحالية دون حذف التطبيق أو البيانات.'
});

export const RC0746_PUBLICATION_ACTION = 'publish_rc0746_20260914';
const previousUrl = 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.45/BLOFY-PLAYER-2.0-rc07.45-signed.apk';
const shouldPublishRc0747 = () => process.env.BLOFY_ENABLE_RC0747_PUBLICATION === 'true';

/**
 * Publish rc07.46 only when production is still exactly on the observed rc07.45
 * primary. A later administrator selection wins permanently. Audit and selection
 * are committed by the release catalogue's existing transaction.
 */
export async function publishApprovedRc0746(client, environment = process.env.VERCEL_ENV) {
  if (environment !== 'production') return 'not-production';

  const state = (await client.query('SELECT * FROM app_release_selection WHERE singleton=TRUE FOR UPDATE')).rows[0];
  const done = await client.query('SELECT 1 FROM app_release_audit WHERE action=$1 LIMIT 1', [RC0746_PUBLICATION_ACTION]);
  if (done.rows.length) {
    if (shouldPublishRc0747()) await publishApprovedRc0747(client, environment);
    return 'already-recorded';
  }

  const current = state?.primary_id
    ? (await client.query('SELECT * FROM app_release_catalog WHERE id=$1', [state.primary_id])).rows[0]
    : null;

  async function record(outcome, releaseId = current?.id || crypto.randomUUID()) {
    await client.query('INSERT INTO app_release_audit(action,release_id,details) VALUES($1,$2,$3::jsonb)', [
      RC0746_PUBLICATION_ACTION,
      releaseId,
      JSON.stringify({
        outcome,
        previousPrimaryId: state?.primary_id || null,
        versionCode: APPROVED_RC0746.versionCode,
        sha256: APPROVED_RC0746.sha256
      })
    ]);
    return outcome;
  }

  if (!current || Number(current.version_code) !== 2000056 || current.version_name !== '2.0.0-rc07.45' || current.download_url !== previousUrl) {
    return record('skipped-selection-changed');
  }

  let target = (await client.query('SELECT * FROM app_release_catalog WHERE version_code=$1 FOR UPDATE', [APPROVED_RC0746.versionCode])).rows[0];
  if (target && (
    target.version_name !== APPROVED_RC0746.versionName ||
    target.download_url !== APPROVED_RC0746.downloadUrl ||
    target.channel !== APPROVED_RC0746.channel ||
    Number(target.min_supported_version_code) !== APPROVED_RC0746.minSupportedVersionCode
  )) {
    return record('skipped-release-conflict', target.id);
  }

  if (!target) {
    const count = (await client.query('SELECT COUNT(*)::int AS count FROM app_release_catalog')).rows[0].count;
    if (count >= 200) return record('skipped-catalog-full');
    target = (await client.query(`INSERT INTO app_release_catalog(id,channel,version_code,version_name,download_url,release_notes,min_supported_version_code)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
      crypto.randomUUID(),
      APPROVED_RC0746.channel,
      APPROVED_RC0746.versionCode,
      APPROVED_RC0746.versionName,
      APPROVED_RC0746.downloadUrl,
      APPROVED_RC0746.releaseNotes,
      APPROVED_RC0746.minSupportedVersionCode
    ])).rows[0];
  }

  await client.query('UPDATE app_release_selection SET primary_id=$1,revision=revision+1 WHERE singleton=TRUE', [target.id]);
  const outcome = await record('published', target.id);
  if (shouldPublishRc0747()) await publishApprovedRc0747(client, environment);
  return outcome;
}

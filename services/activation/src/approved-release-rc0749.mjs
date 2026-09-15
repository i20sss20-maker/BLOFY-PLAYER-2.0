import crypto from 'node:crypto';

// One explicit owner-approved publication. Never follow GitHub "latest" automatically.
export const APPROVED_RC0749 = Object.freeze({
  versionCode: 2000060,
  versionName: '2.0.0-rc07.49',
  channel: 'testing',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.49/BLOFY-PLAYER-2.0-rc07.49-signed.apk',
  sha256: '17d69c35f4424e992ada24e6d4bd969074904d9cf3bd1b3256d63601778b1505',
  minSupportedVersionCode: 1,
  releaseNotes: 'BLOFY PLAYER 49 — نسخة الإصدار 46 الثابتة كما هي، برقم إصدار أعلى حتى تتثبت كتحديث مباشر فوق 48 بدون حذف بيانات العميل. تم التحقق من اسم الحزمة وشهادة الإنتاج والتوافق المباشر مع الإصدار السابق.'
});

export const RC0749_PUBLICATION_ACTION = 'publish_rc0749_20260915';
const APPROVED_RC0748_PRIMARY = Object.freeze({
  versionCode: 2000059,
  versionName: '2.0.0-rc07.48',
  downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.48/BLOFY-PLAYER-2.0-rc07.48-signed.apk'
});

/**
 * Publish rc07.49 only when production is still exactly on the approved rc07.48
 * primary. A later administrator selection wins permanently.
 */
export async function publishApprovedRc0749(client, environment = process.env.VERCEL_ENV) {
  if (environment !== 'production') return 'not-production';

  const state = (await client.query('SELECT * FROM app_release_selection WHERE singleton=TRUE FOR UPDATE')).rows[0];
  const done = await client.query('SELECT 1 FROM app_release_audit WHERE action=$1 LIMIT 1', [RC0749_PUBLICATION_ACTION]);
  if (done.rows.length) return 'already-recorded';

  const current = state?.primary_id
    ? (await client.query('SELECT * FROM app_release_catalog WHERE id=$1', [state.primary_id])).rows[0]
    : null;

  async function record(outcome, releaseId = current?.id || crypto.randomUUID()) {
    await client.query('INSERT INTO app_release_audit(action,release_id,details) VALUES($1,$2,$3::jsonb)', [
      RC0749_PUBLICATION_ACTION,
      releaseId,
      JSON.stringify({
        outcome,
        previousPrimaryId: state?.primary_id || null,
        versionCode: APPROVED_RC0749.versionCode,
        sha256: APPROVED_RC0749.sha256
      })
    ]);
    return outcome;
  }

  if (current && Number(current.version_code) === APPROVED_RC0749.versionCode &&
      current.version_name === APPROVED_RC0749.versionName && current.download_url === APPROVED_RC0749.downloadUrl) {
    return record('already-primary', current.id);
  }

  if (!current || Number(current.version_code) !== APPROVED_RC0748_PRIMARY.versionCode ||
      current.version_name !== APPROVED_RC0748_PRIMARY.versionName || current.download_url !== APPROVED_RC0748_PRIMARY.downloadUrl) {
    return record('skipped-selection-changed');
  }

  let target = (await client.query('SELECT * FROM app_release_catalog WHERE version_code=$1 FOR UPDATE', [APPROVED_RC0749.versionCode])).rows[0];
  if (target && (
    target.version_name !== APPROVED_RC0749.versionName ||
    target.download_url !== APPROVED_RC0749.downloadUrl ||
    target.channel !== APPROVED_RC0749.channel ||
    Number(target.min_supported_version_code) !== APPROVED_RC0749.minSupportedVersionCode
  )) {
    return record('skipped-release-conflict', target.id);
  }

  if (!target) {
    const count = (await client.query('SELECT COUNT(*)::int AS count FROM app_release_catalog')).rows[0].count;
    if (count >= 200) return record('skipped-catalog-full');
    target = (await client.query(`INSERT INTO app_release_catalog(id,channel,version_code,version_name,download_url,release_notes,min_supported_version_code)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
      crypto.randomUUID(),
      APPROVED_RC0749.channel,
      APPROVED_RC0749.versionCode,
      APPROVED_RC0749.versionName,
      APPROVED_RC0749.downloadUrl,
      APPROVED_RC0749.releaseNotes,
      APPROVED_RC0749.minSupportedVersionCode
    ])).rows[0];
  }

  await client.query('UPDATE app_release_selection SET primary_id=$1,revision=revision+1 WHERE singleton=TRUE', [target.id]);
  return record('published', target.id);
}

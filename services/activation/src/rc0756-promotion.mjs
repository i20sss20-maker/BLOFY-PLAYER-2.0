import pg from 'pg';
import { databaseOptions } from './database-options.mjs';
import { createReleaseCatalog } from './release-catalog.mjs';

if (process.env.BLOFY_RC0756_PROMOTE === '1') {
  const pool = new pg.Pool(databaseOptions(process.env.DATABASE_URL, { max: 1 }));
  try {
    const catalog = createReleaseCatalog(pool);
    const release = {
      channel: 'testing',
      versionCode: 2000068,
      versionName: '2.0.0-rc07.56',
      minSupportedVersionCode: 1,
      downloadUrl: 'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/v2.0.0-rc07.56/BLOFY-PLAYER-2.0-rc07.56-PRODUCTION-SIGNED.apk',
      releaseNotes: 'BLOFY PLAYER 2.0.0-rc07.56 — نقل نقاط الاتصال الإنتاجية إلى نطاقات BLOFY على Railway: التفعيل عبر api.blofyplayer.com والتحديثات عبر updates.blofyplayer.com. مبني فوق rc07.55 بدون تغيير Media3 أو FFmpeg أو fallback أو محركات التشغيل أو الثيم.'
    };

    let state = await catalog.list();
    const previousPrimary = state.items.find(item => item.isPrimary)?.versionCode ?? null;
    let item = state.items.find(entry => entry.versionCode === release.versionCode);

    if (!item) {
      await catalog.mutate('create', null, release);
      state = await catalog.list();
      item = state.items.find(entry => entry.versionCode === release.versionCode);
    } else {
      await catalog.mutate('update', item.id, { ...release, expectedRevision: item.revision });
      state = await catalog.list();
      item = state.items.find(entry => entry.versionCode === release.versionCode);
    }

    if (!item) throw new Error('rc0756_release_missing_after_upsert');
    if (!item.isPrimary) {
      await catalog.mutate('primary', item.id, {
        expectedRevision: item.revision,
        expectedSelectionRevision: state.selectionRevision
      });
    }

    const finalState = await catalog.list();
    const finalPrimary = finalState.items.find(entry => entry.isPrimary);
    if (finalPrimary?.versionCode !== 2000068) throw new Error('rc0756_primary_not_applied');
    console.log(`BLOFY_RC0756_CATALOG_PROMOTED before=${previousPrimary ?? 'none'} after=${finalPrimary.versionCode}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

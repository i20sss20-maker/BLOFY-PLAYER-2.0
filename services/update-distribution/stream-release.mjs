// Independent BLOFY STREAM public release; never share PLAYER update feed.
// Local, hash-verified signed APK imported to the existing Railway persistent volume.
export const STREAM_PREVIOUS_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.32-AUDIO-SYNC-SIGNED.apk';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.34-NEXTGEN-FOCUS-DOWNLOADS-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL = 'https://updates.blofyplayer.com/files/releases/BLOFY-STREAM-55.8.34-NEXTGEN-FOCUS-DOWNLOADS-OWNER-SIGNED.apk';
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

// Optional installer-only version. Never use in the stable updater feed.
export const STREAM_TEST_FILENAME = 'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk';
export const STREAM_TEST_PATH = '/d/blofy-stream/foxfm-test';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '55.8.34' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;
  return { release: { app: {
    versionCode: 2000111,
    versionName: '2.0.0-rc07.55.8.34-STREAM',
    minSupportedVersionCode: 1,
    packageName: 'tv.blofy.player.v2.stream',
    sha256: '434ef88377f01c91a1a9d6a104a4c6a11acac586c9297e3ec56686ce2dbc1b23',
    apkSizeBytes: 135755814,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 55.8.34 — المرحلة الأولى من NEXT GENERATION: نوافذ مستقلة للقنوات والبحث، تحسين التنقل بالريموت واستعادة موضع القناة والحلقة، تقليل وميض الرئيسية، تحسين معالجة التنزيلات وتعليق حفظ تحديث المكتبة عند 95%. مع الحفاظ على مشغل FFmpeg والتفعيل والكود. هذه المرحلة ليست إعادة التصميم الكاملة، وينصح باختبار التوافق على جهازك.'
  }}};
}

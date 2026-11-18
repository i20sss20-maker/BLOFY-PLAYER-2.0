// Independent BLOFY STREAM public release; never share PLAYER update feed.
// Local, hash-verified signed APK imported to the existing Railway persistent volume.
export const STREAM_PREVIOUS_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-56.0-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL = 'https://updates.blofyplayer.com/files/releases/BLOFY-STREAM-56.0-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

// Optional installer-only version. Never use in the stable updater feed.
export const STREAM_TEST_FILENAME = 'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk';
export const STREAM_TEST_PATH = '/d/blofy-stream/foxfm-test';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '56.0' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;
  return { release: { app: {
    versionCode: 2000115,
    versionName: '2.0.0-rc07.56.0-STREAM',
    minSupportedVersionCode: 1,
    packageName: 'tv.blofy.player.v2.stream',
    sha256: 'bba9e340d50c95ab8ab9e1c42f96bef8f2d676dee888e975d7a161f2027d8064',
    apkSizeBytes: 135783643,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 56.0 — تحديث تدريجي وسريع للمحتوى من سيرفر BLOFY، تحديث الحلقات الجديدة تلقائيًا دون حذف المكتبة السابقة، زر تحديث المحتوى من الإعدادات، تحسين استقرار تشغيل الفيديو وتنقل ريموت Android TV، تحسين البحث والذكاء الاصطناعي، ورسائل واضحة للمستخدم. التحديث يحافظ على كود التفعيل والمفضلة ومكتبة المشاهدة.'
  }}};
}

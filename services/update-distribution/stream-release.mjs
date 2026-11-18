// Independent BLOFY STREAM public release; never share PLAYER update feed.
// Local, hash-verified signed APK imported to the existing Railway persistent volume.
export const STREAM_PREVIOUS_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL = 'https://updates.blofyplayer.com/files/releases/BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk';
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

// Optional installer-only version. Never use in the stable updater feed.
export const STREAM_TEST_FILENAME = 'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk';
export const STREAM_TEST_PATH = '/d/blofy-stream/foxfm-test';
// Keep the signed hotfix testing alias available for direct QA and troubleshooting.
export const STREAM_LIVE_FIX_TEST_FILENAME = 'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk';
export const STREAM_LIVE_FIX_TEST_PATH = '/d/blofy-stream/live-fix-test';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '56.0.1' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;
  return { release: { app: {
    versionCode: 2000116,
    versionName: '2.0.0-rc07.56.0.1-STREAM',
    minSupportedVersionCode: 1,
    packageName: 'tv.blofy.player.v2.stream',
    sha256: '02d40e3748f0d75905f734ad429ef16994d87a7068280e567d8da9339932e89a',
    apkSizeBytes: 135785176,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 56.0.1 — إصلاح انقطاع البث المباشر وإعادة الاتصال، مع تحديث تدريجي وسريع للمحتوى من سيرفر BLOFY، تحديث الحلقات الجديدة تلقائيًا دون حذف المكتبة السابقة، زر تحديث المحتوى من الإعدادات، تحسين استقرار تشغيل الفيديو وتنقل ريموت Android TV، تحسين البحث والذكاء الاصطناعي، ورسائل واضحة للمستخدم. التحديث يحافظ على كود التفعيل والمفضلة ومكتبة المشاهدة.'
  }}};
}

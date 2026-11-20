// Independent BLOFY STREAM public release; never share PLAYER update feed.
// Local, hash-verified signed APK imported to the existing Railway persistent volume.
export const STREAM_PREVIOUS_RELEASE_FILENAME = 'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-56.0.2-AUTO-CATALOG-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL = 'https://updates.blofyplayer.com/files/releases/BLOFY-STREAM-56.0.2-AUTO-CATALOG-FIX-OWNER-SIGNED.apk';
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

// Optional installer-only version. Never use in the stable updater feed.
export const STREAM_TEST_FILENAME = 'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk';
export const STREAM_TEST_PATH = '/d/blofy-stream/foxfm-test';
// Keep the signed hotfix testing alias available for direct QA and troubleshooting.
export const STREAM_LIVE_FIX_TEST_FILENAME = 'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk';
export const STREAM_LIVE_FIX_TEST_PATH = '/d/blofy-stream/live-fix-test';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '56.0.2' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;
  return { release: { app: {
    versionCode: 2000117,
    versionName: '2.0.0-rc07.56.0.2-STREAM',
    minSupportedVersionCode: 1,
    packageName: 'tv.blofy.player.v2.stream',
    sha256: '9a3037936b374b3e62e2bc06f4f9fe8b5a3a64441c249c8cf00d78944c58876a',
    apkSizeBytes: 135787039,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 56.0.2 — تحديث المحتوى تلقائياً في الخلفية بفحص دوري وفتح التطبيق، مع تنزيل التغييرات فقط، وزر تحديث المحتوى داخل الإعدادات يعرض دائرة تحميل وحالة التحديث ونتيجة النجاح أو الخطأ دون الانتقال لشاشة أخرى. تحسين التعامل مع انقطاع Xtream مع حفظ المكتبة والبوسترات السابقة، وعدم التأثير على تشغيل الفيديو. يحتفظ التطبيق بكود التفعيل والمفضلة ومعلومات المشاهدة، ويتطلب توفر الإنترنت والتحديثات على مصدر المحتوى.'
  }}};
}

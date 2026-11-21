// Independent BLOFY STREAM public release; never share PLAYER update feed.
// Local, hash-verified signed APK imported to the existing Railway persistent volume.
export const STREAM_PREVIOUS_RELEASE_FILENAME = 'BLOFY-STREAM-56.0.2-AUTO-CATALOG-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-56.0.3-REFRESH-STALL-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL = 'https://updates.blofyplayer.com/files/releases/BLOFY-STREAM-56.0.3-REFRESH-STALL-FIX-OWNER-SIGNED.apk';
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

// Optional installer-only version. Never use in the stable updater feed.
export const STREAM_TEST_FILENAME = 'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk';
export const STREAM_TEST_PATH = '/d/blofy-stream/foxfm-test';
// Keep the signed hotfix testing alias available for direct QA and troubleshooting.
export const STREAM_LIVE_FIX_TEST_FILENAME = 'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk';
export const STREAM_LIVE_FIX_TEST_PATH = '/d/blofy-stream/live-fix-test';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '56.0.3' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;
  return { release: { app: {
    versionCode: 2000118,
    versionName: '2.0.0-rc07.56.0.3-STREAM',
    minSupportedVersionCode: 1,
    packageName: 'tv.blofy.player.v2.stream',
    sha256: 'a43c8041becaac1f6c3de91f68b436c0ff844c9b6c74e571a6484bc3ab2537c9',
    apkSizeBytes: 135792516,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 56.0.3 — معالجة تعليق تحديث المحتوى على دائرة التحميل: فحص يدوي داخل الإعدادات لمدة محدودة ثم تحديث في الخلفية، مع إبقاء المكتبة والمشاهدة مستمرتين. تحسين ظهور بوسترات الأفلام والمسلسلات بالاعتماد على أغلفة بديلة ومعلومات الصور المحفوظة ودعم روابط الصور ذات المسافات. فحوص تلقائية للمحتوى دون الحاجة لتدخل العميل، وتحسين سياسة إعادة المحاولة عند بطء Xtream، والحفاظ على كود التفعيل والمفضلة والبيانات السابقة.'
  }}};
}

// Independent BLOFY STREAM public release; never share PLAYER update feed.
// Local, hash-verified signed APK imported to the existing Railway persistent volume.
export const STREAM_PREVIOUS_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.34-NEXTGEN-FOCUS-DOWNLOADS-OWNER-SIGNED.apk';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL = 'https://updates.blofyplayer.com/files/releases/BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

// Optional installer-only version. Never use in the stable updater feed.
export const STREAM_TEST_FILENAME = 'BLOFY-STREAM-55.8.33-FOXFm-APP-ONLY-OWNER-SIGNED.apk';
export const STREAM_TEST_PATH = '/d/blofy-stream/foxfm-test';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '55.8.36' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;
  return { release: { app: {
    versionCode: 2000113,
    versionName: '2.0.0-rc07.55.8.36-STREAM',
    minSupportedVersionCode: 1,
    packageName: 'tv.blofy.player.v2.stream',
    sha256: '2f5abba6d367d41fd9bab71cb8355f234678a8d715c4bebff899760642bf474e',
    apkSizeBytes: 135775044,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 55.8.36 — تحديث المحتوى تلقائيًا وبصمت عند الدخول، متابعة الحلقات الجديدة دون تعطيل المشاهدة، إصلاح حركة ريموت Android TV والتقديم والتأخير، أزرار مشغل VLC، وإصلاح البحث بالذكاء الاصطناعي لفتح الفيلم أو المسلسل مباشرة مع 60 اقتراحًا جاهزًا. نسخة موقعة بشهادة التطبيق الأصلية، وتحتفظ بالمكتبة السابقة عند فشل تحديث المصدر.'
  }}};
}

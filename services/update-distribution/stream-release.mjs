// Standalone BLOFY STREAM release identity. It must never reuse the PLAYER update feed.
// Only expose an update when the website catalog points at the exact, published,
// owner-signed STREAM APK; a missing or overridden source fails closed.
// The signed package is imported into Railway's persistent volume and
// SHA-checked before making it available to customers via the same website.
export const STREAM_RELEASE_TAG = 'railway-verified-55.8.32-20261116';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.32-AUDIO-SYNC-SIGNED.apk';
export const STREAM_RELEASE_URL =
  'https://updates.blofyplayer.com/files/releases/' + STREAM_RELEASE_FILENAME;
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '55.8.32' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;

  return { release: { app: {
    versionCode: 2000109,
    versionName: '2.0.0-rc07.55.8.32-STREAM',
    minSupportedVersionCode: 1,
    // The Android updater refuses anything lacking the exact application ID,
    // signed owner APK SHA-256, and expected size. This also prevents mixing
    // BLOFY PLAYER and STREAM even when both exist on the same device.
    packageName: 'tv.blofy.player.v2.stream',
    sha256: '9a87ee2e66496b553332960edf071f3130173f66f9f19fe1c8bbee0a5ee58d91',
    apkSizeBytes: 135739422,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 55.8.32 — تحسين عدد القنوات الظاهرة وتثبيت أزرار التحكم بالأسفل، دعم تقديم وتأخير التعليق الصوتي بالثواني مع معالجة الرجوع للصوت في المصادر الحية غير القابلة للبحث. المحافظة على تشغيل الصورة والريموت ومصادر التفعيل.'
  }}};
}

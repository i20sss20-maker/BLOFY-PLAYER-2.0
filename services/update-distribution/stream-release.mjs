// Standalone BLOFY STREAM release identity. It must never reuse the PLAYER update feed.
// Only expose an update when the website catalog points at the exact, published,
// owner-signed STREAM APK; a missing or overridden source fails closed.
export const STREAM_RELEASE_TAG = 'blofy-stream-55.8.24-owner-qa-20261113';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.24-FFMPEG-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' +
  STREAM_RELEASE_TAG + '/' + STREAM_RELEASE_FILENAME;
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '55.8.24' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;

  return { release: { app: {
    versionCode: 2000101,
    versionName: '2.0.0-rc07.55.8.24-STREAM',
    minSupportedVersionCode: 1,
    // The Android updater refuses anything lacking the exact application ID,
    // signed owner APK SHA-256, and expected size. This also prevents mixing
    // BLOFY PLAYER and STREAM even when both exist on the same device.
    packageName: 'tv.blofy.player.v2.stream',
    sha256: 'a5af6253ad816d325af9a1f32bc5b03cef9a6cd0f5dc6e8ca3f861dd1325b00d',
    apkSizeBytes: 135682806,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 55.8.24 — فصل BLOFY AI في شاشة محادثة مستقلة مع أسماء أفلام ومسلسلات قابلة للضغط لفتح البحث المحلي، والبحث العادي مستقل. حذف زر قائمتي من تفاصيل المحتوى مع بقاء المفضلة والمشاهدة والتحميل. تحسينات ثبات الشاشة واللغة والصوت والتحديثات مع الحفاظ على التفعيل.'
  }}};
}

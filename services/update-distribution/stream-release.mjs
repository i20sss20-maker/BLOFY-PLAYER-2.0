// Independent BLOFY STREAM public release; never share PLAYER update feed.
// Local, hash-verified signed APK imported to the existing Railway persistent volume.
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.32-AUDIO-SYNC-SIGNED.apk';
export const STREAM_RELEASE_URL = 'https://updates.blofyplayer.com/files/releases/BLOFY-STREAM-55.8.32-AUDIO-SYNC-SIGNED.apk';
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '55.8.32' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;
  return { release: { app: {
    versionCode: 2000109,
    versionName: '2.0.0-rc07.55.8.32-STREAM',
    minSupportedVersionCode: 1,
    packageName: 'tv.blofy.player.v2.stream',
    sha256: '9a87ee2e66496b553332960edf071f3130173f66f9f19fe1c8bbee0a5ee58d91',
    apkSizeBytes: 135739422,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 55.8.32 — إصلاح تقديم وتأخير صوت المعلق لمصادر البث الحي، خيارات ±1 و±5 ثوانٍ، عرض قنوات أكثر وأزرار التحكم أسفل القائمة، تحسين حركة الريموت، استبدال أسماء ANES الظاهرة باسم BLOFY. المحافظة على التفعيل ومشغل البث ونسخة BLOFY PLAYER المستقلة.'
  }}};
}

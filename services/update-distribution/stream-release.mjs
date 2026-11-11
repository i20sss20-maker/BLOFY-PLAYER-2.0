// Standalone BLOFY STREAM release identity. It must never reuse the PLAYER update feed.
// Only expose an update when the website catalog points at the exact, published,
// owner-signed STREAM APK; a missing or overridden source fails closed.
export const STREAM_RELEASE_TAG = 'blofy-stream-55.8.11-owner-signed-20261111';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.11-FFMPEG-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' +
  STREAM_RELEASE_TAG + '/' + STREAM_RELEASE_FILENAME;
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '55.8.11' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;

  return { release: { app: {
    versionCode: 2000088,
    versionName: '2.0.0-rc07.55.8.11-STREAM',
    minSupportedVersionCode: 1,
    // The Android updater refuses anything lacking the exact application ID,
    // signed owner APK SHA-256, and expected size. This also prevents mixing
    // BLOFY PLAYER and STREAM even when both exist on the same device.
    packageName: 'tv.blofy.player.v2.stream',
    sha256: 'f29333559ed510050e3dd08347f0ae4d6d1193141484080e1d47e56fba6ba17e',
    apkSizeBytes: 292310844,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 55.8.11: Film genres remain consistent when switching between All Movies and specific categories, without progressive changes while browsing. Arabic titles, local translation, FFmpeg audio and safe in-app updates. Existing code activation and local catalog remain on the device.'
  }}};
}

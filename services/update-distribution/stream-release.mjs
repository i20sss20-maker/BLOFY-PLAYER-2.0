// Standalone BLOFY STREAM release identity. It must never reuse the PLAYER update feed.
// Only expose an update when the website catalog points at the exact, published,
// owner-signed STREAM APK; a missing or overridden source fails closed.
export const STREAM_RELEASE_TAG = 'blofy-stream-55.8.10-owner-signed-20261111';
export const STREAM_RELEASE_FILENAME = 'BLOFY-STREAM-55.8.10-FFMPEG-OWNER-SIGNED.apk';
export const STREAM_RELEASE_URL =
  'https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/' +
  STREAM_RELEASE_TAG + '/' + STREAM_RELEASE_FILENAME;
export const STREAM_PUBLIC_DOWNLOAD = 'https://updates.blofyplayer.com/d/blofy-stream';

export function streamReleaseMetadata(app) {
  if (!app || app.slug !== 'blofy-stream' || app.enabled !== true ||
      app.version !== '55.8.10' || app.downloadUrl !== STREAM_RELEASE_URL ||
      app.downloadMode !== 'direct') return null;

  return { release: { app: {
    versionCode: 2000087,
    versionName: '2.0.0-rc07.55.8.10-STREAM',
    minSupportedVersionCode: 1,
    downloadUrl: STREAM_PUBLIC_DOWNLOAD,
    releaseNotes: 'BLOFY STREAM 55.8.10: Movie genre is shown beneath each poster title like TV series (without the top filter), Arabic title/description support, FFmpeg audio and safe updates. Existing code activation and local catalog remain on the device.'
  }}};
}

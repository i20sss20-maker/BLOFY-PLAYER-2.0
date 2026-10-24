import { activationReleaseMetadata } from './release-metadata.mjs';

/** Shared public view: the download URL and existing Android /health contract use one selection. */
export function createReleasePublicHandlers({ pool, json, catalog, metadata = activationReleaseMetadata() }) {
  async function handle(req, res, url) {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/health') {
      try {
        await pool.query('SELECT 1');
        let app = metadata.app;
        let catalogReady = true;
        try { app = await catalog.appRelease(); } catch { catalogReady = false; }
        json(res, 200, { ok: true, database: 'ready', playlistEncryption: 'ready',
          release: { ...metadata, app }, releaseCatalog: catalogReady ? 'ready' : 'unavailable', time: Date.now() });
      } catch {
        json(res, 503, { ok: false, database: 'unavailable', release: metadata, time: Date.now() });
      }
      return true;
    }
    if (req.method === 'GET' && path === '/api/v1/releases/owner-test') {
      // Separate from the persisted public release catalog and /download/latest.apk:
      // only a verified, published GitHub prerelease asset can enable the test button.
      try {
        const response = await fetch(
          'https://api.github.com/repos/i20sss20-maker/BLOFY-PLAYER-2.0/releases/tags/blofy-android-tv-2000073-owner-test',
          { headers: { accept: 'application/vnd.github+json', 'user-agent': 'BLOFY-OWNER-TEST' },
            signal: AbortSignal.timeout(7000) }
        );
        if (response.status === 404) {
          json(res, 200, { ready: false, message: 'signed_apk_not_published' }); return true;
        }
        if (!response.ok) throw new Error('release_lookup_failed');
        const release = await response.json();
        const filename = 'BLOFY-PLAYER-ANDROID-TV-2000073-SIGNED-TEST.apk';
        const asset = release.assets?.find(item => item.name === filename && item.size > 10_000_000);
        if (!release.prerelease || release.draft || !asset ||
            !asset.browser_download_url?.startsWith('https://github.com/i20sss20-maker/BLOFY-PLAYER-2.0/releases/download/')) {
          json(res, 200, { ready: false, message: 'signed_apk_not_published' }); return true;
        }
        json(res, 200, { ready: true, filename, downloadUrl: asset.browser_download_url,
          sizeBytes: asset.size, releaseTag: release.tag_name });
      } catch {
        json(res, 503, { ready: false, message: 'release_check_unavailable' });
      }
      return true;
    }
    if (req.method === 'GET' && path === '/api/v1/releases') {
      json(res, 200, await catalog.list()); return true;
    }
    if (['GET', 'HEAD'].includes(req.method) && path === '/download/latest.apk') {
      const release = await catalog.appRelease();
      res.writeHead(302, { location: release.downloadUrl, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      res.end(); return true;
    }
    return false;
  }
  return { handle };
}

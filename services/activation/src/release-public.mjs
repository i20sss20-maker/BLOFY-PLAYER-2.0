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

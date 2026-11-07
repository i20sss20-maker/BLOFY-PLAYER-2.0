// Fixed private engine locator. Never accept client-supplied upstream URLs.
export function normalizePrivateRestreamOrigin(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !/^[a-z0-9-]+\.railway\.internal$/i.test(url.hostname) ||
      !/^\d{2,5}$/.test(url.port) || Number(url.port) < 1024 ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('blofy_restream_engine_invalid_private_url');
  }
  return url.origin;
}

export function publicRestreamState({configured=false,responded=false,httpStatus=null,elapsedMs=null}={}) {
  return {
    configured: Boolean(configured),
    connected: Boolean(responded),
    state: !configured ? 'not_configured' : responded ? 'online' : 'unreachable',
    // A MediaMTX listener may answer 404 on / when no path is published.
    // Transport reachability must not be confused with playable media.
    playbackVerified: false,
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : null
  };
}

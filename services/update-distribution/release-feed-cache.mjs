/**
 * Local, bounded cache for the anonymous STREAM updater catalog.
 *
 * Under a campaign burst, devices ask for exactly the same public version
 * metadata. Coalesce concurrent loads and reduce PostgreSQL read traffic.
 * Never cache private requests, credentials or user entitlements.
 *
 * A previously verified positive feed may be served briefly if a database
 * read fails. An explicit successful null/unpublish invalidates the old
 * value immediately; a failed first read never invents a version.
 */
export function createReleaseFeedCache({
  ttlMs = 10_000,
  staleIfErrorMs = 120_000,
  now = () => Date.now()
} = {}) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60_000 ||
      !Number.isSafeInteger(staleIfErrorMs) ||
      staleIfErrorMs < ttlMs || staleIfErrorMs > 5 * 60_000 ||
      typeof now !== 'function') {
    throw new Error('invalid_release_feed_cache_configuration');
  }
  let cached;
  let hasCache = false;
  let positiveAt = 0;
  let expiresAt = 0;
  let inFlight = null;
  return {
    async get(load) {
      if (typeof load !== 'function') throw new Error('invalid_release_feed_loader');
      if (hasCache && now() < expiresAt) return cached;
      if (inFlight) return inFlight;
      const pending = (async () => {
        try {
          const result = await load();
          // Null is a verified "not published" state and invalidates an old
          // positive entry; do not continue serving an unlisted release.
          cached = result ?? null;
          hasCache = true;
          expiresAt = now() + ttlMs;
          positiveAt = cached === null ? 0 : now();
          return cached;
        } catch (error) {
          if (hasCache && cached !== null && positiveAt > 0 &&
              now() - positiveAt <= staleIfErrorMs) {
            // Avoid hammering an unavailable DB with simultaneous refreshes.
            expiresAt = now() + Math.min(ttlMs, 5_000);
            return cached;
          }
          throw error;
        }
      })();
      inFlight = pending;
      try { return await pending; }
      finally { if (inFlight === pending) inFlight = null; }
    },
    clear() {
      cached = undefined;
      hasCache = false;
      positiveAt = 0;
      expiresAt = 0;
    }
  };
}

/** Public updater metadata only: cache in shared edges for at most 15s,
 * serve the previous verified copy briefly during an origin restart.
 * Browser clients still revalidate immediately (max-age=0).
 */
export const PUBLIC_STREAM_RELEASE_CACHE_CONTROL =
  'public, max-age=0, s-maxage=15, stale-while-revalidate=30, stale-if-error=120';

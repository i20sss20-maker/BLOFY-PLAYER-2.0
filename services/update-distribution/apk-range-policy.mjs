/**
 * Keep APK byte-range responses uncacheable at the CDN edge.
 * Railway's current CDN can key static responses by URL but not by Range.
 * A shared cached 206 body would corrupt a different customer's resumed APK.
 */
export function apkRangePolicy(range, total) {
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error('apk_size_invalid');
  }
  const invalid = {
    status: 416, start: null, end: null, length: 0,
    contentRange: `bytes */${total}`
  };
  if (range == null || String(range).trim() === '') {
    return {status: 200, start: 0, end: total - 1, length: total,
      contentRange: null};
  }
  if (typeof range !== 'string' || range.length > 128) return invalid;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (!match[1] && !match[2])) return invalid;
  let start = 0;
  let end = total - 1;
  if (!match[1]) {
    // 'bytes=-N': last N bytes, never more than the complete file.
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid;
    start = Math.max(0, total - suffix);
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start < 0 || start >= total)
      return invalid;
    if (match[2]) {
      end = Number(match[2]);
      if (!Number.isSafeInteger(end) || end < start) return invalid;
      end = Math.min(end, total - 1);
    }
  }
  return {
    status: 206, start, end, length: end - start + 1,
    contentRange: `bytes ${start}-${end}/${total}`
  };
}

export function apkCacheControl(status) {
  // 206 and 416 must not be cached in a shared CDN. Full immutable-ish
  // files retain the existing short public TTL until object storage cutover.
  return status === 200 ? 'public, max-age=300' :
    'private, no-store, max-age=0, s-maxage=0';
}

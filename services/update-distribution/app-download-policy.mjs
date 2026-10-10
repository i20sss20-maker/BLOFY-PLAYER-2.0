// Explicitly separate third-party official store links from verified direct APK downloads.
// Legacy database entries may have a store URL, not an actual .apk artifact.
// Never bypass the SSRF and binary-response checks in openRemoteApk for direct downloads.
export function appDownloadAction(app) {
  let target;
  try { target = new URL(String(app?.downloadUrl || '')); } catch { return { kind: 'unavailable' }; }
  if (target.protocol !== 'https:' || !target.hostname || target.username || target.password || target.hash) {
    return { kind: 'unavailable' };
  }
  const host = target.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      host === 'metadata.google.internal' || /^[\d.]+$/.test(host) ||
      host.startsWith('[') || host.includes(']')) {
    return { kind: 'unavailable' };
  }
  if (app?.downloadMode === 'official') return { kind: 'official', url: target.href };
  if (app?.downloadMode === 'direct' && /\.apk$/i.test(target.pathname)) {
    return { kind: 'apk', url: target.href };
  }
  return { kind: 'unavailable' };
}

/** Canonicalize only the public www pages; keep legacy download/API/admin paths working. */
export function publicSiteRedirect(host, method, pathname, search = '') {
  const normalizedHost = String(host || '').trim().toLowerCase().replace(/:\\d+$/, '');
  if (normalizedHost !== 'www.blofyplayer.com' || !['GET', 'HEAD'].includes(method)) return null;
  if (!['/', '/downloads', '/downloads/'].includes(pathname)) return null;
  const canonicalPath = pathname === '/' ? '/' : '/downloads';
  return 'https://blofyplayer.com' + canonicalPath + String(search || '');
}

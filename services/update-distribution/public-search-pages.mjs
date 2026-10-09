// Static public metadata for the BLOFY updates/downloads website only.
// Keep activation credentials, admin routes, and APK delivery out of search indexing.
export const UPDATE_SITE_ORIGIN = 'https://updates.blofyplayer.com';
export const UPDATE_SITE_CANONICAL = UPDATE_SITE_ORIGIN + '/';

export function updateRobotsTxt() {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    'Disallow: /download/',
    'Disallow: /files/',
    'Disallow: /d/',
    'Sitemap: ' + UPDATE_SITE_ORIGIN + '/sitemap.xml',
    ''
  ].join('\n');
}

export function updateSitemapXml() {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    '  <url><loc>' + UPDATE_SITE_CANONICAL + '</loc></url>\n' +
    '</urlset>\n';
}

export function renderMissingPublicPage() {
  return '<!doctype html><html lang="ar" dir="rtl"><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    '<title>الصفحة غير موجودة | BLOFY PLAYER</title></head>' +
    '<body style="min-height:100vh;margin:0;display:grid;place-items:center;font:16px system-ui,Tahoma,Arial,sans-serif;color:#fff;background:#0c0912">' +
    '<main style="padding:36px;text-align:center;max-width:540px">' +
    '<h1>الصفحة غير موجودة</h1><p>لم نتمكن من العثور على الرابط المطلوب في BLOFY PLAYER.</p>' +
    '<a href="/" style="color:#bd95ff">العودة إلى مركز التحميل</a>' +
    '</main></body></html>';
}

export function isPublicHtmlRequest(req, pathname) {
  if (!['GET', 'HEAD'].includes(req.method || '')) return false;
  if (/^\/(?:api|admin|download|d|files)(?:\/|$)/.test(pathname)) return false;
  return /(?:^|,)\s*text\/html\b/i.test(String(req.headers.accept || ''));
}

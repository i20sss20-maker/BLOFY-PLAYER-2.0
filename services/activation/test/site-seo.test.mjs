import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderPublicDownloads } from '../src/public-downloads.mjs';

const home = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const downloads = renderPublicDownloads([]);

function attribute(html, pattern) {
  const result = html.match(pattern);
  assert.ok(result, 'Missing expected SEO attribute: ' + pattern);
  return result[1];
}

test('homepage has Arabic/English brand identity, canonical and a valid WebSite schema', () => {
  const title = attribute(home, /<title>([^<]+)<\/title>/);
  assert.match(title, /BLOFY PLAYER/);
  assert.match(title, /بلوفي بلاير/);
  assert.match(attribute(home, /<meta name="description" content="([^"]+)"/), /M3U/);
  assert.equal(attribute(home, /<link rel="canonical" href="([^"]+)"/), 'https://blofyplayer.com/');
  assert.match(home, /<h1><span data-i18n="heroTitle">BLOFY PLAYER/);
  const json = attribute(home, /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  const schema = JSON.parse(json);
  assert.equal(schema['@type'], 'WebSite');
  assert.equal(schema.name, 'BLOFY PLAYER');
  assert.equal(schema.alternateName, 'بلوفي بلاير');
  assert.equal(schema.url, 'https://blofyplayer.com/');
  assert.doesNotMatch(home, /<meta name="keywords"/);
});

test('downloads is a distinct Arabic-language landing page with official store links', () => {
  const title = attribute(downloads, /<title>([^<]+)<\/title>/);
  assert.match(title, /تحميل BLOFY PLAYER/);
  assert.match(title, /بلوفي بلاير/);
  assert.equal(attribute(downloads, /<link rel="canonical" href="([^"]+)"/), 'https://blofyplayer.com/downloads');
  assert.match(downloads, /<meta name="description" content="[^"]*Xtream Codes/);
  assert.match(downloads, /<h1 id="download-title">تحميل BLOFY PLAYER/);
  assert.match(downloads, /play\.google\.com\/store\/apps\/details\?id=tv\.blofy\.player\.v2/);
  // Keep this page static and fast for search engines and low-resource Android TV WebViews.
  assert.doesNotMatch(downloads, /<script\b(?![^>]*type="application\/ld\+json")/i);
  assert.doesNotMatch(downloads, /<meta name="keywords"/);
});

test('social preview metadata always identifies the right canonical landing page', () => {
  for (const [page, expected] of [[home, 'https://blofyplayer.com/'], [downloads, 'https://blofyplayer.com/downloads']]) {
    assert.equal(attribute(page, /<meta property="og:url" content="([^"]+)"/), expected);
    assert.match(page, /<meta property="og:site_name" content="BLOFY PLAYER"/);
    assert.match(page, /<meta property="og:locale" content="ar_SA"/);
    assert.match(page, /<meta name="twitter:card" content="summary"/);
  }
});

test('sitemap lists canonical public pages, not the duplicate device sign-in route', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const sitemap = server.split('function serveSitemap(res) {')[1]?.split('async function servePortalLogo(')[0] || '';
  assert.match(sitemap, /https:\/\/blofyplayer\.com\/downloads/);
  assert.match(sitemap, /https:\/\/blofyplayer\.com\/privacy/);
  assert.doesNotMatch(sitemap, /https:\/\/blofyplayer\.com\/connect/);
});

test('public downloads FAQ answers real installation, activation and renewal questions without scripts', () => {
  assert.match(downloads, /<section class="section install-section" id="faq"/);
  assert.match(downloads, /كيف أحمل BLOFY PLAYER على التلفزيون/);
  assert.match(downloads, /كيف أربط الجهاز وأفعّل التطبيق/);
  assert.match(downloads, /كيف أجدد التفعيل أو أتواصل مع الدعم/);
  assert.match(downloads, /wa\.me\/966568941484/);
  assert.match(downloads, /هل يشمل تنزيل التطبيق قنوات أو اشتراك بث/);
  assert.match(downloads, /<a href="\/connect">بوابة ربط الجهاز<\/a>/);
  assert.doesNotMatch(downloads, /<script\b(?![^>]*type="application\/ld\+json")/i);
});

test('official guide is a crawlable Arabic help page linked from both landing pages', () => {
  const guide = readFileSync(new URL('../web/guide.html', import.meta.url), 'utf8');
  assert.match(guide, /<html lang="ar" dir="rtl">/);
  assert.equal(attribute(guide, /<link rel="canonical" href="([^"]+)"/), 'https://blofyplayer.com/guide');
  assert.match(attribute(guide, /<meta name="description" content="([^"]+)"/), /Android TV/);
  assert.match(guide, /<h1>دليل تثبيت بلوفي بلاير على التلفزيون والجوال<\/h1>/);
  assert.match(guide, /play\.google\.com\/store\/apps\/details\?id=tv\.blofy\.player\.v2/);
  assert.match(guide, /blofyplayer\.com\/apk/);
  assert.match(guide, /https:\/\/wa\.me\/966568941484/);
  assert.match(guide, /لا يوفّر قوائم أو قنوات أو اشتراكات محتوى/);
  assert.match(guide, /انتهت صلاحية رمز الربط/);
  // JSON-LD is inert search metadata, not browser-executable JavaScript.
  assert.doesNotMatch(guide, /<script\b(?![^>]*type="application\/ld\+json")/i);
  assert.match(home, /<a href="\/guide">دليل التثبيت<\/a>/);
  assert.match(downloads, /<a href="\/guide">افتح دليل BLOFY PLAYER/);
});

test('guide appears in the official main domain sitemap', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const sitemap = server.split('function serveSitemap(res) {')[1]?.split('async function servePortalLogo(')[0] || '';
  assert.match(sitemap, /<loc>https:\/\/blofyplayer\.com\/guide<\/loc>/);
  assert.match(server, /pathname === '\/guide' \|\| requestUrl\.pathname === '\/guide\/'/);
});

test('public home declares accurate Android app metadata without invented price or reviews', () => {
  const schemas = [...home.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map(m => JSON.parse(m[1]));
  const app = schemas.find(item => item['@type'] === 'SoftwareApplication');
  assert.ok(app, 'Missing Android SoftwareApplication structured metadata');
  assert.equal(app.name, 'BLOFY PLAYER');
  assert.equal(app.operatingSystem, 'Android');
  assert.equal(app.applicationCategory, 'MultimediaApplication');
  assert.equal(app.url, 'https://blofyplayer.com/');
  assert.equal(app.downloadUrl, 'https://play.google.com/store/apps/details?id=tv.blofy.player.v2');
  assert.match(app.description, /لا يتضمن قنوات أو اشتراكات بث/);
  for (const speculative of ['aggregateRating', 'review', 'offers', 'price', 'ratingValue']) {
    assert.equal(Object.hasOwn(app, speculative), false, speculative + ' must not be invented');
  }
});

test('guide structured breadcrumbs point only to canonical public pages', () => {
  const guide = readFileSync(new URL('../web/guide.html', import.meta.url), 'utf8');
  const schemas = [...guide.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map(m => JSON.parse(m[1]));
  const breadcrumbs = schemas.find(item => item['@type'] === 'BreadcrumbList');
  assert.ok(breadcrumbs);
  assert.deepEqual(breadcrumbs.itemListElement.map(item => item.item), [
    'https://blofyplayer.com/', 'https://blofyplayer.com/guide'
  ]);
  assert.deepEqual(breadcrumbs.itemListElement.map(item => item.position), [1, 2]);
  assert.match(downloads, /<a href="\/guide">دليل التثبيت<\/a>/);
});

test('pairing form has crawler noindex but home remains indexable', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const pairingRoute = server.split('async function servePortal(res, connectOnly = false) {')[1]
    ?.split('async function serveStatusPage(')[0] || '';
  assert.match(pairingRoute, /if \(connectOnly\) \{/);
  assert.match(pairingRoute, /content="noindex,follow"/);
  assert.match(pairingRoute, /connectOnly \? \{ 'x-robots-tag': 'noindex,follow' \} : \{\}/);
  assert.doesNotMatch(home, /<meta name="robots" content="noindex/);
});

test('support and WhatsApp renewal hub is an accessible canonical Arabic public page', () => {
  const support = readFileSync(new URL('../web/support.html', import.meta.url), 'utf8');
  assert.match(support, /<html lang="ar" dir="rtl">/);
  assert.match(attribute(support, /<title>([^<]+)<\/title>/), /دعم BLOFY PLAYER/);
  assert.equal(attribute(support, /<link rel="canonical" href="([^"]+)"/), 'https://blofyplayer.com/support');
  assert.match(attribute(support, /<meta name="description" content="([^"]+)"/), /واتساب/);
  assert.match(support, /<h1>الدعم الفني وتجديد تفعيل بلوفي بلاير<\/h1>/);
  assert.match(support, /href="https:\/\/wa\.me\/966568941484\?text=/);
  assert.match(support, /تفعيل تطبيق BLOFY PLAYER منفصل عن اشتراك محتوى البث/);
  assert.match(support, /لا تشارك كلمات مرور قوائم التشغيل أو رمز الربط المؤقت/);
  assert.match(support, /href="\/privacy"/);
  assert.doesNotMatch(support, /<script\b(?![^>]*type="application\/ld\+json")/i);
  const matches = [...support.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)];
  const schemas = matches.map(m => JSON.parse(m[1]));
  const crumbs = schemas.find(s => s['@type'] === 'BreadcrumbList');
  assert.ok(crumbs);
  assert.deepEqual(crumbs.itemListElement.map(item => item.item),
    ['https://blofyplayer.com/', 'https://blofyplayer.com/support']);
  assert.match(home, /<a href="\/support">الدعم والتجديد<\/a>/);
  assert.match(downloads, /<a href="\/support">الدعم والتجديد<\/a>/);
  const guide = readFileSync(new URL('../web/guide.html', import.meta.url), 'utf8');
  assert.match(guide, /<a href="\/support">الدعم والتجديد<\/a>/);
});

test('support page is served explicitly and sitemap includes it but still excludes private pairing', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const sitemap = server.split('function serveSitemap(res) {')[1]?.split('async function servePortalLogo(')[0] || '';
  assert.match(sitemap, /<loc>https:\/\/blofyplayer\.com\/support<\/loc>/);
  assert.doesNotMatch(sitemap, /<loc>https:\/\/blofyplayer\.com\/connect<\/loc>/);
  assert.match(server, /pathname === '\/support' \|\| requestUrl\.pathname === '\/support\/'/);
  assert.match(server, /serveStatusPage\(res, 'support\.html'\)/);
});

test('public canonical GET routes also allow HEAD for SEO crawlers and link checks', () => {
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  for (const route of ['/', '/guide', '/support', '/status', '/robots.txt', '/sitemap.xml']) {
    const lines = server.split('\n').filter(line =>
      line.includes("requestUrl.pathname === '" + route + "'"));
    assert.ok(lines.length, 'Expected a route for ' + route);
    assert.ok(lines.some(line => line.includes("['GET', 'HEAD'].includes(req.method)")),
      'Missing HEAD support on public URL ' + route);
  }
  assert.match(server, /if \(req\.method === 'GET' && requestUrl\.pathname === '\/connect'\)/);
});

test('home has one public heading and keeps the logged-in dashboard style', () => {
  assert.equal((home.match(/<h1\b/g) || []).length, 1);
  assert.match(home, /<h2 data-i18n="playlistsTitle">قوائم التشغيل<\/h2>/);
  assert.match(home, /\.dashboard-title-wrap h2 \{/);
  assert.doesNotMatch(home, /\.dashboard-title-wrap h1 \{/);
});

test('downloads page uses crawl-safe breadcrumbs and a genuine WhatsApp share link', () => {
  const values = [...downloads.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)]
    .map(match => JSON.parse(match[1]));
  const crumbs = values.find(item => item['@type'] === 'BreadcrumbList');
  assert.ok(crumbs);
  assert.deepEqual(crumbs.itemListElement.map(item => item.item),
    ['https://blofyplayer.com/', 'https://blofyplayer.com/downloads']);
  const shareMatch = downloads.match(/<a class="btn" href="([^"]+)" target="_blank" rel="noopener noreferrer" aria-label="مشاركة BLOFY PLAYER على واتساب">/);
  assert.ok(shareMatch);
  const link = new URL(shareMatch[1]);
  assert.equal(link.origin, 'https://api.whatsapp.com');
  assert.match(link.searchParams.get('text'), /https:\/\/blofyplayer.com\/downloads/);
  assert.match(link.searchParams.get('text'), /لا يوفّر اشتراك محتوى/);
  const guide = readFileSync(new URL('../web/guide.html', import.meta.url), 'utf8');
  assert.match(guide, /شارك التطبيق عبر واتساب/);
  assert.equal((guide.match(/<h1>/g) || []).length, 1);
  assert.ok((guide.match(/<title>([^<]+)/)?.[1] || '').length <= 60);
  assert.ok((guide.match(/<meta name="description" content="([^"]+)"/)?.[1] || '').length <= 160);
});

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
  assert.doesNotMatch(downloads, /<script\b/i);
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

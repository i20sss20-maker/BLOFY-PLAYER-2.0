import assert from 'node:assert/strict';
import test from 'node:test';
import {
  UPDATE_SITE_CANONICAL,
  updateRobotsTxt,
  updateSitemapXml,
  renderMissingPublicPage,
  isPublicHtmlRequest
} from './public-search-pages.mjs';

test('updates sitemap advertises only public canonical releases page', () => {
  const sitemap = updateSitemapXml();
  assert.equal(UPDATE_SITE_CANONICAL, 'https://updates.blofyplayer.com/');
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.match(sitemap, /<loc>https:\/\/updates\.blofyplayer\.com\/<\/loc>/);
  assert.doesNotMatch(sitemap, /\/admin|\/api|\/download\/latest|secret|token/i);
});

test('robots exposes sitemap and blocks sensitive URL families', () => {
  const robots = updateRobotsTxt();
  assert.match(robots, /Sitemap: https:\/\/updates\.blofyplayer\.com\/sitemap\.xml/);
  for (const path of ['/admin', '/api/', '/download/', '/d/', '/files/']) {
    assert.ok(robots.includes('Disallow: ' + path), path);
  }
});

test('branded 404 is crawl-safe, keeps other endpoints JSON', () => {
  const html = renderMissingPublicPage();
  assert.match(html, /BLOFY PLAYER/);
  assert.match(html, /الصفحة غير موجودة/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  const get = (path, accept='text/html,application/xhtml+xml') =>
    isPublicHtmlRequest({method:'GET',headers:{accept}},path);
  assert.equal(get('/__blofy_missing_route__'), true);
  assert.equal(get('/missing', '*/*'), false);
  for (const path of ['/admin','/api/v1/unknown','/d/blofy','/files/a.apk','/download/latest.apk'])
    assert.equal(get(path), false, path);
  assert.equal(isPublicHtmlRequest({method:'POST',headers:{accept:'text/html'}},'/__blofy_missing_route__'), false);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('../web/en.html');
const server = read('../src/server.mjs');
const analytics = read('../web/public-analytics.js');

test('English market landing has a distinct indexable canonical and discovery metadata', () => {
  assert.match(page, /<html lang="en" dir="ltr">/);
  assert.match(page, /<link rel="canonical" href="https:\/\/blofyplayer\.com\/en">/);
  assert.match(page, /hreflang="en"/);
  assert.match(page, /hreflang="ar"/);
  assert.match(page, /<title>[^<]*BLOFY PLAYER[^<]*Android TV/);
  assert.match(page, /name="description" content="[^"]+M3U[^"]+Xtream/);
  assert.match(page, /property="og:url" content="https:\/\/blofyplayer\.com\/en"/);
  assert.match(page, /name="twitter:card" content="summary"/);
  assert.match(page, /<h1>BLOFY PLAYER/);
  assert.doesNotMatch(page, /<meta name="robots" content="noindex/);
  const schema = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
  assert.equal(schema.find(x => x['@type'] === 'SoftwareApplication')?.operatingSystem, 'Android');
  assert.equal(schema.find(x => x['@type'] === 'SoftwareApplication')?.downloadUrl, 'https://play.google.com/store/apps/details?id=tv.blofy.player.v2');
});

test('English landing promotes the REAL Play listing and official APK without promising content', () => {
  assert.match(page, /play\.google\.com\/store\/apps\/details\?id=tv\.blofy\.player\.v2/);
  assert.match(page, /href="\/downloads"/);
  assert.match(page, /blofyplayer\.com\/apk/);
  assert.match(page, /M3U/);
  assert.match(page, /Xtream Codes/);
  assert.match(page, /does not provide content, channels or IPTV subscriptions/);
  assert.doesNotMatch(page, /guaranteed free|free channels|unlimited live channels|all channels free/i);
  assert.doesNotMatch(page, /<script src="https?:\/\//);
});

test('Sharing targets WhatsApp, Telegram and X with separately attributed campaign links', () => {
  assert.match(page, /https:\/\/api\.whatsapp\.com\/send\?text=/);
  assert.match(page, /https:\/\/t\.me\/share\/url\?/);
  assert.match(page, /https:\/\/twitter\.com\/intent\/tweet\?/);
  assert.match(page, /utm_campaign%3Dglobal_launch_202610/);
  for (const src of ['whatsapp','telegram','x']) assert.match(page, new RegExp('utm_source%3D' + src));
  assert.match(analytics, /'\/en'/);
  assert.match(analytics, /telegram_share_click/);
  assert.match(analytics, /x_share_click/);
  assert.match(analytics, /pagePath === '\/en'/);
  assert.match(analytics, /choice === 'accepted'/);
});

test('English page is served as a public HTML response with GA opt-in and indexed in sitemap', () => {
  assert.match(server, /fileName === 'en\.html'/);
  assert.match(server, /requestUrl\.pathname === '\/en'/);
  assert.match(server, /serveStatusPage\(res, 'en\.html'\)/);
  assert.match(server, /<url><loc>https:\/\/blofyplayer\.com\/en<\/loc><\/url>/);
  const home = read('../web/index.html');
  const downloads = read('../src/public-downloads.mjs');
  assert.match(home, /href="\/en" lang="en"/);
  assert.match(downloads, /href="\/en" lang="en"/);
});

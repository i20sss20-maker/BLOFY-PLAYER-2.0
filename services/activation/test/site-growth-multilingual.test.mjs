import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const spanish = read('../web/es.html');
const french = read('../web/fr.html');
const english = read('../web/en.html');
const home = read('../web/index.html');
const server = read('../src/server.mjs');
const analytics = read('../web/public-analytics.js');
const domain = 'https://blofyplayer.com';
const locales = { ar: '/', en: '/en', es: '/es', fr: '/fr' };

test('localized landing pages are valid server-rendered HTML with unique language metadata', () => {
  for (const [lang, body] of [['es', spanish], ['fr', french]]) {
    assert.match(body, new RegExp('<html lang="' + lang + '" dir="ltr">'));
    assert.match(body, new RegExp('<link rel="canonical" href="' + domain + '/' + lang + '">'));
    assert.match(body, /<meta name="description" content="[^"]{80,}">/);
    assert.match(body, /<h1>BLOFY PLAYER/);
    assert.match(body, /M3U/);
    assert.match(body, /Xtream Codes/);
    assert.match(body, /<meta property="og:image:alt" content="BLOFY PLAYER">/);
    assert.match(body, /<meta name="twitter:card" content="summary">/);
    assert.match(body, /<img class="mark"[^>]+alt="BLOFY PLAYER"/);
    assert.match(body, /play\.google\.com\/store\/apps\/details\?id=tv\.blofy\.player\.v2/);
    assert.match(body, /href="\/downloads"/);
    assert.doesNotMatch(body, /<meta name="robots" content="noindex/);
    // Search metadata is inert; no analytics or browser script is required for content rendering.
    assert.doesNotMatch(body, /<script(?! type="application\/ld\+json")/);
    const metadata = [...body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    assert.equal(metadata.find(m => m['@type'] === 'SoftwareApplication')?.operatingSystem, 'Android');
    assert.equal(metadata.find(m => m['@type'] === 'SoftwareApplication')?.downloadUrl,
      'https://play.google.com/store/apps/details?id=tv.blofy.player.v2');
  }
});

test('every translated entry advertises reciprocal hreflang and canonical links', () => {
  for (const [lang, body] of [['ar', home], ['en', english], ['es', spanish], ['fr', french]]) {
    for (const [otherLang, path] of Object.entries(locales)) {
      assert.ok(body.includes('hreflang="' + otherLang + '" href="' + domain + path + '"'),
        lang + ' missing ' + otherLang);
    }
  }
  for (const [lang, body] of [['en', english], ['es', spanish], ['fr', french]]) {
    assert.match(body, /hreflang="x-default" href="https:\/\/blofyplayer\.com\/"/);
    assert.match(body, /href="\/downloads"/);
  }
});

test('Spanish and French provide renewal and marketing links without WhatsApp share', () => {
  for (const body of [spanish, french]) {
    assert.match(body, /href="\/pay"/);
    assert.doesNotMatch(body, /https:\/\/api\.whatsapp\.com\/send\?text=/);
    assert.match(body, /https:\/\/t\.me\/share\/url\?/);
    assert.match(body, /https:\/\/twitter\.com\/intent\/tweet/);
    for (const source of ['telegram', 'x']) {
      assert.ok(body.includes('utm_source%3D' + source), 'Missing attributed ' + source + ' share');
    }
    assert.match(body, /id="faq"/);
  }
  assert.match(spanish, /no incluye canales ni servicios de contenido/i);
  assert.match(french, /ne fournit ni chaînes ni abonnements/i);
});

test('both language routes are on the public host and sitemap without affecting private pairing', () => {
  assert.match(server, /fileName === 'es\.html'/);
  assert.match(server, /fileName === 'fr\.html'/);
  for (const [lang, filename] of [['es', 'es.html'], ['fr', 'fr.html']]) {
    assert.ok(server.includes("requestUrl.pathname === '/" + lang + "'"));
    assert.ok(server.includes("serveStatusPage(res, '" + filename + "')"));
    assert.ok(server.includes('<url><loc>' + domain + '/' + lang + '</loc></url>'));
  }
  assert.match(home, /href="\/es" lang="es"/);
  assert.match(home, /href="\/fr" lang="fr"/);
});

test('public analytics remains consent-only, with localized notices and no device identifiers', () => {
  assert.match(analytics, /'\/es', '\/es\/'/);
  assert.match(analytics, /'\/fr', '\/fr\/'/);
  assert.match(analytics, /Opciones de analítica/);
  assert.match(analytics, /Paramètres statistiques/);
  assert.match(analytics, /data-ga-reject/);
  assert.match(analytics, /choice === 'accepted'/);
  assert.doesNotMatch(analytics, /activationCode|deviceId|password|username/);
});

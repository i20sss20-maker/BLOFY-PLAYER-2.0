import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const analyticsSource = readFileSync(new URL('../web/public-analytics.js', import.meta.url), 'utf8');
const homeSource = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

function captureAnalytics(search, preference = 'accepted', referrer = 'https://example.com/private?token=secret-value') {
  const scripts = [];
  const win = { location: { pathname: '/', search } };
  const fakeNode = () => ({
    style: {},
    setAttribute() {},
    addEventListener() {},
    remove() {}
  });
  const doc = {
    readyState: 'complete',
    referrer,
    createElement: fakeNode,
    head: { appendChild(node) { scripts.push(node); } },
    body: { appendChild() {} },
    addEventListener() {}
  };
  runInNewContext(analyticsSource, {
    window: win,
    document: doc,
    localStorage: { getItem() { return preference; }, setItem() {} },
    URL, URLSearchParams, Date,
    Element: class Element {}
  });
  const config = win.dataLayer?.find((entry) => entry[0] === 'config');
  return { scripts, options: config?.[2], dataLayer: win.dataLayer };
}

test('only explicitly allowlisted campaign parameters reach GA4 and referrer path is redacted', () => {
  const result = captureAnalytics('?utm_source=whatsapp&utm_medium=organic_share&utm_campaign=launch2026&device_id=PRIVATE&activation=SECRET');
  assert.equal(result.scripts.length, 1);
  assert.equal(result.options.page_location, 'https://blofyplayer.com/?utm_source=whatsapp&utm_medium=organic_share&utm_campaign=launch2026');
  assert.equal(result.options.page_referrer, 'https://example.com');
  assert.doesNotMatch(JSON.stringify(result.options), /PRIVATE|SECRET|secret-value/);
  assert.equal(result.options.allow_google_signals, false);
  assert.equal(result.options.allow_ad_personalization_signals, false);
});

test('malformed campaign labels are rejected and Google is not loaded before consent', () => {
  const yes = captureAnalytics('?utm_source=%2Fprivate&utm_medium=share&device=PRIVATE');
  assert.equal(yes.options.page_location, 'https://blofyplayer.com/?utm_medium=share');
  const no = captureAnalytics('?utm_source=whatsapp', 'rejected');
  assert.equal(no.scripts.length, 0);
  assert.equal(no.options, undefined);
});

test('public home offers a tracked official Play link and direct renewal without WhatsApp checkout', () => {
  assert.match(homeSource, /href="\/pay">تجديد التفعيل والدفع/);
  assert.match(homeSource, /href="\/pay">♻ تجديد التفعيل والدفع بالبطاقات/);
  assert.doesNotMatch(homeSource, /href="https:\/\/wa\.me[^"]*">تجديد التفعيل/);
  assert.doesNotMatch(homeSource, /https:\/\/api\.whatsapp\.com\/send\?text=/);
  assert.match(homeSource, /play\.google\.com\/store\/apps\/details\?id=tv\.blofy\.player\.v2/);
  assert.match(homeSource, /BLOFY PLAYER مشغل وسائط عام ولا يوفر أو يبيع قوائم تشغيل/);
});

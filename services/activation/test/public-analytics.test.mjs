import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withPublicAnalytics, PUBLIC_ANALYTICS_CSP } from '../src/public-analytics.mjs';
import { renderPublicDownloads } from '../src/public-downloads.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('GA4 is opt-in only on public pages and never collects device form details', () => {
  const client = read('../web/public-analytics.js');
  assert.match(client, /G-2DYE5WB8BT/);
  assert.match(client, /'\/guide'/);
  assert.match(client, /'\/support'/);
  assert.doesNotMatch(client, /'\/connect'/);
  assert.match(client, /if \(choice === 'accepted'\) startMeasurement\(\)/);
  assert.match(client, /data-ga-reject/);
  assert.match(client, /page_location: 'https:\/\/blofyplayer\.com' \+ pagePath \+ campaignQuery\(\)/);
  assert.doesNotMatch(client, /deviceId|activationCode|password|username/);
  assert.match(client, /google_play_click|downloads_page_click/);
});

test('tag injection is idempotent, has required GA endpoints in CSP', () => {
  const result = withPublicAnalytics('<html><head></head><body></body></html>');
  assert.match(result, /<script src="\/public-analytics\.js" defer><\/script>/);
  assert.equal(withPublicAnalytics(result), result);
  assert.match(PUBLIC_ANALYTICS_CSP, /www\.googletagmanager\.com/);
  assert.match(PUBLIC_ANALYTICS_CSP, /www\.google-analytics\.com/);
});

test('private connect screen and script-free download page remain unchanged', () => {
  const server = read('../src/server.mjs');
  assert.match(server, /connectOnly \? source : withPublicAnalytics\(source\)/);
  assert.match(server, /connectOnly \? \{/);
  assert.doesNotMatch(renderPublicDownloads([]), /<script\b/i);
  const downloadServer = read('../src/public-downloads.mjs');
  assert.match(downloadServer, /script-src 'none'/);
});

test('analytics disclosure is published in public privacy policy', () => {
  assert.match(read('../web/privacy.html'), /Google Analytics 4/);
});

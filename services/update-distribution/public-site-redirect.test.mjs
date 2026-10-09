import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSiteRedirect } from './public-site-redirect.mjs';

test('www public routes redirect to the canonical site without losing query parameters', () => {
  assert.equal(publicSiteRedirect('www.blofyplayer.com', 'GET', '/', '?deviceId=XYZ'), 'https://blofyplayer.com/?deviceId=XYZ');
  assert.equal(publicSiteRedirect('WWW.BLOFYPLAYER.COM:443', 'HEAD', '/downloads/'), 'https://blofyplayer.com/downloads');
  assert.equal(publicSiteRedirect('www.blofyplayer.com', 'GET', '/downloads', '?foo=1'), 'https://blofyplayer.com/downloads?foo=1');
});
test('updates domain and every operational endpoint keep existing behavior', () => {
  for (const pathname of ['/health', '/admin', '/download/latest.apk', '/d/blofy', '/api/internal/releases/upload', '/files/release.apk']) {
    assert.equal(publicSiteRedirect('www.blofyplayer.com', 'GET', pathname), null);
  }
  assert.equal(publicSiteRedirect('updates.blofyplayer.com', 'GET', '/'), null);
  assert.equal(publicSiteRedirect('www.blofyplayer.com', 'POST', '/'), null);
  assert.equal(publicSiteRedirect('blofyplayer.com', 'GET', '/'), null);
});

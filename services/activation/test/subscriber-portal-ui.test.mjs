import test from 'node:test';
import assert from 'node:assert/strict';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

function injected() {
  return injectSubscriberPortalUi('<html><body><select id="providerType"><option value="xtream">Xtream</option><option value="m3u">M3U</option></select><button id="saveBtn"></button></body></html>');
}

test('injects BLOFY subscriber bridge once', () => {
  const html = injected();
  assert.match(html, /data-blofy-subscriber-ui="1"/);
  assert.match(html, /مشتركين BLOFY/);
  assert.match(html, /\/api\/v1\/subscribers\/session/);
  assert.equal(injectSubscriberPortalUi(html), html);
});

test('keeps M3U and adds BLOFY subscriber mode', () => {
  const html = injected();
  assert.match(html, /option\.value = 'blofy'/);
  assert.doesNotMatch(html, /option\.value === 'm3u'/);
});

test('subscriber edit clears opaque credentials', () => {
  const html = injected();
  assert.match(html, /dispatchValue\(qs\('username'\), ''\)/);
  assert.match(html, /dispatchValue\(qs\('password'\), ''\)/);
});

test('subscriber save hands resolved session to Xtream save path', () => {
  const html = injected();
  assert.match(html, /session\.baseUrl/);
  assert.match(html, /session\.username/);
  assert.match(html, /session\.password/);
  assert.match(html, /select\.value = 'xtream'/);
});

test('leaves non-html responses unchanged', () => {
  assert.equal(injectSubscriberPortalUi('{"ok":true}'), '{"ok":true}');
});

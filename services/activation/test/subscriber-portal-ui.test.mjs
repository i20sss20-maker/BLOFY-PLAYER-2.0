import test from 'node:test';
import assert from 'node:assert/strict';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

test('injects BLOFY subscriber mode once and hides M3U from the portal selector', () => {
  const html = '<html><body><select id="providerType"><option value="xtream">Xtream</option><option value="m3u">M3U</option></select><button id="saveBtn"></button></body></html>';
  const injected = injectSubscriberPortalUi(html);
  assert.match(injected, /مشتركين BLOFY/);
  assert.match(injected, /option\.value === 'm3u'/);
  assert.match(injected, /\/api\/v1\/subscribers\/session/);
  assert.match(injected, /data-blofy-subscriber-ui="4"/);
  assert.equal(injectSubscriberPortalUi(injected), injected);
});

test('BLOFY subscriber edit does not expose opaque session credentials', () => {
  const injected = injectSubscriberPortalUi('<html><body></body></html>');
  assert.match(injected, /isSubscriberPlaylist/);
  assert.match(injected, /dispatchValue\(qs\('username'\), ''\)/);
  assert.match(injected, /dispatchValue\(qs\('password'\), ''\)/);
  assert.match(injected, /اكتب اسم المستخدم وكلمة المرور من جديد/);
});

test('BLOFY subscriber save posts the resolved Xtream session directly once', () => {
  const injected = injectSubscriberPortalUi('<html><body></body></html>');
  assert.match(injected, /providerType: 'xtream'/);
  assert.match(injected, /baseUrl: session\.baseUrl/);
  assert.match(injected, /username: session\.username/);
  assert.match(injected, /password: session\.password/);
  assert.match(injected, /editingSubscriberId \|\| undefined/);
});

test('renewal UI contains all approved packages and WhatsApp message details', () => {
  const injected = injectSubscriberPortalUi('<html><body></body></html>');
  for (const value of ['3 شهور', '10 ريال', '6 شهور', '18 ريال', 'سنة', '25 ريال', 'مدى الحياة', '40 ريال']) {
    assert.match(injected, new RegExp(value));
  }
  assert.match(injected, /رقم جهازي:/);
  assert.match(injected, /مدة التجديد المطلوبة:/);
  assert.match(injected, /wa\.me/);
});

test('leaves non-html responses unchanged', () => {
  assert.equal(injectSubscriberPortalUi('{"ok":true}'), '{"ok":true}');
});

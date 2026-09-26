import test from 'node:test';
import assert from 'node:assert/strict';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

function injected() {
  return injectSubscriberPortalUi('<html><body><select id="providerType"><option value="xtream">Xtream</option><option value="m3u">M3U</option></select><button id="saveBtn"></button></body></html>');
}

test('injects BLOFY v5 subscriber UI exactly once', () => {
  const html = injected();
  assert.match(html, /data-blofy-subscriber-ui="5"/);
  assert.match(html, /مشتركين BLOFY/);
  assert.match(html, /\/api\/v1\/subscribers\/session/);
  assert.match(html, /\/api\/v1\/portal\/playlists/);
  assert.equal(injectSubscriberPortalUi(html), html);
});

test('leaves non-html responses unchanged', () => {
  assert.equal(injectSubscriberPortalUi('{"ok":true}'), '{"ok":true}');
});

test('removes M3U from the visible provider selector and retains Xtream plus BLOFY', () => {
  const html = injected();
  assert.match(html, /option\.value === 'm3u'\) option\.remove\(\)/);
  assert.match(html, /option\.value = 'blofy'/);
  assert.match(html, /option\.textContent = 'مشتركين BLOFY'/);
  assert.match(html, /Xtream Codes/);
});

test('BLOFY mode hides only the host and keeps username and password visible', () => {
  const html = injected();
  assert.match(html, /setHidden\(fieldWrapper\(base\), blofy\)/);
  assert.match(html, /setHidden\(fieldWrapper\(user\), false\)/);
  assert.match(html, /setHidden\(fieldWrapper\(pass\), false\)/);
  assert.match(html, /أدخل اسم المستخدم وكلمة المرور فقط/);
});

test('subscriber edit never exposes stored opaque credentials', () => {
  const html = injected();
  assert.match(html, /editingSubscriberId = item\.id/);
  assert.match(html, /qs\('username'\)\.value = ''/);
  assert.match(html, /qs\('password'\)\.value = ''/);
  assert.match(html, /اكتب اسم المستخدم وكلمة المرور من جديد/);
});

test('subscriber save uses a fresh secure session and writes directly to the portal endpoint', () => {
  const html = injected();
  assert.match(html, /createSubscriberSession\(saved\.auth\)/);
  assert.match(html, /providerType: 'xtream'/);
  assert.match(html, /baseUrl: session\.baseUrl/);
  assert.match(html, /username: session\.username/);
  assert.match(html, /password: session\.password/);
  assert.match(html, /id: editingSubscriberId \|\| undefined/);
});

test('uses authenticated page state rather than cleared visible device inputs', () => {
  const html = injected();
  assert.match(html, /typeof auth !== 'undefined' && auth/);
  assert.match(html, /deviceId: String\(state && state\.deviceId/);
  assert.match(html, /activationCode: String\(state && state\.activationCode/);
  assert.doesNotMatch(html, /qs\('deviceId'\).*activationCode/);
});

test('does not install a document-wide MutationObserver', () => {
  const html = injected();
  assert.doesNotMatch(html, /MutationObserver/);
  assert.match(html, /DOMContentLoaded', install, \{ once: true \}/);
});

test('playlist name remains optional', () => {
  const html = injected();
  assert.match(html, /input\.required = false/);
  assert.match(html, /اسم القائمة \(اختياري\)/);
  assert.match(html, /Playlist name \(optional\)/);
});

test('renewal UI contains all approved plans and prices', () => {
  const html = injected();
  assert.match(html, /تجديد الاشتراك/);
  assert.match(html, /data-plan="3 شهور" data-price="10 ريال"/);
  assert.match(html, /data-plan="6 شهور" data-price="18 ريال"/);
  assert.match(html, /data-plan="سنة" data-price="25 ريال"/);
  assert.match(html, /data-plan="مدى الحياة" data-price="40 ريال"/);
});

test('renewal message includes device, duration and price and opens WhatsApp', () => {
  const html = injected();
  assert.match(html, /رقم جهازي:/);
  assert.match(html, /مدة التجديد المطلوبة:/);
  assert.match(html, /السعر:/);
  assert.match(html, /https:\/\/wa\.me\//);
  assert.match(html, /encodeURIComponent\(message\)/);
});

test('renewal number is supplied only through the environment-backed server value', () => {
  const html = injected();
  assert.match(html, /var whatsappNumber = /);
  assert.doesNotMatch(html, /966568941484/);
});

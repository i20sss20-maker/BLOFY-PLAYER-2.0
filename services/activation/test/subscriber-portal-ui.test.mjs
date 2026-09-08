import test from 'node:test';
import assert from 'node:assert/strict';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

test('injects BLOFY subscriber option and secure session flow once', () => {
  const html = '<html><body><select id="providerType"></select><button id="saveBtn"></button></body></html>';
  const injected = injectSubscriberPortalUi(html);
  assert.match(injected, /مشتركين BLOFY/);
  assert.match(injected, /\/api\/v1\/subscribers\/session/);
  assert.match(injected, /data-blofy-subscriber-ui="1"/);
  assert.match(injected, /select\.value = 'xtream'/);
  assert.equal(injectSubscriberPortalUi(injected), injected);
});

test('retains authenticated device fields for BLOFY save and dispatches native field events', () => {
  const injected = injectSubscriberPortalUi('<html><body></body></html>');
  assert.match(injected, /rememberedDeviceId/);
  assert.match(injected, /rememberedActivationCode/);
  assert.match(injected, /resolvedDeviceAuth\(\)/);
  assert.match(injected, /addEventListener\('input', rememberDeviceAuth, true\)/);
  assert.match(injected, /dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
  assert.match(injected, /dispatchValue\(qs\('baseUrl'\), session\.baseUrl\)/);
  assert.match(injected, /!payload\.providerId/);
});

test('leaves non-html responses unchanged', () => {
  assert.equal(injectSubscriberPortalUi('{"ok":true}'), '{"ok":true}');
});
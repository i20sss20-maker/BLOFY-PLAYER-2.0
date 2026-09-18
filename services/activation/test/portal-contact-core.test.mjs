import assert from 'node:assert/strict';
import test from 'node:test';
import { injectPortalContactUi, maskPortalPhone, normalizePortalPhone } from '../src/portal-contact-core.mjs';

test('normalizes Saudi mobile formats to E.164', () => {
  assert.equal(normalizePortalPhone('0551234567'), '+966551234567');
  assert.equal(normalizePortalPhone('551234567'), '+966551234567');
  assert.equal(normalizePortalPhone('966551234567'), '+966551234567');
  assert.equal(normalizePortalPhone('+966 55 123 4567'), '+966551234567');
});

test('accepts Arabic digits and valid international E.164 numbers', () => {
  assert.equal(normalizePortalPhone('٠٥٥١٢٣٤٥٦٧'), '+966551234567');
  assert.equal(normalizePortalPhone('00971501234567'), '+971501234567');
});

test('rejects malformed phone numbers', () => {
  assert.equal(normalizePortalPhone(''), null);
  assert.equal(normalizePortalPhone('1234'), null);
  assert.equal(normalizePortalPhone('055-ABC-4567'), null);
});

test('masks stored numbers before returning them to the browser', () => {
  assert.equal(maskPortalPhone('+966551234567'), '+966••••4567');
});

test('injects contact UI once, remembers completion, and keeps contact secrets out of browser storage', () => {
  const html = '<html><body><div id="app"></div></body></html>';
  const injected = injectPortalContactUi(html);
  assert.match(injected, /data-blofy-contact-ui="1"/);
  assert.match(injected, /\/api\/v1\/portal\/contact\/status/);
  assert.match(injected, /\/api\/v1\/portal\/contact/);
  assert.match(injected, /blofy\.contact\.complete\.v1:/);
  assert.match(injected, /rememberContact\(state\.deviceId\)/);
  assert.doesNotMatch(injected, /localStorage\.setItem\([^\n]*(?:activationCode|maskedPhone|phone)/);
  assert.doesNotMatch(injected, /sessionStorage.*(?:activationCode|maskedPhone|phone)/);
  assert.equal(injectPortalContactUi(injected), injected);
});

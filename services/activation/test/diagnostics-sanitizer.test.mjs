import assert from 'node:assert/strict';
import test from 'node:test';
import {
  pseudonymizeDiagnosticProviderKey,
  safeErrorSummary,
  sanitizeDiagnosticAppVersion,
  sanitizeDiagnosticContentKind,
  sanitizeDiagnosticErrorCode,
  sanitizeDiagnosticMessage,
  sanitizeDiagnosticUrl
} from '../src/diagnostics-sanitizer.mjs';

test('redacts URL user-info, Xtream path credentials, query and fragment', () => {
  const sanitized = sanitizeDiagnosticUrl(
    'https://authority-user:authority-pass@IPTV.Example:8443/live/alice/p%40ssword/12345.ts' +
      '?username=query-user&password=query-pass&token=query-token#fragment-token'
  );

  assert.equal(sanitized, 'https://redacted.invalid/live/***.ts');
  for (const secret of [
    'iptv.example', 'authority-user', 'authority-pass', 'alice', 'p%40ssword', 'query-user', 'query-pass',
    'query-token'
  ]) {
    assert.equal(sanitized.toLowerCase().includes(secret.toLowerCase()), false, `leaked ${secret}`);
  }
});

test('redacts M3U query credentials and malformed input', () => {
  assert.equal(
    sanitizeDiagnosticUrl('https://provider.example/get.php?username=alice&password=secret&type=m3u_plus&token=abc'),
    'https://redacted.invalid/***.php'
  );
  assert.equal(sanitizeDiagnosticUrl('not a valid URL?token=abc'), '<redacted-url>');
});

test('removes embedded URLs, username, password and token values from errors', () => {
  const sanitized = sanitizeDiagnosticMessage(
    'Failed https://url-user:url-pass@iptv.example/series/alice/secret/42.mkv?token=url-token ' +
      'username=plain-user password: plain-pass token=\'plain-token\' Authorization: Bearer eyJ.secret.sig ' +
      'JSON={"username":"json-user","password":"json-pass","access_token":"json-token"}'
  );

  assert.match(sanitized, /<redacted-url>/);
  for (const secret of [
    'iptv.example', 'url-user', 'url-pass', 'alice', 'secret', 'url-token', 'plain-user', 'plain-pass',
    'plain-token', 'eyJ.secret.sig', 'json-user', 'json-pass', 'json-token'
  ]) {
    assert.equal(sanitized.includes(secret), false, `leaked ${secret} in: ${sanitized}`);
  }
  assert.equal(sanitized.includes('http://'), false);
  assert.equal(sanitized.includes('https://'), false);
});

test('removes scheme-less URLs and encoded URI values from errors', () => {
  const sanitized = sanitizeDiagnosticMessage(
    'source=provider.example/live/alice/password/99.ts ' +
      'uri=https%3A%2F%2Fprovider.example%2Fget.php%3Ftoken%3Dabc'
  );

  for (const secret of ['provider.example', 'alice', 'password/99', 'token%3Dabc']) {
    assert.equal(sanitized.includes(secret), false, `leaked ${secret} in: ${sanitized}`);
  }
});

test('removes bare hosts, IP addresses and Basic authorization credentials', () => {
  const sanitized = sanitizeDiagnosticMessage(
    'Unable to resolve host "provider.example.com"; ETIMEDOUT 203.0.113.42:8080 ' +
      'Authorization: Basic YWxpY2U6c2VjcmV0'
  );

  for (const secret of ['provider.example.com', '203.0.113.42', 'YWxpY2U6c2VjcmV0']) {
    assert.equal(sanitized.includes(secret), false, `leaked ${secret} in: ${sanitized}`);
  }
});

test('removes credential-bearing relative stream paths', () => {
  const sanitized = sanitizeDiagnosticMessage(
    'DataSpec uri=/live/relative-user/relative-pass/123.ts and (/series/other-user/other-pass/9.mkv)'
  );

  for (const secret of ['relative-user', 'relative-pass', 'other-user', 'other-pass']) {
    assert.equal(sanitized.includes(secret), false, `leaked ${secret} in: ${sanitized}`);
  }
  assert.match(sanitized, /<redacted-url>/);
});

test('pseudonymizes provider keys and allowlists all remaining diagnostics metadata', () => {
  const provider = pseudonymizeDiagnosticProviderKey(
    'https://user:pass@provider.example/live/user/pass/1.ts?token=secret'
  );
  assert.match(provider, /^provider-[a-f0-9]{16}$/);
  assert.equal(pseudonymizeDiagnosticProviderKey(provider), provider);
  assert.equal(provider.includes('secret'), false);

  assert.equal(sanitizeDiagnosticContentKind('LIVE'), 'live');
  assert.equal(sanitizeDiagnosticContentKind('password=secret'), 'unknown');
  assert.equal(sanitizeDiagnosticErrorCode('ERROR_CODE_IO_NETWORK_CONNECTION_FAILED'), 'ERROR_CODE_IO_NETWORK_CONNECTION_FAILED');
  assert.equal(sanitizeDiagnosticErrorCode('token=secret'), null);
  assert.equal(sanitizeDiagnosticAppVersion('2.0.0-rc01'), '2.0.0-rc01');
  assert.equal(sanitizeDiagnosticAppVersion('url=https://provider.example'), null);
});

test('limits only sanitized output', () => {
  assert.equal(sanitizeDiagnosticUrl('https://example.com/live/u/p/1.ts', 24).length, 24);
  assert.equal(sanitizeDiagnosticMessage(`failure ${'x'.repeat(200)}`, 32).length, 32);
});

test('server error summaries never serialize messages, stacks, causes, URLs or credentials', () => {
  const error = new Error(
    'password=SUPER-SECRET token=TOP-TOKEN url=https://user:pass@provider.example/live/user/pass/1.ts'
  );
  error.stack = `STACK WITH SUPER-SECRET ${error.stack}`;
  error.cause = { connectionString: 'postgresql://db-user:db-pass@database.example/db' };
  error.request = { body: { username: 'playlist-user', password: 'playlist-pass' } };
  error.code = 'ECONNREFUSED';

  assert.equal(safeErrorSummary(error), 'Error (ECONNREFUSED)');

  error.code = 'ECONNREFUSED token=LEAK';
  assert.equal(safeErrorSummary(error), 'Error');
});

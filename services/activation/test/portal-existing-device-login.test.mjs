import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { removePortalRegistrationCheck } from '../src/portal-existing-device-login-core.mjs';

test('production portal login no longer calls the registration endpoint', async () => {
  const portal = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.match(portal, /\/api\/v1\/activation\/check/);
  assert.match(portal, /await load\(\)/);

  const transformed = removePortalRegistrationCheck(portal);
  assert.doesNotMatch(transformed, /appVersion:\s*"web-portal"/);
  assert.doesNotMatch(transformed, /const activation = await api\("\/api\/v1\/activation\/check"/);
  assert.match(transformed, /await load\(\)/);
});

test('existing-device portal guard does not contain registration or device inserts', async () => {
  const source = await readFile(new URL('../src/portal-existing-device-login.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /registerDeviceTrial/);
  assert.doesNotMatch(source, /INSERT\s+INTO\s+devices/i);
  assert.match(source, /removePortalRegistrationCheck/);
});

test('non-portal content is unchanged', () => {
  const html = '<html><body>safe</body></html>';
  assert.equal(removePortalRegistrationCheck(html), html);
});

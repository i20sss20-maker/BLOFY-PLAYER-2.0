import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStreamAdminPath } from '../src/stream-gateway-hook.mjs';

test('same-domain admin routes are limited to a safe namespace', () => {
  assert.equal(mapStreamAdminPath('/stream'), '/');
  assert.equal(mapStreamAdminPath('/stream/'), '/');
  for (const route of ['source','codes','users','content','appcodes']) {
    assert.equal(mapStreamAdminPath('/stream/'+route), '/');
  }
  assert.equal(mapStreamAdminPath('/stream/admin-assets/admin.css'), '/admin-assets/admin.css');
  assert.equal(mapStreamAdminPath('/stream/admin-assets/admin.js'), '/admin-assets/admin.js');
  assert.equal(mapStreamAdminPath('/stream/admin-api/status'), '/admin-api/status');
  assert.equal(mapStreamAdminPath('/stream/admin-api/accounts/bulk'), '/admin-api/accounts/bulk');
  assert.equal(mapStreamAdminPath('/admin'), null);
  assert.equal(mapStreamAdminPath('/downloads'), null);
  assert.equal(mapStreamAdminPath('/api/v1/activation/check'), null);
  assert.equal(mapStreamAdminPath('/stream/live/10.ts'), null);
  assert.equal(mapStreamAdminPath('/stream/player_api.php'), null);
  assert.equal(mapStreamAdminPath('/stream/admin-assets/unknown.js'), null);
  assert.equal(mapStreamAdminPath('/streaming'), null);
});

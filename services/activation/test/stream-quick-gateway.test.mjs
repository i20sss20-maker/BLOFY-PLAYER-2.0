import test from 'node:test';
import assert from 'node:assert/strict';
import { mapStreamAdminPath } from '../src/stream-gateway-hook.mjs';

test('quick stream page uses only explicitly allowed static files', () => {
  assert.equal(mapStreamAdminPath('/stream/legacy'), '/');
  assert.equal(mapStreamAdminPath('/stream/admin-assets/stream-quick.js'), '/admin-assets/stream-quick.js');
  assert.equal(mapStreamAdminPath('/stream/admin-assets/stream-quick.css'), '/admin-assets/stream-quick.css');
  assert.equal(mapStreamAdminPath('/stream/admin-assets/private.js'), null);
  assert.equal(mapStreamAdminPath('/admin'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  decryptXtreamSecret,
  encryptXtreamSecret,
  isBlockedNetworkAddress,
  normalizeXtreamBaseUrl,
  normalizeXtreamItem,
  parseTopLevelJsonArray,
  sanitizeXtreamAccount
} from '../src/xtream-core.mjs';

const key = '11'.repeat(32);

test('Xtream credentials round trip through authenticated encryption', () => {
  const sealed = encryptXtreamSecret('secret-user', key, 'username:test');
  assert.match(sealed, /^v1\./);
  assert.equal(decryptXtreamSecret(sealed, key, 'username:test'), 'secret-user');
  assert.throws(() => decryptXtreamSecret(sealed, key, 'password:test'), /xtream_secret_decryption_failed/);
});

test('Xtream URL normalization accepts HTTP/HTTPS but rejects embedded credentials and query data', () => {
  assert.equal(normalizeXtreamBaseUrl('https://example.com:443/'), 'https://example.com');
  assert.equal(normalizeXtreamBaseUrl('http://example.com/panel/'), 'http://example.com/panel');
  assert.throws(() => normalizeXtreamBaseUrl('ftp://example.com'), /xtream_protocol_invalid/);
  assert.throws(() => normalizeXtreamBaseUrl('https://user:pass@example.com'), /xtream_base_url_invalid/);
  assert.throws(() => normalizeXtreamBaseUrl('https://example.com/?username=u'), /xtream_base_url_invalid/);
});

test('private, loopback, link-local and documentation IPs are blocked', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.5','169.254.169.254','100.64.0.1','192.0.2.1','198.51.100.1','203.0.113.1','::1','fd00::1','fe80::1']) {
    assert.equal(isBlockedNetworkAddress(ip), true, ip);
  }
  assert.equal(isBlockedNetworkAddress('8.8.8.8'), false);
  assert.equal(isBlockedNetworkAddress('1.1.1.1'), false);
});

test('streaming array parser handles objects split across arbitrary chunks', async () => {
  const body = Readable.from([
    '[{"stream_id":1,"name":"One","nested":{"x":"{a}"}},',
    '{"stream_id":2,"name":"Two with \\"quote\\""}',
    ',{"stream_id":3,"name":"Three"}]'
  ]);
  const items = [];
  const count = await parseTopLevelJsonArray(body, value => { items.push(value); });
  assert.equal(count, 3);
  assert.deepEqual(items.map(item => item.stream_id), [1,2,3]);
  assert.equal(items[0].nested.x, '{a}');
});

test('normalized catalog item keeps useful metadata but does not persist direct stream URL', () => {
  const item = normalizeXtreamItem('movie', {
    stream_id: 77,
    name: 'Demo',
    category_id: '5',
    stream_icon: 'https://img.example/demo.jpg',
    direct_source: 'https://secret.example/u/p/77.mp4',
    container_extension: 'mp4',
    rating: '8.0'
  }, 'sync-token');
  assert.equal(item.sourceId, '77');
  assert.equal(item.metadata.directSourcePresent, true);
  assert.equal(JSON.stringify(item).includes('secret.example'), false);
});

test('account summary omits username and password returned by panels', () => {
  const summary = sanitizeXtreamAccount({
    user_info: { auth: 1, username: 'u', password: 'p', status: 'Active', max_connections: '2' },
    server_info: { url: 'hidden', port: '80', timezone: 'UTC' }
  });
  assert.equal(summary.authenticated, true);
  assert.equal(summary.maxConnections, 2);
  assert.equal(Object.hasOwn(summary, 'username'), false);
  assert.equal(Object.hasOwn(summary, 'password'), false);
});

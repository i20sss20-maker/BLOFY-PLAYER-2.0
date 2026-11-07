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

test('large Xtream catalogs stream without quadratic per-character UTF-8 rechecks', async () => {
  const countExpected = 4000;
  const records = Array.from({length:countExpected},(_,i)=>JSON.stringify({
    stream_id:i+1,name:'فيلم جديد '+i+' '+('دقة عالية '.repeat(20)),
    category_id:'11',container_extension:'mp4'
  }));
  const payload='['+records.join(',')+']';
  const chunks=payload.match(/[\s\S]{1,257}/g);
  let countSeen=0;
  const count=await parseTopLevelJsonArray(Readable.from(chunks), item=>{
    countSeen++;
    assert.ok(item.stream_id>=1&&item.stream_id<=countExpected);
  });
  assert.equal(count,countExpected);
  assert.equal(countSeen,countExpected);
  const source=await import('node:fs/promises').then(fs=>
    fs.readFile(new URL('../src/xtream-core.mjs',import.meta.url),'utf8'));
  const parser=source.slice(source.indexOf('export async function parseTopLevelJsonArray('),
    source.indexOf('export function redactXtreamError('));
  assert.doesNotMatch(parser,/Buffer\.byteLength\(current\)/);
  assert.match(parser,/current\.length > maxItemBytes/);
});

test('catalog item cap still measures actual UTF-8 bytes even when split mid-emoji', async () => {
  const item=JSON.stringify({stream_id:1,name:'قناة 🎬 عربية'});
  const encoded=Buffer.from('['+item+']','utf8');
  const fragmented=()=>Readable.from(Array.from(encoded,byte=>Buffer.from([byte])));
  const maxItemBytes=Buffer.byteLength(item);
  const received=[];
  assert.equal(await parseTopLevelJsonArray(fragmented(),row=>received.push(row),
    {maxItemBytes}),1);
  assert.equal(received[0].name,'قناة 🎬 عربية');
  await assert.rejects(parseTopLevelJsonArray(fragmented(),()=>{},
    {maxItemBytes:maxItemBytes-1}),/xtream_item_too_large/);
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
  assert.equal(summary.isRestreamer, null);
  assert.equal(sanitizeXtreamAccount({user_info:{auth:1,is_restreamer:0}}).isRestreamer,false);
  assert.equal(sanitizeXtreamAccount({user_info:{auth:1,is_restreamer:1}}).isRestreamer,true);
  assert.equal(Object.hasOwn(summary, 'username'), false);
  assert.equal(Object.hasOwn(summary, 'password'), false);
});

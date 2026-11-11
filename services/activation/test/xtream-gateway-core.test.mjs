import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanGatewayDisplayName,
  escapeM3uAttribute,
  formatGatewayCategory,
  formatGatewayItem,
  gatewayCredentialProof,
  generateGatewayPassword,
  generateGatewayUsername,
  normalizeGatewayPassword,
  normalizeGatewayUsername,
  safeGatewayExtension,
  stripUpstreamSecrets,
  verifyGatewayCredential
} from '../src/xtream-gateway-core.mjs';

const key = 'ab'.repeat(32);

test('gateway credentials use a keyed non-reversible proof', () => {
  const proof = gatewayCredentialProof('blofy1234', 'Strong_pass-123', key);
  assert.match(proof, /^[a-f0-9]{64}$/);
  assert.equal(proof.includes('Strong_pass-123'), false);
  assert.equal(verifyGatewayCredential(proof, 'blofy1234', 'Strong_pass-123', key), true);
  assert.equal(verifyGatewayCredential(proof, 'blofy1234', 'wrong-pass-123', key), false);
});

test('generated gateway credentials are URL path safe', () => {
  const username = generateGatewayUsername(size => Buffer.alloc(size, 0x12));
  const password = generateGatewayPassword(size => Buffer.alloc(size, 0x34));
  assert.equal(normalizeGatewayUsername(username), username);
  assert.equal(normalizeGatewayPassword(password), password);
  assert.match(username, /^[A-Za-z0-9_]+$/);
  assert.match(password, /^[A-Za-z0-9_-]+$/);
});

test('new Xtream credentials are short alphanumeric only, never branded or padded', () => {
  const username=generateGatewayUsername(size=>Buffer.alloc(size,0x12));
  const password=generateGatewayPassword(size=>Buffer.alloc(size,0x34));
  assert.equal(username.length,8);
  assert.equal(password.length,12);
  assert.match(username,/^[A-Za-z0-9]{8}$/);
  assert.match(password,/^[A-Za-z0-9]{12}$/);
  assert.doesNotMatch(username,/blofy/i);
  assert.doesNotMatch(password,/[_/+=-]/);
  assert.equal(normalizeGatewayUsername(username),username);
  assert.equal(normalizeGatewayPassword(password),password);
  const proof=gatewayCredentialProof(username,password,key);
  assert.equal(verifyGatewayCredential(proof,username,password,key),true);
});

test('new credentials vary with random bytes and legacy long credentials still authenticate', () => {
  const a=generateGatewayUsername(size=>Buffer.alloc(size,0x20));
  const b=generateGatewayUsername(size=>Buffer.alloc(size,0x21));
  const p1=generateGatewayPassword(size=>Buffer.alloc(size,0x30));
  const p2=generateGatewayPassword(size=>Buffer.alloc(size,0x31));
  assert.notEqual(a,b);
  assert.notEqual(p1,p2);
  const oldUser='blofy1234567890';
  const oldPass='veryLongStablePassword0123';
  const originalProof=gatewayCredentialProof(oldUser,oldPass,key);
  assert.equal(verifyGatewayCredential(originalProof,oldUser,oldPass,key),true);
});

test('new generator fails closed when a random byte source is biased or broken', () => {
  assert.throws(() => generateGatewayPassword(size=>Buffer.alloc(size,0xff)),
    /xtream_gateway_secure_random_unavailable/);
});

test('gateway credential validation rejects path separators and short secrets', () => {
  assert.throws(() => normalizeGatewayUsername('bad/user'), /username_invalid/);
  assert.throws(() => normalizeGatewayPassword('short'), /password_invalid/);
  assert.throws(() => normalizeGatewayPassword('password/with/slash'), /password_invalid/);
});

test('upstream credentials and direct source fields are stripped recursively', () => {
  const clean = stripUpstreamSecrets({
    username: 'secret-user',
    password: 'secret-pass',
    info: { title: 'Demo', direct_source: 'https://upstream.example/live/u/p/1.ts' },
    episodes: [{ id: 2, host: 'upstream.example', name: 'E2' }]
  });
  const serialized = JSON.stringify(clean);
  assert.equal(serialized.includes('secret-user'), false);
  assert.equal(serialized.includes('secret-pass'), false);
  assert.equal(serialized.includes('upstream.example'), false);
  assert.equal(clean.info.title, 'Demo');
  assert.equal(clean.episodes[0].name, 'E2');
});

test('Xtream category and item formatting keeps gateway IDs only', () => {
  const category = formatGatewayCategory({ gateway_id: 91, name: 'Movies' });
  assert.deepEqual(category, { category_id: '91', category_name: 'Movies', parent_id: 0 });
  const movie = formatGatewayItem('movie', {
    gateway_id: 700,
    category_gateway_id: 91,
    name: 'Demo Movie',
    icon_url: 'https://images.example/poster.jpg',
    container_extension: 'MKV',
    metadata: { rating: '8.4', directSourcePresent: true }
  });
  assert.equal(movie.stream_id, 700);
  assert.equal(movie.category_id, '91');
  assert.equal(movie.container_extension, 'mkv');
  assert.equal(movie.direct_source, '');
});

test('extension and M3U sanitizers are bounded', () => {
  assert.equal(safeGatewayExtension('.TS', 'mp4'), 'ts');
  assert.equal(safeGatewayExtension('../bad', 'mp4'), 'mp4');
  assert.equal(escapeM3uAttribute('A\n"B"'), "A 'B'");
});

test('decorative hashes are removed without changing original catalog names',()=>{
  assert.equal(cleanGatewayDisplayName('####### 1001 #######'),'1001');
  assert.equal(cleanGatewayDisplayName('AR: LA LIGA 1 • HD'),'AR: LA LIGA 1 • HD');
  assert.equal(cleanGatewayDisplayName('###'),'###');
  assert.equal(formatGatewayCategory({gateway_id:1,name:'### SPORTS ###'}).category_name,'SPORTS');
  assert.equal(formatGatewayItem('live',{gateway_id:42,name:'#### 1001 ####',
    metadata:{}}).name,'1001');
});

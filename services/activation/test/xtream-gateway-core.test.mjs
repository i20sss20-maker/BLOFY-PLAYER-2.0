import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('generated gateway credentials are short, strong and URL path safe', () => {
  const username = generateGatewayUsername(size => Buffer.alloc(size, 0x12));
  const password = generateGatewayPassword(size => Buffer.alloc(size, 0x34));
  assert.equal(normalizeGatewayUsername(username), username);
  assert.equal(normalizeGatewayPassword(password), password);
  assert.match(username, /^[A-Za-z0-9]{10}$/);
  assert.match(password, /^[A-Za-z0-9]{12}$/);
  assert.ok(!username.startsWith('blofy'));
  assert.equal(verifyGatewayCredential(gatewayCredentialProof(username, password, key), username, password, key), true);
});

test('gateway credentials avoid modulo bias and generate unique random pairs', () => {
  let generatedBytes = 0;
  const randomBytes = size => {
    generatedBytes += size;
    return Buffer.from([255, ...Array.from({ length: size - 1 }, (_, i) => 62 + i % 180)]);
  };
  assert.match(generateGatewayUsername(randomBytes), /^[A-Za-z0-9]{10}$/);
  assert.ok(generatedBytes >= 16);
  const names = new Set(Array.from({ length: 100 }, () => generateGatewayUsername()));
  const passwords = new Set(Array.from({ length: 100 }, () => generateGatewayPassword()));
  assert.equal(names.size, 100);
  assert.equal(passwords.size, 100);
});

test('existing Xtream credentials remain valid without forced rotation', () => {
  const existingUsername = 'blofy03cd508344';
  const existingPassword = 'Legacy_pass-12345';
  const proof = gatewayCredentialProof(existingUsername, existingPassword, key);
  assert.ok(verifyGatewayCredential(proof, existingUsername, existingPassword, key));
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlofyCodeCrypto, normalizedBlofyCode, createBlofyCodeHandlers } from '../src/blofy-code-handlers.mjs';

test('code proofs are keyed, deterministic and credentials sealed with authenticated encryption', () => {
  const cipher = createBlofyCodeCrypto('ba'.repeat(32));
  const another = createBlofyCodeCrypto('ce'.repeat(32));
  assert.equal(normalizedBlofyCode(' abcdefgh12 '), 'ABCDEFGH12');
  assert.equal(normalizedBlofyCode('short'), null);
  assert.equal(cipher.proof('ABCDEFGH12'), cipher.proof('abcdefgh12'));
  assert.notEqual(cipher.proof('ABCDEFGH12'), another.proof('ABCDEFGH12'));
  assert.equal(cipher.proof('ABCDEFGH12').includes('ABCDEFGH12'), false);
  const sealed = cipher.seal('  securely stored password  ');
  assert.equal(sealed.includes('password'), false);
  assert.equal(cipher.open(sealed), '  securely stored password  ');
  assert.throws(() => another.open(sealed));
  assert.throws(() => createBlofyCodeCrypto('too-short'));
});

test('code issuance is restricted to admin and never stores plaintext code or credentials', async () => {
  let sqlArgs;
  const pool = { async query(query, args) { sqlArgs = args; return { rows: [{ id: args[0] }] }; } };
  const responses = [];
  const handlers = createBlofyCodeHandlers({
    pool, secretHex: 'ab'.repeat(32),
    checkAccount: async () => ({expiresAt: 1893456000000, status:'active'}),
    readJson: async () => ({ username: 'account-u', password: 'secret-p' }),
    json: (_res, status, body) => responses.push({ status, body }),
    requireAdmin: () => true, authorizedDevice: async () => ({ device_id: 'BLOFY-AB12-CD34' })
  });
  await handlers.issue({}, {});
  assert.equal(responses[0].status, 201);
  assert.equal(responses[0].body.host, 'http://annkel.com:80');
  assert.match(responses[0].body.code, /^\\d{8}$/);
  assert.equal(responses[0].body.expiresAt,1893456000000);
  assert.equal(sqlArgs[1].includes(responses[0].body.code), false);
  assert.equal(sqlArgs[2].includes('account-u'), false);
  assert.equal(sqlArgs[3].includes('secret-p'), false);
  assert.equal(sqlArgs[4].includes('annkel.com'),false);

  const denied = createBlofyCodeHandlers({
    pool, secretHex: 'ab'.repeat(32), readJson: async () => { throw Error('admin must run first'); },
    json: () => { throw Error('must not return success'); },
    requireAdmin: () => false, authorizedDevice: async () => null
  });
  await denied.issue({}, {});
});

test('wrong code and inactive device cannot reveal credentials', async () => {
  const responses = [];
  let selected = false;
  const handlers = createBlofyCodeHandlers({
    pool: { connect: async () => { selected = true; throw Error('must not query'); } },
    secretHex: 'cc'.repeat(32),
    json: (_res, status, body) => responses.push({ status, body }),
    readJson: async () => ({ code: '1234567890', deviceId: 'BLOFY-AB12-CD34', activationCode: '123456' }),
    requireAdmin: () => true, authorizedDevice: async () => null
  });
  await handlers.redeem({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, {});
  assert.equal(responses[0].status, 403);
  assert.equal(responses[0].body.error, 'device_not_active');
  assert.equal(selected, false);
});

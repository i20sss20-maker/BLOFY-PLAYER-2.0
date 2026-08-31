import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortalHandlers, playlistUrlValidation } from '../src/portal.mjs';

test('playlist URL policy accepts HTTP and HTTPS provider and M3U URLs', () => {
  assert.equal(playlistUrlValidation('http://provider.example:8080'), null);
  assert.equal(playlistUrlValidation('https://provider.example'), null);
  assert.equal(playlistUrlValidation(' https://provider.example/list.m3u?token=abc '), null);
  assert.equal(playlistUrlValidation('https://1.1.1.1:8443/get.php?token=abc'), null);
  assert.equal(playlistUrlValidation('https://[2606:4700:4700::1111]/list.m3u'), null);
});

test('playlist URL policy rejects unsupported schemes and malformed URLs', () => {
  assert.equal(playlistUrlValidation('provider.example'), 'invalid_playlist_url');
  assert.equal(playlistUrlValidation('ftp://provider.example/list.m3u'), 'invalid_playlist_url');
  assert.equal(playlistUrlValidation('file:///tmp/list.m3u'), 'invalid_playlist_url');
  assert.equal(playlistUrlValidation('https://provider.example/list name.m3u'), 'invalid_playlist_url');
  assert.equal(playlistUrlValidation('https://provider.example\n/list.m3u'), 'invalid_playlist_url');
  assert.equal(playlistUrlValidation('https://'), 'invalid_playlist_url');
  assert.equal(playlistUrlValidation(''), 'invalid_playlist_url');
});

test('playlist URL policy rejects credentials embedded in the URL authority', () => {
  assert.equal(
    playlistUrlValidation('https://user:pass@provider.example/list.m3u'),
    'playlist_userinfo_not_allowed'
  );
  assert.equal(
    playlistUrlValidation('http://@provider.example/list.m3u'),
    'playlist_userinfo_not_allowed'
  );
});

test('playlist URL policy rejects local, private and single-label endpoints', () => {
  const unsafeUrls = [
    'http://localhost:8080',
    'http://provider.local/list.m3u',
    'http://provider.internal/list.m3u',
    'http://provider.lan/list.m3u',
    'http://provider.home/list.m3u',
    'http://box.home.arpa/list.m3u',
    'http://box/list.m3u',
    'http://127.0.0.1/list.m3u',
    'http://0x7f000001/list.m3u',
    'http://10.0.0.1/list.m3u',
    'http://100.64.0.1/list.m3u',
    'http://169.254.1.1/list.m3u',
    'http://172.16.0.1/list.m3u',
    'http://192.0.0.1/list.m3u',
    'http://192.168.1.10/list.m3u',
    'http://198.18.0.1/list.m3u',
    'http://224.0.0.1/list.m3u',
    'http://[::1]/list.m3u',
    'http://[fc00::1]/list.m3u',
    'http://[fe80::1]/list.m3u',
    'http://[ff02::1]/list.m3u',
    'http://[2001:db8::1]/list.m3u',
    'http://provider.example:0/list.m3u'
  ];

  unsafeUrls.forEach((value) => {
    assert.equal(playlistUrlValidation(value), 'unsafe_playlist_host', value);
  });
});

test('portal rejection exposes and logs only the validation code', async () => {
  const requestBody = {
    deviceId: 'BLOFY-SECRET-DEVICE',
    activationCode: '123456',
    providerType: 'xtream',
    baseUrl: 'http://secret-user:secret-pass@192.168.1.10/list.m3u?token=secret-token',
    username: 'secret-user',
    password: 'secret-pass'
  };
  const warnings = [];
  let response;
  const handlers = createPortalHandlers({
    pool: { connect() { throw new Error('database_must_not_be_reached'); } },
    readJson: async () => requestBody,
    authorizedDevice: async () => ({ status: 'active' }),
    warnRejected: (error) => warnings.push(error),
    json: (_res, status, body) => {
      response = { status, body };
      return response;
    }
  });

  await handlers.upsert({}, {});

  assert.deepEqual(response, { status: 400, body: { error: 'playlist_userinfo_not_allowed' } });
  assert.deepEqual(warnings, ['playlist_userinfo_not_allowed']);
  const observable = JSON.stringify({ response, warnings });
  for (const secret of Object.values(requestBody)) {
    if (secret === 'xtream') continue;
    assert.equal(observable.includes(secret), false, `must not expose ${secret}`);
  }
});

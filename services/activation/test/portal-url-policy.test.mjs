import assert from 'node:assert/strict';
import test from 'node:test';
import { playlistUrlValidation } from '../src/portal.mjs';

test('playlist URL policy accepts HTTPS provider and M3U URLs', () => {
  assert.equal(playlistUrlValidation('https://provider.example'), null);
  assert.equal(playlistUrlValidation(' https://provider.example/list.m3u?token=abc '), null);
});

test('playlist URL policy rejects cleartext and malformed URLs clearly', () => {
  assert.equal(playlistUrlValidation('http://provider.example'), 'https_playlist_required');
  assert.equal(playlistUrlValidation('provider.example'), 'invalid_playlist_url');
  assert.equal(playlistUrlValidation('ftp://provider.example/list.m3u'), 'https_playlist_required');
  assert.equal(playlistUrlValidation(''), 'invalid_playlist_url');
});

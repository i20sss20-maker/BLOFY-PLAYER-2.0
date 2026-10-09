import test from 'node:test';
import assert from 'node:assert/strict';
import { INDEXNOW_KEY, INDEXNOW_KEY_PATH, serveIndexNowKey } from '../src/indexnow-key.mjs';

function run(method, path) {
  const state = { code: null, headers: {}, body: undefined };
  const response = {
    writeHead(code, headers) { state.code = code; state.headers = headers; },
    end(body) { state.body = body; }
  };
  state.served = serveIndexNowKey({ method }, response, new URL(path, 'https://blofyplayer.com'));
  return state;
}

test('indexnow serves ownership proof as plain text on the apex hostname root path', () => {
  assert.match(INDEXNOW_KEY, /^[a-zA-Z0-9-]{8,128}$/);
  assert.equal(INDEXNOW_KEY_PATH, '/' + INDEXNOW_KEY + '.txt');
  const page = run('GET', INDEXNOW_KEY_PATH);
  assert.equal(page.served, true);
  assert.equal(page.code, 200);
  assert.equal(page.body, INDEXNOW_KEY);
  assert.match(page.headers['content-type'], /^text\/plain/);
  assert.equal(page.headers['content-length'], Buffer.byteLength(INDEXNOW_KEY));
});

test('IndexNow proof supports HEAD but never captures unrelated, private or POST endpoints', () => {
  const head = run('HEAD', INDEXNOW_KEY_PATH);
  assert.equal(head.served, true);
  assert.equal(head.code, 200);
  assert.equal(head.body, undefined);
  for (const path of ['/', '/robots.txt', '/sitemap.xml', '/health', '/api/v1/activation/check', '/wrong.txt']) {
    const response = run('GET', path);
    assert.equal(response.served, false, path);
  }
  assert.equal(run('POST', INDEXNOW_KEY_PATH).served, false);
});

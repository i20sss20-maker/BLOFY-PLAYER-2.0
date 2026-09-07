import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

async function handler(dependencies = {}) {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('const server = http.createServer(') + 'const server = http.createServer('.length;
  const end = source.indexOf('\n\nasync function start()', begin);
  const callback = source.slice(begin, end).trim().replace(/\);$/, '');
  return vm.runInNewContext(`(${callback})`, {
    URL, console: { error() {} }, safeErrorSummary: () => ({}), RateLimitError: class extends Error {},
    json() { throw new Error('attempted a second HTTP response'); }, ...dependencies
  });
}

test('a completed response from an earlier hook does not fall through to the server router', async () => {
  const dispatch = await handler();
  await dispatch({ method: 'GET', url: '/already-handled' }, { writableEnded: true });
  await dispatch({ method: 'GET', url: '/already-handled' }, { destroyed: true });
});

test('a handler error after headers have started destroys the response without writing JSON again', async () => {
  const dispatch = await handler({ health: async () => { throw new Error('upstream disconnected'); } });
  const response = { headersSent: true, destroy() { this.destroyed = true; } };
  await dispatch({ method: 'GET', url: '/health' }, response);
  assert.equal(response.destroyed, true);
});

test('a normal server route retains its response behavior', async () => {
  const dispatch = await handler({ health: async (res) => { res.status = 200; res.body = 'ready'; } });
  const response = {};
  await dispatch({ method: 'GET', url: '/health' }, response);
  assert.equal(response.status, 200);
  assert.equal(response.body, 'ready');
});

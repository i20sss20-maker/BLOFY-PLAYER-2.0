// Loopback-only HTTP regressions; no database, provider or customer data.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { injectSubscriberPortalUi } from '../src/subscriber-portal-ui-hook.mjs';

const html = '<!doctype html><html><body><h1>ربط الجهاز — BLOFY</h1></body></html>';

async function exchange(handler, { path = '/connect', method = 'GET' } = {}) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: server.address().port, path, method, agent: false }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({
          status: response.statusCode, message: response.statusMessage,
          headers: response.headers, rawHeaders: response.rawHeaders,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      });
      request.on('error', reject);
      request.setTimeout(2000, () => request.destroy(new Error('Loopback HTTP response timed out')));
      request.end();
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

function verifyHtml(response, path = '/connect') {
  const expected = injectSubscriberPortalUi(html, { allowRenewal: path !== '/connect' });
  assert.equal(response.body, expected);
  assert.equal(Number(response.headers['content-length']), Buffer.byteLength(expected));
  assert.equal(response.headers['transfer-encoding'], undefined);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'content-length').length, 1);
}

for (const path of ['/connect', '/portal', '/']) {
  test(`implicit headers produce a complete, correctly framed ${path} response`, async () => {
    const response = await exchange((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
    }, { path });
    assert.equal(response.status, 200);
    verifyHtml(response, path);
    if (path === '/connect') assert.doesNotMatch(response.body, /blofyRenewBtn|wa\.me|data-plan/);
    else assert.match(response.body, /blofyRenewBtn/);
  });
}

test('explicit writeHead preserves status, reason, cookies and other headers', async () => {
  const response = await exchange((req, res) => {
    res.setHeader('X-Existing', 'kept');
    res.writeHead(202, 'Portal Accepted', {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': ['first=one; HttpOnly', 'second=two; SameSite=Strict'],
      'Cache-Control': 'no-store',
    });
    res.end(html);
  });
  assert.equal(response.status, 202);
  assert.equal(response.message, 'Portal Accepted');
  assert.equal(response.headers['x-existing'], 'kept');
  assert.deepEqual(response.headers['set-cookie'], ['first=one; HttpOnly', 'second=two; SameSite=Strict']);
  assert.equal(response.headers['cache-control'], 'no-store');
  verifyHtml(response);
});

test('implicit status and reason are not replaced by 200', async () => {
  const response = await exchange((req, res) => {
    res.statusCode = 202;
    res.statusMessage = 'Portal Accepted';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  });
  assert.equal(response.status, 202);
  assert.equal(response.message, 'Portal Accepted');
  verifyHtml(response);
});

for (const explicit of [false, true]) {
  test(`recalculates UTF-8 Content-Length with explicit=${explicit}`, async () => {
    const response = await exchange((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(html));
      if (explicit) res.writeHead(200, { 'CONTENT-LENGTH': Buffer.byteLength(html) });
      res.end(Buffer.from(html));
    });
    verifyHtml(response);
  });
  test(`does not emit conflicting transfer framing with explicit=${explicit}`, async () => {
    const response = await exchange((req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Transfer-Encoding', 'chunked');
      if (explicit) res.writeHead(200, { 'TRANSFER-ENCODING': 'chunked' });
      res.end(html);
    });
    verifyHtml(response);
  });
}

test('unrelated GET paths bypass portal transformation', async () => {
  const response = await exchange((req, res) => res.end(html), { path: '/api/v1/health' });
  assert.equal(response.body, html);
  assert.equal(response.status, 200);
});

test('POST to a portal path bypasses portal transformation', async () => {
  const response = await exchange((req, res) => res.end(html), { method: 'POST' });
  assert.equal(response.body, html);
});

test('a redirect without HTML keeps its status and destination', async () => {
  const response = await exchange((req, res) => {
    res.statusCode = 302;
    res.setHeader('Location', '/connect');
    res.end();
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/connect');
  assert.equal(response.body, '');
});

test('Buffer end(data, callback) retains its callback', async () => {
  let calls = 0;
  const response = await exchange((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(Buffer.from(html), () => { calls++; });
  });
  verifyHtml(response);
  assert.equal(calls, 1);
});

test('already injected HTML is not injected twice', async () => {
  const expected = injectSubscriberPortalUi(html, { allowRenewal: false });
  const response = await exchange((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(expected);
  });
  assert.equal(response.body, expected);
  assert.equal((response.body.match(/data-blofy-subscriber-ui="5"/g) || []).length, 1);
});

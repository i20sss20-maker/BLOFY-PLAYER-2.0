import http from 'node:http';
import https from 'node:https';

const PORT = Number(process.env.PORT || 8080);
const ACTIVATION_URL = String(process.env.ACTIVATION_URL || 'http://blofy-activation').replace(/\/+$/, '');
const RELEASE_URL = String(process.env.RELEASE_URL || 'http://blofy-releases').replace(/\/+$/, '');

const RELEASE_PATH = /^(?:\/release\.json|\/download(?:\/|$)|\/downloads(?:\/|$)|\/releases(?:\/|$))/;
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function securityHeaders() {
  return {
    'strict-transport-security': 'max-age=31536000',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin'
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...securityHeaders(),
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store'
  });
  res.end(payload);
}

function route(requestUrl) {
  const incoming = new URL(requestUrl || '/', 'http://blofy-gateway.local');
  let pathname = incoming.pathname;
  let base = ACTIVATION_URL;

  if (pathname === '/releases-admin' || pathname.startsWith('/releases-admin/')) {
    const suffix = pathname.slice('/releases-admin'.length);
    pathname = `/admin${suffix}`;
    base = RELEASE_URL;
  } else if (RELEASE_PATH.test(pathname)) {
    base = RELEASE_URL;
  }

  const target = new URL(pathname + incoming.search, `${base}/`);
  return target;
}

function proxy(req, res) {
  const target = route(req.url);
  const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  for (const name of HOP_BY_HOP) delete headers[name];

  const upstream = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || undefined,
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers
  }, (upstreamRes) => {
    const responseHeaders = {};
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (value != null && !HOP_BY_HOP.has(name.toLowerCase()) && name.toLowerCase() !== 'server') {
        responseHeaders[name] = value;
      }
    }
    Object.assign(responseHeaders, securityHeaders());
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(res);
  });

  upstream.setTimeout(30_000, () => upstream.destroy(new Error('upstream_timeout')));
  upstream.on('error', (error) => {
    console.error(`gateway upstream error for ${target.href}:`, error.message);
    if (!res.headersSent) json(res, 502, { ok: false, error: 'bad_gateway' });
    else res.destroy(error);
  });

  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', 'http://blofy-gateway.local');
    if (req.method === 'GET' && requestUrl.pathname === '/health') {
      return json(res, 200, { ok: true, service: 'blofy-gateway' });
    }
    return proxy(req, res);
  } catch (error) {
    console.error('gateway request error:', error?.message || String(error));
    return json(res, 500, { ok: false, error: 'gateway_error' });
  }
});

server.on('clientError', (error, socket) => {
  console.warn('gateway client error:', error.message);
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`BLOFY Node gateway listening on :${PORT}`);
  console.log(`activation upstream: ${ACTIVATION_URL}`);
  console.log(`releases upstream: ${RELEASE_URL}`);
});

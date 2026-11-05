// BLOFY STREAM same-domain admin proxy. No Azure, DNS switch or playback route changes.
// Enabled only with BLOFY_STREAM_UPSTREAM pointing at our Railway HTTPS service.
import http from 'node:http';
import https from 'node:https';

const PREFIX = '/stream';
const UPSTREAM = String(process.env.BLOFY_STREAM_UPSTREAM || '').trim();
const origin = (() => {
  if (!UPSTREAM) return null;
  const u = new URL(UPSTREAM);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
      !/^[a-z0-9-]+\.up\.railway\.app$/i.test(u.hostname) || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('BLOFY_STREAM_UPSTREAM must be an HTTPS Railway service origin');
  }
  return u.origin;
})();

export function mapStreamAdminPath(pathname) {
  if (pathname === PREFIX || pathname === PREFIX + '/') return '/';
  if (pathname === PREFIX + '/admin-assets/admin.css') return '/admin-assets/admin.css';
  if (pathname === PREFIX + '/admin-assets/admin.js') return '/admin-assets/admin.js';
  if (pathname === PREFIX + '/admin-assets/xtream-simple.js') return '/admin-assets/xtream-simple.js';
  if (pathname.startsWith(PREFIX + '/admin-api/')) return '/admin-api/' + pathname.slice((PREFIX + '/admin-api/').length);
  return null;
}

function responseCookie(cookie) {
  return cookie.replace(/^blofy_admin=/, 'blofy_stream_admin=').replace(/;\s*Path=\/([^;]*)/i, '; Path=/stream');
}
function streamCookies(value) {
  return String(value || '').split(';').map(v => v.trim())
    .filter(v => v.startsWith('blofy_stream_admin='))
    .map(v => v.replace(/^blofy_stream_admin=/, 'blofy_admin=')).join('; ');
}
function fail(res, status) {
  if (res.headersSent) return res.end();
  const body = JSON.stringify({ ok: false, error: status === 502 ? 'stream_upstream_unavailable' : 'stream_gateway_timeout' });
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(body);
}

async function proxyAdmin(req, res, targetPath) {
  const sourceUrl = new URL(req.url || '/', 'https://blofyplayer.com');
  const target = new URL(targetPath + sourceUrl.search, origin);
  const transformed = targetPath === '/' || targetPath === '/admin-assets/admin.js';
  const headers = {
    'accept': String(req.headers.accept || '*/*'),
    'accept-encoding': 'identity',
    'user-agent': String(req.headers['user-agent'] || 'BLOFY-STREAM-GATEWAY').slice(0, 300),
    'host': target.host,
    'cookie': streamCookies(req.headers.cookie),
    'x-forwarded-proto': 'https'
  };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
  const upstream = https.request(target, { method: req.method, headers, timeout: 20000 }, upstreamRes => {
    const outHeaders = {
      'content-type': upstreamRes.headers['content-type'] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex'
    };
    if (upstreamRes.headers['set-cookie']) {
      outHeaders['set-cookie'] = upstreamRes.headers['set-cookie'].map(responseCookie);
    }
    if (!transformed) {
      // Never forward upstream Content-Length blindly: Node handles stream transfer.
      res.writeHead(upstreamRes.statusCode || 502, outHeaders);
      upstreamRes.pipe(res);
      return;
    }
    const pieces = [];
    let bytes = 0;
    upstreamRes.on('data', b => {
      bytes += b.length;
      if (bytes > 1024 * 1024) {
        upstreamRes.destroy(new Error('stream_admin_asset_too_large'));
        return;
      }
      pieces.push(b);
    });
    upstreamRes.on('end', () => {
      if (res.headersSent) return;
      let body = Buffer.concat(pieces).toString('utf8');
      if (targetPath === '/') {
        body = body.replaceAll('/admin-assets/admin.css', '/stream/admin-assets/admin.css')
                   .replaceAll('/admin-assets/admin.js', '/stream/admin-assets/admin.js')
                   .replaceAll('/admin-assets/xtream-simple.js', '/stream/admin-assets/xtream-simple.js');
      } else {
        body = body.replace("const API='/admin-api/';", "const API='/stream/admin-api/';");
      }
      res.writeHead(upstreamRes.statusCode || 502, outHeaders);
      res.end(body);
    });
    upstreamRes.on('error', () => fail(res, 502));
  });
  upstream.on('timeout', () => upstream.destroy(new Error('stream_upstream_timeout')));
  upstream.on('error', () => fail(res, 502));
  req.pipe(upstream);
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withBlofyStream(listener) {
  return previousCreateServer((req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const mapped = mapStreamAdminPath(url.pathname);
      if (!mapped) return listener(req, res);
      if (!origin) {
        res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(JSON.stringify({ error:'stream_not_configured' }));
      }
      if (!['GET','HEAD','POST','DELETE','PATCH','PUT'].includes(req.method || '')) {
        res.writeHead(405, { allow:'GET, HEAD, POST, DELETE, PATCH, PUT' });
        return res.end();
      }
      void proxyAdmin(req, res, mapped);
    } catch {
      fail(res, 502);
    }
  });
};

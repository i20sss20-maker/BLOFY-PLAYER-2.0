import http from 'node:http';

const PORTAL_PATHS = new Set(['/', '/portal', '/connect']);
const WEB_REGISTRATION_CHECK = /\s*const activation = await api\("\/api\/v1\/activation\/check", "POST", \{\s*appVersion: "web-portal",\s*platform: "web"\s*\}\);\s*if \(activation\.status !== "trial" && activation\.status !== "active"\) \{\s*throw new Error\("unauthorized_device"\);\s*\}\s*/m;

export function removePortalRegistrationCheck(html) {
  const source = String(html || '');
  return source.replace(WEB_REGISTRATION_CHECK, '\n        ');
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withExistingDeviceOnlyPortalLogin(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (_) {}
    if (req.method !== 'GET' || !PORTAL_PATHS.has(pathname)) return listener(req, res);

    const originalWriteHead = res.writeHead.bind(res);
    const originalEnd = res.end.bind(res);
    let statusCode = 200;
    let statusMessage;
    let headers = {};
    let wroteHead = false;

    res.writeHead = function interceptedWriteHead(code, messageOrHeaders, maybeHeaders) {
      statusCode = code;
      if (typeof messageOrHeaders === 'string') {
        statusMessage = messageOrHeaders;
        headers = { ...(maybeHeaders || {}) };
      } else {
        headers = { ...(messageOrHeaders || {}) };
      }
      wroteHead = true;
      return res;
    };

    res.end = function interceptedEnd(chunk, encoding, callback) {
      if (typeof chunk === 'function') { callback = chunk; chunk = undefined; }
      if (typeof encoding === 'function') { callback = encoding; encoding = undefined; }
      const body = chunk == null ? '' : Buffer.isBuffer(chunk) ? chunk.toString(encoding || 'utf8') : String(chunk);
      const modified = removePortalRegistrationCheck(body);

      res.writeHead = originalWriteHead;
      if (!wroteHead) {
        statusCode = res.statusCode;
        statusMessage = res.statusMessage;
      }
      res.removeHeader('content-length');
      res.removeHeader('transfer-encoding');
      for (const key of Object.keys(headers)) {
        if (['content-length', 'transfer-encoding'].includes(key.toLowerCase())) delete headers[key];
      }
      headers['content-length'] = Buffer.byteLength(modified);
      if (statusMessage) originalWriteHead(statusCode, statusMessage, headers);
      else originalWriteHead(statusCode, headers);
      return originalEnd(modified, 'utf8', callback);
    };

    return listener(req, res);
  });
};

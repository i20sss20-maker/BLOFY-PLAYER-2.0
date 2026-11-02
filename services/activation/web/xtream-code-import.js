/* Xtream import stays entirely in the admin browser until explicitly submitted over the existing authenticated API. */
(function (root) {
  'use strict';
  const DEFAULT_HOST = 'http://annkel.com:80';

  function fail() { throw new Error('بيانات Xtream غير صالحة. تأكد من رابط السيرفر واسم المستخدم وكلمة المرور.'); }
  function urlOf(value) {
    const input = String(value || '').trim();
    if (!input || input.length > 4096 || /[\s<>]/.test(input)) fail();
    const address = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : 'http://' + input;
    let parsed;
    try { parsed = new URL(address); } catch { fail(); }
    // Client validation is only a convenience. The server pins DNS and rejects
    // private IPs; no network request is ever made from this parser.
    const host = parsed.hostname.toLowerCase();
    const isIpLiteral = host.includes(':') || host.split('.').every(part => part && /^\d+$/.test(part));
    if (!['http:','https:'].includes(parsed.protocol) ||
        !host || parsed.username || parsed.password || parsed.hash ||
        host === 'localhost' || host.endsWith('.local') || isIpLiteral) fail();
    return parsed;
  }
  function normalizedSecret(value, limit) {
    const str = String(value || '');
    if (!str.trim() || str.length > limit || /[\u0000-\u001f\u007f]/.test(str)) fail();
    return str;
  }
  function parseXtream(value) {
    const source = String(value || '').trim();
    if (!source || source.length > 4096) fail();
    const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    let username, password, host;
    if (lines.length === 3) {
      const strip = (s, pattern) => s.replace(pattern, '').trim();
      const server = strip(lines[0], /^(?:host|server|url|السيرفر|الرابط)\s*[:：]\s*/i);
      const serverUrl = urlOf(server);
      if (serverUrl.pathname !== '/' || serverUrl.search) fail();
      host = serverUrl.origin;
      username = strip(lines[1], /^(?:username|user|اسم المستخدم)\s*[:：]\s*/i);
      password = strip(lines[2], /^(?:password|pass|كلمة المرور)\s*[:：]\s*/i);
    } else if (lines.length === 1) {
      const url = urlOf(lines[0]);
      if (!['/', '/get.php', '/player_api.php'].includes(url.pathname)) fail();
      if (url.searchParams.getAll('username').length !== 1 ||
          url.searchParams.getAll('password').length !== 1) fail();
      username = url.searchParams.get('username');
      password = url.searchParams.get('password');
      host = url.origin;
    } else fail();
    return Object.freeze({
      host: host || DEFAULT_HOST,
      username: normalizedSecret(username, 256).trim(),
      password: normalizedSecret(password, 512)
    });
  }
  root.BlofyXtreamImporter = Object.freeze({ parseXtream });
})(globalThis);

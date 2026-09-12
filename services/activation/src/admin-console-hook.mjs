import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createExperienceHandlers } from './experience-handlers.mjs';
import { createReleaseCatalog, handleReleaseAdmin } from './release-catalog.mjs';
import { activationReleaseMetadata, appReleaseMetadata } from './release-metadata.mjs';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';
import { ADMIN_CONSOLE_SCHEMA } from './admin-console-schema.mjs';
import { servePublicDownloads } from './public-downloads.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: 2, connectionTimeoutMillis: 4000, idleTimeoutMillis: 10000, statement_timeout: 10000 });
pool.on('error', error => console.error('admin database error:', safeErrorSummary(error)));
const token = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const limiter = createFixedWindowLimiter({ limit: 60, windowMs: 60000 });
const catalog = createReleaseCatalog(pool, appReleaseMetadata());
let adminReady;
const json = (res, status, body, extra = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload), 'cache-control': 'no-store', ...extra });
  res.end(payload);
};
function requireAdmin(req, res) {
  const provided = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(token);
  if (!token || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    json(res, 401, { error: 'unauthorized' }); return false;
  }
  const rate = limiter.consume(requestClientKey(req));
  if (!rate.allowed) { json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfterSeconds) }); return false; }
  return true;
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 32768) throw Object.assign(new Error('payload_too_large'), { status: 413 }); chunks.push(Buffer.from(chunk)); }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
function ensureAdmin() {
  if (!adminReady) adminReady = (async () => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(718420641)');
      await client.query(ADMIN_CONSOLE_SCHEMA); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  })().catch(error => { adminReady = null; throw error; });
  return adminReady;
}
// Reuse the existing admin workflows. Device/portal routes are never delegated by this adapter.
const experience = createExperienceHandlers({ pool, json, readJson, requireAdmin, authorizedDevice: async () => null });
const assets = new Map([
  ['/premium.css', ['premium.css', 'text/css']], ['/experience.js', ['experience.js', 'text/javascript']],
  ['/release-manager.js', ['release-manager.js', 'text/javascript']], ['/release-manager.css', ['release-manager.css', 'text/css']],
  ['/IBMPlexSansArabic-Regular.ttf', ['IBMPlexSansArabic-Regular.ttf', 'font/ttf']],
  ['/IBMPlexSansArabic-Medium.ttf', ['IBMPlexSansArabic-Medium.ttf', 'font/ttf']],
  ['/OFL.txt', ['OFL.txt', 'text/plain']]
]);
const previousCreateServer = http.createServer.bind(http);
http.createServer = function withAdminConsole(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    if (res.writableEnded || res.destroyed) return;
    let url; try { url = new URL(req.url || '/', 'http://localhost'); } catch { return listener(req, res); }
    try {
      if (await servePublicDownloads(req, res, url.pathname, {
        list: () => catalog.list(),
        onError: error => console.error('public downloads failed:', safeErrorSummary(error))
      })) return;
      if (req.method === 'GET' && assets.has(url.pathname)) {
        const [file, type] = assets.get(url.pathname);
        const body = await readFile(new URL('../web/' + file, import.meta.url));
        res.writeHead(200, { 'content-type': type, 'content-length': body.length, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
        res.end(body); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/releases') {
        const { items } = await catalog.list(); json(res, 200, { items }); return;
      }
      if (['GET','HEAD'].includes(req.method) && ['/download/latest.apk','/latest.apk'].includes(url.pathname)) {
        const release = await catalog.primary();
        if (!release) { json(res, 404, { error: 'release_not_found' }); return; }
        res.writeHead(302, { location: release.downloadUrl, 'cache-control': 'no-store, max-age=0', 'referrer-policy': 'no-referrer' });
        res.end(); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        await pool.query('SELECT 1');
        const release = { ...activationReleaseMetadata(), app: await catalog.primary() };
        json(res, 200, { ok: true, database: 'ready', playlistEncryption: 'ready', release, time: Date.now() }); return;
      }
      if (await handleReleaseAdmin(catalog, req, res, url.pathname, { requireAdmin, readJson, json })) return;
      if (url.pathname === '/api/v1/admin/users' && req.method === 'GET') {
        if (!requireAdmin(req, res)) return;
        await ensureAdmin();
        const query = String(url.searchParams.get('q') || '').trim().slice(0, 128);
        const result = await pool.query(`SELECT d.device_id,d.status,d.expires_at,d.last_seen_at,d.last_app_version,d.last_platform,
          c.customer_name,c.customer_email,c.customer_phone FROM devices d LEFT JOIN device_customers c ON c.device_id=d.device_id
          WHERE $1='' OR d.device_id ILIKE $2 OR c.customer_name ILIKE $2 OR c.customer_phone ILIKE $2
          ORDER BY d.last_seen_at DESC NULLS LAST,d.device_id LIMIT 200`, [query, '%' + query + '%']);
        json(res, 200, { items: result.rows }); return;
      }
      if (url.pathname.startsWith('/api/v1/admin/experience/')) {
        // Authenticate before schema work. The delegated handler performs its own final guard.
        const auth = String(req.headers.authorization || '');
        const supplied = Buffer.from(auth.slice(7)); const expected = Buffer.from(token);
        if (!auth.startsWith('Bearer ') || supplied.length !== expected.length || !token ||
            !crypto.timingSafeEqual(supplied, expected)) { json(res, 401, { error: 'unauthorized' }); return; }
        await ensureAdmin();
        if (await experience.handle(req, res, url)) return;
      }
      return listener(req, res);
    } catch (error) {
      console.error('admin/release request failed:', safeErrorSummary(error));
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 503;
      json(res, status, { error: status === 503 ? 'service_unavailable' : error.message });
    }
  });
};

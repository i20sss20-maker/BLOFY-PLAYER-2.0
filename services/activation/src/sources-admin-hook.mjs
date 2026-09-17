import { databaseOptions } from './database-options.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const UPSTREAM_PLUGINS_URL = 'https://raw.githubusercontent.com/i20sss20-maker/BLOFY-SOURCES/main/plugins.json';
const SOURCE_REPO_URL = 'https://github.com/i20sss20-maker/BLOFY-SOURCES';

const pool = new pg.Pool({
  ...databaseOptions(DATABASE_URL),
  max: 2,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 10000,
  statement_timeout: 10000
});
pool.on('error', error => console.error('sources database error:', safeErrorSummary(error)));

const limiter = createFixedWindowLimiter({ limit: 90, windowMs: 60_000 });
let readyPromise;

const INITIAL_SOURCES = [
  {
    id: 'internet-archive', internalName: 'InternetArchiveProvider', name: 'InternetArchiveProvider',
    description: 'Watch content from the Internet Archive at archive.org',
    iconUrl: 'https://www.google.com/s2/favicons?domain=archive.org&sz=%size%',
    pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/InternetArchiveProvider.cs3',
    repositoryUrl: 'https://github.com/recloudstream/extensions',
    fileHash: 'sha256-54f3de560bebeff2e4a10d1163f6146313c59061d21c3a230125611f01b531eb',
    fileSize: 28037, apiVersion: 1, pluginVersion: 1, status: 1, language: null,
    authors: ['Luna712'], tvTypes: ['Others'], enabled: true, category: 'archive', priority: 10,
    rightsNote: 'Provider points to archive.org; item rights vary and must be respected.'
  },
  {
    id: 'twitch', internalName: 'TwitchProvider', name: 'TwitchProvider',
    description: 'Watch livestreams from Twitch',
    iconUrl: 'https://www.google.com/s2/favicons?domain=twitch.tv&sz=%size%',
    pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/TwitchProvider.cs3',
    repositoryUrl: 'https://github.com/recloudstream/extensions',
    fileHash: 'sha256-a7cc95f77bbd00a311d122201c63babe70b63fb398641fa28bf2b2c77346150a',
    fileSize: 15239, apiVersion: 1, pluginVersion: 2, status: 1, language: null,
    authors: ['CranberrySoup'], tvTypes: ['Live'], enabled: true, category: 'live', priority: 20,
    rightsNote: 'Content rights remain with creators and the platform.'
  },
  {
    id: 'dailymotion', internalName: 'DailymotionProvider', name: 'DailymotionProvider',
    description: 'Watch content from Dailymotion',
    iconUrl: 'https://www.google.com/s2/favicons?domain=www.dailymotion.com&sz=%size%',
    pluginUrl: 'https://raw.githubusercontent.com/recloudstream/extensions/builds/DailymotionProvider.cs3',
    repositoryUrl: 'https://github.com/recloudstream/extensions',
    fileHash: 'sha256-9036525a64e8b3c8fe04f94e9fe89a744c13d69af684ed0d2ad2a7eb0f332cd9',
    fileSize: 11472, apiVersion: 1, pluginVersion: 4, status: 1, language: null,
    authors: ['Luna712'], tvTypes: ['Others'], enabled: true, category: 'video', priority: 30,
    rightsNote: 'Content rights remain with creators and the platform.'
  }
];

function json(res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra
  });
  res.end(payload);
}

function publicJson(res, body) {
  const payload = JSON.stringify(body, null, 2) + '\n';
  const etag = '"' + crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24) + '"';
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    'access-control-allow-origin': '*',
    etag,
    'x-content-type-options': 'nosniff'
  });
  res.end(payload);
}

function html(res, body) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://www.google.com; connect-src 'self'; frame-ancestors 'none'"
  });
  res.end(body);
}

function asset(res, body, type) {
  res.writeHead(200, {
    'content-type': type,
    'content-length': body.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  });
  res.end(body);
}

function timingSafeToken(value) {
  const supplied = Buffer.from(String(value || '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(ADMIN_TOKEN);
  return !!ADMIN_TOKEN && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function requireAdmin(req, res) {
  if (!timingSafeToken(req.headers.authorization)) {
    json(res, 401, { error: 'unauthorized' });
    return false;
  }
  const rate = limiter.consume(requestClientKey(req));
  if (!rate.allowed) {
    json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfterSeconds) });
    return false;
  }
  return true;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.from(chunk);
    size += data.length;
    if (size > 64_000) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(data);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}

function sourceId(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) return null;
  return id;
}

function cleanText(value, max = 512) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function normalizePlugin(plugin) {
  if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) return null;
  const internalName = cleanText(plugin.internalName, 128);
  const name = cleanText(plugin.name, 128) || internalName;
  const pluginUrl = cleanText(plugin.url, 2048);
  const fileHash = cleanText(plugin.fileHash, 160);
  const version = Number(plugin.version);
  const status = Number(plugin.status);
  const apiVersion = Number(plugin.apiVersion || 1);
  const fileSize = plugin.fileSize == null ? null : Number(plugin.fileSize);
  if (!internalName || !name || !/^https:\/\//i.test(pluginUrl || '') || !Number.isSafeInteger(version) || version < 1) return null;
  if (!Number.isInteger(status) || status < 0 || status > 3) return null;
  if (!Number.isSafeInteger(apiVersion) || apiVersion < 1 || apiVersion > 100) return null;
  if (fileSize != null && (!Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > 100_000_000)) return null;
  if (fileHash && !/^sha256-[a-f0-9]{64}$/i.test(fileHash)) return null;
  const id = internalName.replace(/Provider$/i, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 64);
  if (!sourceId(id)) return null;
  return {
    id,
    internalName,
    name,
    description: cleanText(plugin.description, 1000),
    iconUrl: cleanText(plugin.iconUrl, 2048),
    pluginUrl,
    repositoryUrl: cleanText(plugin.repositoryUrl, 2048),
    fileHash,
    fileSize,
    apiVersion,
    pluginVersion: version,
    status,
    language: cleanText(plugin.language, 32),
    authors: Array.isArray(plugin.authors) ? plugin.authors.map(v => String(v).slice(0, 100)).slice(0, 16) : [],
    tvTypes: Array.isArray(plugin.tvTypes) ? plugin.tvTypes.map(v => String(v).slice(0, 50)).slice(0, 24) : []
  };
}

async function insertSource(client, item, { preserveManagement = false } = {}) {
  await client.query(
    `INSERT INTO blofy_source_registry(
      id,internal_name,name,description,icon_url,plugin_url,repository_url,file_hash,file_size,
      api_version,plugin_version,status,language,authors,tv_types,enabled,category,priority,rights_note,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,NOW())
    ON CONFLICT(internal_name) DO UPDATE SET
      name=EXCLUDED.name,description=EXCLUDED.description,icon_url=EXCLUDED.icon_url,
      plugin_url=EXCLUDED.plugin_url,repository_url=EXCLUDED.repository_url,file_hash=EXCLUDED.file_hash,
      file_size=EXCLUDED.file_size,api_version=EXCLUDED.api_version,plugin_version=EXCLUDED.plugin_version,
      language=EXCLUDED.language,authors=EXCLUDED.authors,tv_types=EXCLUDED.tv_types,
      status=CASE WHEN $20 THEN blofy_source_registry.status ELSE EXCLUDED.status END,
      enabled=CASE WHEN $20 THEN blofy_source_registry.enabled ELSE EXCLUDED.enabled END,
      category=CASE WHEN $20 THEN blofy_source_registry.category ELSE EXCLUDED.category END,
      priority=CASE WHEN $20 THEN blofy_source_registry.priority ELSE EXCLUDED.priority END,
      rights_note=CASE WHEN $20 THEN blofy_source_registry.rights_note ELSE EXCLUDED.rights_note END,
      updated_at=NOW()`,
    [
      item.id,item.internalName,item.name,item.description || null,item.iconUrl || null,item.pluginUrl,
      item.repositoryUrl || null,item.fileHash || null,item.fileSize ?? null,item.apiVersion || 1,
      item.pluginVersion,item.status,item.language || null,JSON.stringify(item.authors || []),JSON.stringify(item.tvTypes || []),
      item.enabled !== false,item.category || 'other',Number.isFinite(item.priority) ? Math.round(item.priority) : 100,
      item.rightsNote || null,preserveManagement
    ]
  );
}

async function ensureReady() {
  if (!readyPromise) readyPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(718420677)');
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_source_registry (
        id TEXT PRIMARY KEY,
        internal_name TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        icon_url TEXT,
        plugin_url TEXT NOT NULL,
        repository_url TEXT,
        file_hash TEXT,
        file_size BIGINT,
        api_version INTEGER NOT NULL DEFAULT 1,
        plugin_version INTEGER NOT NULL DEFAULT 1,
        status SMALLINT NOT NULL DEFAULT 1 CHECK(status BETWEEN 0 AND 3),
        language TEXT,
        authors JSONB NOT NULL DEFAULT '[]'::jsonb,
        tv_types JSONB NOT NULL DEFAULT '[]'::jsonb,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        category TEXT NOT NULL DEFAULT 'other',
        priority INTEGER NOT NULL DEFAULT 100,
        rights_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_sources_published ON blofy_source_registry(enabled,status,priority)');
      const count = Number((await client.query('SELECT COUNT(*)::int AS count FROM blofy_source_registry')).rows[0]?.count || 0);
      if (!count) {
        for (const item of INITIAL_SOURCES) await insertSource(client, item);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  })().catch(error => { readyPromise = null; throw error; });
  return readyPromise;
}

function origin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwarded === 'http' || forwarded === 'https' ? forwarded : 'https';
  return host ? `${protocol}://${host}` : '';
}

async function rows() {
  await ensureReady();
  const result = await pool.query(`SELECT id,internal_name,name,description,icon_url,plugin_url,repository_url,file_hash,file_size,
    api_version,plugin_version,status,language,authors,tv_types,enabled,category,priority,rights_note,created_at,updated_at
    FROM blofy_source_registry ORDER BY priority ASC,name ASC`);
  return result.rows;
}

function adminItem(row) {
  return {
    id: row.id,
    internalName: row.internal_name,
    name: row.name,
    description: row.description,
    iconUrl: row.icon_url,
    pluginUrl: row.plugin_url,
    repositoryUrl: row.repository_url,
    fileHash: row.file_hash,
    fileSize: row.file_size == null ? null : Number(row.file_size),
    apiVersion: Number(row.api_version),
    version: Number(row.plugin_version),
    status: Number(row.status),
    language: row.language,
    authors: Array.isArray(row.authors) ? row.authors : [],
    tvTypes: Array.isArray(row.tv_types) ? row.tv_types : [],
    enabled: Boolean(row.enabled),
    category: row.category,
    priority: Number(row.priority),
    rightsNote: row.rights_note,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime()
  };
}

function pluginItem(row) {
  const item = {
    iconUrl: row.icon_url || undefined,
    fileHash: row.file_hash || undefined,
    apiVersion: Number(row.api_version),
    repositoryUrl: row.repository_url || SOURCE_REPO_URL,
    fileSize: row.file_size == null ? undefined : Number(row.file_size),
    status: Number(row.status),
    language: row.language || undefined,
    authors: Array.isArray(row.authors) ? row.authors : [],
    tvTypes: Array.isArray(row.tv_types) ? row.tv_types : [],
    version: Number(row.plugin_version),
    internalName: row.internal_name,
    description: row.description || undefined,
    url: row.plugin_url,
    name: row.name
  };
  return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined));
}

async function syncFromGitHub() {
  const response = await fetch(UPSTREAM_PLUGINS_URL, {
    headers: { 'user-agent': 'BLOFY-Sources/1.0', accept: 'application/json' },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw Object.assign(new Error('upstream_unavailable'), { status: 502 });
  const payload = await response.json();
  if (!Array.isArray(payload) || payload.length > 250) throw Object.assign(new Error('invalid_upstream_manifest'), { status: 502 });
  const plugins = payload.map(normalizePlugin).filter(Boolean);
  if (!plugins.length) throw Object.assign(new Error('empty_upstream_manifest'), { status: 502 });
  await ensureReady();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(718420678)');
    for (const plugin of plugins) await insertSource(client, { ...plugin, enabled: true, category: 'other', priority: 100 }, { preserveManagement: true });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
  return plugins.length;
}

async function patchSource(req, res, id) {
  if (!requireAdmin(req, res)) return true;
  await ensureReady();
  const body = await readJson(req);
  const updates = [];
  const values = [];
  const set = (column, value) => { values.push(value); updates.push(`${column}=$${values.length}`); };
  if (body.enabled !== undefined) set('enabled', Boolean(body.enabled));
  if (body.status !== undefined) {
    const status = Number(body.status);
    if (!Number.isInteger(status) || status < 0 || status > 3) return json(res, 400, { error: 'invalid_status' }), true;
    set('status', status);
  }
  if (body.priority !== undefined) {
    const priority = Number(body.priority);
    if (!Number.isFinite(priority) || priority < 0 || priority > 10000) return json(res, 400, { error: 'invalid_priority' }), true;
    set('priority', Math.round(priority));
  }
  if (body.category !== undefined) {
    const category = cleanText(body.category, 64);
    if (!category || !/^[a-z0-9_-]+$/i.test(category)) return json(res, 400, { error: 'invalid_category' }), true;
    set('category', category.toLowerCase());
  }
  if (!updates.length) return json(res, 400, { error: 'nothing_to_update' }), true;
  values.push(id);
  const result = await pool.query(`UPDATE blofy_source_registry SET ${updates.join(',')},updated_at=NOW() WHERE id=$${values.length} RETURNING *`, values);
  if (!result.rows[0]) return json(res, 404, { error: 'source_not_found' }), true;
  json(res, 200, { item: adminItem(result.rows[0]) });
  return true;
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withBlofySources(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    if (res.writableEnded || res.destroyed) return;
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); }
    catch { return listener(req, res); }
    try {
      if (req.method === 'GET' && url.pathname === '/sources-admin') {
        return html(res, await readFile(new URL('../web/sources-admin.html', import.meta.url), 'utf8'));
      }
      if (req.method === 'GET' && url.pathname === '/sources-admin.css') {
        return asset(res, await readFile(new URL('../web/sources-admin.css', import.meta.url)), 'text/css; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/sources-admin.js') {
        return asset(res, await readFile(new URL('../web/sources-admin.js', import.meta.url)), 'text/javascript; charset=utf-8');
      }
      if (req.method === 'GET' && url.pathname === '/sources/repo.json') {
        await ensureReady();
        const base = origin(req);
        return publicJson(res, {
          name: 'BLOFY Sources',
          description: 'BLOFY managed source repository',
          manifestVersion: 1,
          pluginLists: [`${base}/sources/plugins.json`]
        });
      }
      if (req.method === 'GET' && url.pathname === '/sources/plugins.json') {
        const published = (await rows()).filter(row => row.enabled);
        return publicJson(res, published.map(pluginItem));
      }
      if (req.method === 'GET' && url.pathname === '/sources/health') {
        const items = await rows();
        return publicJson(res, {
          ok: true,
          total: items.length,
          enabled: items.filter(item => item.enabled).length,
          down: items.filter(item => item.enabled && Number(item.status) === 0).length,
          slow: items.filter(item => item.enabled && Number(item.status) === 2).length,
          beta: items.filter(item => item.enabled && Number(item.status) === 3).length,
          repo: SOURCE_REPO_URL,
          updatedAt: Math.max(...items.map(item => new Date(item.updated_at).getTime()), 0)
        });
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/admin/sources') {
        if (!requireAdmin(req, res)) return;
        const items = (await rows()).map(adminItem);
        return json(res, 200, { items, upstreamPluginsUrl: UPSTREAM_PLUGINS_URL, publicRepoUrl: `${origin(req)}/sources/repo.json` });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/sources/sync') {
        if (!requireAdmin(req, res)) return;
        const synced = await syncFromGitHub();
        return json(res, 200, { ok: true, synced });
      }
      const sourceMatch = url.pathname.match(/^\/api\/v1\/admin\/sources\/([a-z0-9][a-z0-9-]{1,63})$/i);
      if (sourceMatch && req.method === 'PATCH') return await patchSource(req, res, sourceMatch[1].toLowerCase());

      return listener(req, res);
    } catch (error) {
      console.error('sources request failed:', safeErrorSummary(error));
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const status = Number(error?.status) || (error?.message === 'payload_too_large' ? 413 : 503);
      return json(res, status, { error: status === 503 ? 'sources_unavailable' : String(error?.message || 'request_failed') });
    }
  });
};

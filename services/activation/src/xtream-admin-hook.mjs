import { databaseOptions } from './database-options.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
import {
  assertPublicXtreamUrl,
  decryptXtreamSecret,
  encryptXtreamSecret,
  normalizeXtreamBaseUrl,
  normalizeXtreamCategory,
  normalizeXtreamItem,
  parseTopLevelJsonArray,
  redactXtreamError,
  sanitizeXtreamAccount,
  xtreamApiUrl
} from './xtream-core.mjs';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const KEY_HEX = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const pool = new pg.Pool({
  ...databaseOptions(DATABASE_URL),
  max: 4,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 15000,
  statement_timeout: 30000
});
pool.on('error', error => console.error('xtream database error:', safeErrorSummary(error)));

const limiter = createFixedWindowLimiter({ limit: 180, windowMs: 60_000 });
const syncLocks = new Set();
let readyPromise;

const TYPE_ACTIONS = {
  live: { categories: 'get_live_categories', items: 'get_live_streams' },
  movie: { categories: 'get_vod_categories', items: 'get_vod_streams' },
  series: { categories: 'get_series_categories', items: 'get_series' }
};

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
    'cache-control': 'public, max-age=30, stale-while-revalidate=120',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
    etag
  });
  res.end(payload);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN || !safeEqual(req.headers.authorization || '', `Bearer ${ADMIN_TOKEN}`)) {
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
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 128_000) throw Object.assign(new Error('payload_too_large'), { status: 413 });
    chunks.push(bytes);
  }
  try {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_body');
    return body;
  } catch (error) {
    if (error?.message === 'payload_too_large') throw error;
    throw Object.assign(new Error('invalid_json'), { status: 400 });
  }
}

function cleanText(value, max = 500) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function validType(value) {
  return Object.prototype.hasOwnProperty.call(TYPE_ACTIONS, String(value || '')) ? String(value) : null;
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function ensureReady() {
  if (!readyPromise) readyPromise = (async () => {
    if (!DATABASE_URL) throw new Error('xtream_database_unavailable');
    if (!/^[a-fA-F0-9]{64}$/.test(KEY_HEX)) throw new Error('xtream_encryption_unavailable');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(718420679)');
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_servers (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        username_secret TEXT NOT NULL,
        password_secret TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        publish_catalog BOOLEAN NOT NULL DEFAULT FALSE,
        priority INTEGER NOT NULL DEFAULT 100,
        status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','online','offline','syncing','error')),
        account_info JSONB NOT NULL DEFAULT '{}'::jsonb,
        counts JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_error TEXT,
        last_test_at TIMESTAMPTZ,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_categories (
        server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
        source_category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        item_count INTEGER NOT NULL DEFAULT 0,
        sync_token TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(server_id,media_type,source_category_id)
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_items (
        server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
        source_id TEXT NOT NULL,
        category_id TEXT,
        name TEXT NOT NULL,
        icon_url TEXT,
        container_extension TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        sync_token TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(server_id,media_type,source_id)
      )`);
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_servers_publish ON blofy_xtream_servers(enabled,publish_catalog,priority)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_categories_filter ON blofy_xtream_categories(server_id,media_type,enabled,name)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_items_filter ON blofy_xtream_items(server_id,media_type,category_id,enabled,name)');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  })().catch(error => { readyPromise = null; throw error; });
  return readyPromise;
}

function decryptCredentials(row) {
  return {
    username: decryptXtreamSecret(row.username_secret, KEY_HEX, `username:${row.id}`),
    password: decryptXtreamSecret(row.password_secret, KEY_HEX, `password:${row.id}`)
  };
}

function adminServer(row) {
  const counts = row.counts && typeof row.counts === 'object' ? row.counts : {};
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
    publishCatalog: Boolean(row.publish_catalog),
    priority: Number(row.priority),
    status: row.status,
    accountInfo: row.account_info || {},
    counts,
    syncing: syncLocks.has(row.id),
    lastError: row.last_error,
    lastTestAt: row.last_test_at ? new Date(row.last_test_at).getTime() : null,
    lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
    transportSecurity: String(row.base_url || '').toLowerCase().startsWith('https://') ? 'https' : 'http',
    credentialsStored: true
  };
}

async function serverRows() {
  await ensureReady();
  return (await pool.query('SELECT * FROM blofy_xtream_servers ORDER BY priority ASC,name ASC')).rows;
}

async function serverById(id) {
  await ensureReady();
  if (!validUuid(id)) return null;
  return (await pool.query('SELECT * FROM blofy_xtream_servers WHERE id=$1', [id])).rows[0] || null;
}

async function checkedFetch(url, { timeoutMs = 30000 } = {}) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertPublicXtreamUrl(`${current.protocol}//${current.host}`);
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json,text/plain;q=0.8,*/*;q=0.1', 'user-agent': 'BLOFY-Xtream/1.0' },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('xtream_redirect_invalid');
      current = new URL(location, current);
      if (!['http:', 'https:'].includes(current.protocol)) throw new Error('xtream_redirect_invalid');
      continue;
    }
    if (!response.ok) throw new Error(`xtream_http_${response.status}`);
    return response;
  }
  throw new Error('xtream_redirect_loop');
}

async function fetchAccount(row) {
  const creds = decryptCredentials(row);
  await assertPublicXtreamUrl(row.base_url);
  const response = await checkedFetch(xtreamApiUrl(row.base_url, creds.username, creds.password), { timeoutMs: 20000 });
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_000_000) throw new Error('xtream_account_response_too_large');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('xtream_account_response_invalid'); }
  const info = sanitizeXtreamAccount(payload);
  if (!info.authenticated) throw Object.assign(new Error('xtream_auth_failed'), { status: 401 });
  return info;
}

async function testServer(id) {
  const row = await serverById(id);
  if (!row) throw Object.assign(new Error('xtream_server_not_found'), { status: 404 });
  try {
    const info = await fetchAccount(row);
    const result = await pool.query(`UPDATE blofy_xtream_servers SET status='online',account_info=$2::jsonb,last_error=NULL,last_test_at=NOW(),updated_at=NOW()
      WHERE id=$1 RETURNING *`, [id, JSON.stringify(info)]);
    return adminServer(result.rows[0]);
  } catch (error) {
    const message = redactXtreamError(error);
    await pool.query(`UPDATE blofy_xtream_servers SET status='offline',last_error=$2,last_test_at=NOW(),updated_at=NOW() WHERE id=$1`, [id, message]).catch(() => {});
    throw error;
  }
}

async function flushCategoryBatch(serverId, mediaType, syncToken, batch) {
  if (!batch.length) return;
  const payload = batch.map(item => ({
    source_category_id: item.sourceCategoryId,
    name: item.name,
    parent_id: item.parentId,
    sync_token: syncToken
  }));
  await pool.query(`INSERT INTO blofy_xtream_categories(server_id,media_type,source_category_id,name,parent_id,enabled,item_count,sync_token,updated_at)
    SELECT $1::uuid,$2::text,x.source_category_id,x.name,x.parent_id,TRUE,0,x.sync_token,NOW()
    FROM jsonb_to_recordset($3::jsonb) AS x(source_category_id text,name text,parent_id text,sync_token text)
    ON CONFLICT(server_id,media_type,source_category_id) DO UPDATE SET
      name=EXCLUDED.name,parent_id=EXCLUDED.parent_id,sync_token=EXCLUDED.sync_token,updated_at=NOW()`,
    [serverId, mediaType, JSON.stringify(payload)]);
  batch.length = 0;
}

async function flushItemBatch(serverId, mediaType, syncToken, batch) {
  if (!batch.length) return;
  const payload = batch.map(item => ({
    source_id: item.sourceId,
    category_id: item.categoryId,
    name: item.name,
    icon_url: item.iconUrl,
    container_extension: item.containerExtension,
    metadata: item.metadata,
    sync_token: syncToken
  }));
  await pool.query(`INSERT INTO blofy_xtream_items(server_id,media_type,source_id,category_id,name,icon_url,container_extension,enabled,metadata,sync_token,updated_at)
    SELECT $1::uuid,$2::text,x.source_id,x.category_id,x.name,x.icon_url,x.container_extension,TRUE,COALESCE(x.metadata,'{}'::jsonb),x.sync_token,NOW()
    FROM jsonb_to_recordset($3::jsonb) AS x(source_id text,category_id text,name text,icon_url text,container_extension text,metadata jsonb,sync_token text)
    ON CONFLICT(server_id,media_type,source_id) DO UPDATE SET
      category_id=EXCLUDED.category_id,name=EXCLUDED.name,icon_url=EXCLUDED.icon_url,
      container_extension=EXCLUDED.container_extension,metadata=EXCLUDED.metadata,sync_token=EXCLUDED.sync_token,updated_at=NOW()`,
    [serverId, mediaType, JSON.stringify(payload)]);
  batch.length = 0;
}

async function syncCategories(row, mediaType, creds, syncToken) {
  const action = TYPE_ACTIONS[mediaType].categories;
  const response = await checkedFetch(xtreamApiUrl(row.base_url, creds.username, creds.password, action), { timeoutMs: 60000 });
  const batch = [];
  let accepted = 0;
  await parseTopLevelJsonArray(response.body, async raw => {
    const item = normalizeXtreamCategory(mediaType, raw, syncToken);
    if (!item) return;
    batch.push(item);
    accepted++;
    if (batch.length >= 500) await flushCategoryBatch(row.id, mediaType, syncToken, batch);
  });
  await flushCategoryBatch(row.id, mediaType, syncToken, batch);
  return accepted;
}

async function syncItems(row, mediaType, creds, syncToken) {
  const action = TYPE_ACTIONS[mediaType].items;
  const response = await checkedFetch(xtreamApiUrl(row.base_url, creds.username, creds.password, action), { timeoutMs: 180000 });
  const batch = [];
  let accepted = 0;
  await parseTopLevelJsonArray(response.body, async raw => {
    const item = normalizeXtreamItem(mediaType, raw, syncToken);
    if (!item) return;
    batch.push(item);
    accepted++;
    if (batch.length >= 500) await flushItemBatch(row.id, mediaType, syncToken, batch);
  });
  await flushItemBatch(row.id, mediaType, syncToken, batch);
  return accepted;
}

async function finalizeTypeSync(serverId, mediaType, syncToken) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM blofy_xtream_items WHERE server_id=$1 AND media_type=$2 AND sync_token IS DISTINCT FROM $3', [serverId, mediaType, syncToken]);
    await client.query('DELETE FROM blofy_xtream_categories WHERE server_id=$1 AND media_type=$2 AND sync_token IS DISTINCT FROM $3', [serverId, mediaType, syncToken]);
    await client.query(`UPDATE blofy_xtream_categories c SET item_count=s.count,updated_at=NOW()
      FROM (SELECT category_id,COUNT(*)::int AS count FROM blofy_xtream_items WHERE server_id=$1 AND media_type=$2 GROUP BY category_id) s
      WHERE c.server_id=$1 AND c.media_type=$2 AND c.source_category_id=s.category_id`, [serverId, mediaType]);
    await client.query(`UPDATE blofy_xtream_categories SET item_count=0,updated_at=NOW()
      WHERE server_id=$1 AND media_type=$2 AND NOT EXISTS (
        SELECT 1 FROM blofy_xtream_items i WHERE i.server_id=$1 AND i.media_type=$2 AND i.category_id=blofy_xtream_categories.source_category_id
      )`, [serverId, mediaType]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function calculateCounts(serverId) {
  const result = await pool.query(`SELECT media_type,COUNT(*)::int AS count FROM blofy_xtream_items WHERE server_id=$1 GROUP BY media_type`, [serverId]);
  const categoryResult = await pool.query(`SELECT media_type,COUNT(*)::int AS count FROM blofy_xtream_categories WHERE server_id=$1 GROUP BY media_type`, [serverId]);
  const counts = { live: 0, movie: 0, series: 0, categories: { live: 0, movie: 0, series: 0 } };
  for (const row of result.rows) if (Object.hasOwn(counts, row.media_type)) counts[row.media_type] = Number(row.count);
  for (const row of categoryResult.rows) if (Object.hasOwn(counts.categories, row.media_type)) counts.categories[row.media_type] = Number(row.count);
  counts.total = counts.live + counts.movie + counts.series;
  return counts;
}

async function syncServer(id, requestedTypes = ['live','movie','series']) {
  if (syncLocks.has(id)) throw Object.assign(new Error('xtream_sync_in_progress'), { status: 409 });
  const row = await serverById(id);
  if (!row) throw Object.assign(new Error('xtream_server_not_found'), { status: 404 });
  const types = [...new Set(requestedTypes.map(validType).filter(Boolean))];
  if (!types.length) throw Object.assign(new Error('xtream_sync_types_invalid'), { status: 400 });
  syncLocks.add(id);
  await pool.query(`UPDATE blofy_xtream_servers SET status='syncing',last_error=NULL,updated_at=NOW() WHERE id=$1`, [id]);
  try {
    const accountInfo = await fetchAccount(row);
    const creds = decryptCredentials(row);
    const details = {};
    for (const mediaType of types) {
      const syncToken = crypto.randomUUID();
      const categories = await syncCategories(row, mediaType, creds, syncToken);
      const items = await syncItems(row, mediaType, creds, syncToken);
      await finalizeTypeSync(id, mediaType, syncToken);
      details[mediaType] = { categories, items };
    }
    const counts = await calculateCounts(id);
    await pool.query(`UPDATE blofy_xtream_servers SET status='online',account_info=$2::jsonb,counts=$3::jsonb,last_error=NULL,last_test_at=NOW(),last_sync_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [id, JSON.stringify(accountInfo), JSON.stringify(counts)]);
    return { id, counts, details };
  } catch (error) {
    const message = redactXtreamError(error);
    await pool.query(`UPDATE blofy_xtream_servers SET status='error',last_error=$2,updated_at=NOW() WHERE id=$1`, [id, message]).catch(() => {});
    throw error;
  } finally {
    syncLocks.delete(id);
  }
}

function startSync(id, types) {
  if (syncLocks.has(id)) throw Object.assign(new Error('xtream_sync_in_progress'), { status: 409 });
  void syncServer(id, types).catch(error => console.error('xtream sync failed:', id, redactXtreamError(error)));
}

async function createServer(body) {
  await ensureReady();
  const name = cleanText(body.name, 160);
  const username = cleanText(body.username, 512);
  const password = cleanText(body.password, 1024);
  if (!name || !username || !password) throw Object.assign(new Error('xtream_fields_required'), { status: 400 });
  const baseUrl = await assertPublicXtreamUrl(body.baseUrl);
  const priority = Number.isFinite(Number(body.priority)) ? Math.max(0, Math.min(10000, Math.round(Number(body.priority)))) : 100;
  const id = crypto.randomUUID();
  const usernameSecret = encryptXtreamSecret(username, KEY_HEX, `username:${id}`);
  const passwordSecret = encryptXtreamSecret(password, KEY_HEX, `password:${id}`);
  const result = await pool.query(`INSERT INTO blofy_xtream_servers(id,name,base_url,username_secret,password_secret,enabled,publish_catalog,priority)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [id, name, baseUrl, usernameSecret, passwordSecret, body.enabled !== false, Boolean(body.publishCatalog), priority]);
  return adminServer(result.rows[0]);
}

async function patchServer(id, body) {
  const current = await serverById(id);
  if (!current) throw Object.assign(new Error('xtream_server_not_found'), { status: 404 });
  const updates = [];
  const values = [];
  const set = (column, value) => { values.push(value); updates.push(`${column}=$${values.length}`); };
  if (body.name !== undefined) {
    const name = cleanText(body.name, 160);
    if (!name) throw Object.assign(new Error('xtream_name_invalid'), { status: 400 });
    set('name', name);
  }
  if (body.baseUrl !== undefined) set('base_url', await assertPublicXtreamUrl(body.baseUrl));
  if (body.username !== undefined && String(body.username).trim()) {
    set('username_secret', encryptXtreamSecret(cleanText(body.username, 512), KEY_HEX, `username:${id}`));
  }
  if (body.password !== undefined && String(body.password).trim()) {
    set('password_secret', encryptXtreamSecret(cleanText(body.password, 1024), KEY_HEX, `password:${id}`));
  }
  if (body.enabled !== undefined) set('enabled', Boolean(body.enabled));
  if (body.publishCatalog !== undefined) set('publish_catalog', Boolean(body.publishCatalog));
  if (body.priority !== undefined) {
    const priority = Number(body.priority);
    if (!Number.isFinite(priority) || priority < 0 || priority > 10000) throw Object.assign(new Error('xtream_priority_invalid'), { status: 400 });
    set('priority', Math.round(priority));
  }
  if (!updates.length) throw Object.assign(new Error('nothing_to_update'), { status: 400 });
  values.push(id);
  const result = await pool.query(`UPDATE blofy_xtream_servers SET ${updates.join(',')},updated_at=NOW() WHERE id=$${values.length} RETURNING *`, values);
  return adminServer(result.rows[0]);
}

async function listCategories(serverId, mediaType) {
  await ensureReady();
  const where = [];
  const values = [];
  if (serverId) { if (!validUuid(serverId)) throw Object.assign(new Error('xtream_server_id_invalid'), { status: 400 }); values.push(serverId); where.push(`server_id=$${values.length}`); }
  if (mediaType) { const type = validType(mediaType); if (!type) throw Object.assign(new Error('xtream_type_invalid'), { status: 400 }); values.push(type); where.push(`media_type=$${values.length}`); }
  const sql = `SELECT server_id,media_type,source_category_id,name,parent_id,enabled,item_count,updated_at FROM blofy_xtream_categories ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY media_type,name LIMIT 5000`;
  return (await pool.query(sql, values)).rows.map(row => ({
    serverId: row.server_id,
    mediaType: row.media_type,
    id: row.source_category_id,
    name: row.name,
    parentId: row.parent_id,
    enabled: Boolean(row.enabled),
    itemCount: Number(row.item_count),
    updatedAt: new Date(row.updated_at).getTime()
  }));
}

async function listCatalog(query, publishedOnly = false) {
  await ensureReady();
  const mediaType = validType(query.type);
  if (!mediaType) throw Object.assign(new Error('xtream_type_required'), { status: 400 });
  const limit = Math.max(1, Math.min(publishedOnly ? 100 : 250, Number(query.limit) || 60));
  const offset = Math.max(0, Math.min(1_000_000, Number(query.offset) || 0));
  const where = ['i.media_type=$1'];
  const values = [mediaType];
  if (publishedOnly) where.push('s.enabled=TRUE', 's.publish_catalog=TRUE', 'i.enabled=TRUE', '(c.enabled IS NULL OR c.enabled=TRUE)');
  if (query.serverId) { if (!validUuid(query.serverId)) throw Object.assign(new Error('xtream_server_id_invalid'), { status: 400 }); values.push(query.serverId); where.push(`i.server_id=$${values.length}`); }
  if (query.categoryId) { values.push(String(query.categoryId)); where.push(`i.category_id=$${values.length}`); }
  if (query.q) { values.push(`%${String(query.q).slice(0,120).replace(/[%_]/g, '\\$&')}%`); where.push(`i.name ILIKE $${values.length} ESCAPE '\\'`); }
  values.push(limit, offset);
  const rows = (await pool.query(`SELECT i.server_id,i.media_type,i.source_id,i.category_id,i.name,i.icon_url,i.container_extension,i.enabled,i.metadata,i.updated_at,
      s.name AS server_name,s.priority,c.name AS category_name,c.enabled AS category_enabled
    FROM blofy_xtream_items i
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY s.priority ASC,i.name ASC LIMIT $${values.length-1} OFFSET $${values.length}`, values)).rows;
  return rows.map(row => ({
    serverId: row.server_id,
    serverName: row.server_name,
    type: row.media_type,
    id: row.source_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    iconUrl: row.icon_url,
    containerExtension: row.container_extension,
    enabled: Boolean(row.enabled),
    categoryEnabled: row.category_enabled == null ? true : Boolean(row.category_enabled),
    metadata: row.metadata || {},
    updatedAt: new Date(row.updated_at).getTime()
  }));
}

async function patchCategory(serverId, mediaType, categoryId, enabled) {
  if (!validUuid(serverId) || !validType(mediaType)) throw Object.assign(new Error('xtream_category_invalid'), { status: 400 });
  const result = await pool.query(`UPDATE blofy_xtream_categories SET enabled=$4,updated_at=NOW() WHERE server_id=$1 AND media_type=$2 AND source_category_id=$3 RETURNING *`,
    [serverId, mediaType, categoryId, Boolean(enabled)]);
  if (!result.rows[0]) throw Object.assign(new Error('xtream_category_not_found'), { status: 404 });
  return result.rows[0];
}

async function patchItem(serverId, mediaType, sourceId, enabled) {
  if (!validUuid(serverId) || !validType(mediaType)) throw Object.assign(new Error('xtream_item_invalid'), { status: 400 });
  const result = await pool.query(`UPDATE blofy_xtream_items SET enabled=$4,updated_at=NOW() WHERE server_id=$1 AND media_type=$2 AND source_id=$3 RETURNING server_id,media_type,source_id,enabled`,
    [serverId, mediaType, sourceId, Boolean(enabled)]);
  if (!result.rows[0]) throw Object.assign(new Error('xtream_item_not_found'), { status: 404 });
  return result.rows[0];
}

async function bulkToggle(body) {
  const serverId = String(body.serverId || '');
  const mediaType = validType(body.mediaType);
  if (!validUuid(serverId) || !mediaType) throw Object.assign(new Error('xtream_bulk_invalid'), { status: 400 });
  const enabled = Boolean(body.enabled);
  const target = ['categories','items','both'].includes(body.target) ? body.target : 'both';
  const categoryId = body.categoryId == null ? null : String(body.categoryId);
  let categories = 0;
  let items = 0;
  if (target === 'categories' || target === 'both') {
    const result = categoryId
      ? await pool.query('UPDATE blofy_xtream_categories SET enabled=$4,updated_at=NOW() WHERE server_id=$1 AND media_type=$2 AND source_category_id=$3', [serverId,mediaType,categoryId,enabled])
      : await pool.query('UPDATE blofy_xtream_categories SET enabled=$3,updated_at=NOW() WHERE server_id=$1 AND media_type=$2', [serverId,mediaType,enabled]);
    categories = result.rowCount;
  }
  if (target === 'items' || target === 'both') {
    const result = categoryId
      ? await pool.query('UPDATE blofy_xtream_items SET enabled=$4,updated_at=NOW() WHERE server_id=$1 AND media_type=$2 AND category_id=$3', [serverId,mediaType,categoryId,enabled])
      : await pool.query('UPDATE blofy_xtream_items SET enabled=$3,updated_at=NOW() WHERE server_id=$1 AND media_type=$2', [serverId,mediaType,enabled]);
    items = result.rowCount;
  }
  return { categories, items, enabled };
}

async function publicSummary() {
  await ensureReady();
  const servers = (await pool.query(`SELECT id,name,priority,status,counts,last_sync_at FROM blofy_xtream_servers WHERE enabled=TRUE AND publish_catalog=TRUE ORDER BY priority,name`)).rows;
  return {
    ok: true,
    playbackProxy: false,
    servers: servers.map(row => ({ id: row.id, name: row.name, status: row.status, counts: row.counts || {}, lastSyncAt: row.last_sync_at ? new Date(row.last_sync_at).getTime() : null }))
  };
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withBlofyXtream(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    if (res.writableEnded || res.destroyed) return;
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); }
    catch { return listener(req, res); }
    try {
      if (req.method === 'GET' && url.pathname === '/sources/xtream/summary') return publicJson(res, await publicSummary());
      if (req.method === 'GET' && url.pathname === '/sources/xtream/catalog') {
        return publicJson(res, { items: await listCatalog(Object.fromEntries(url.searchParams), true) });
      }
      if (!url.pathname.startsWith('/api/v1/admin/xtream')) return listener(req, res);
      if (!requireAdmin(req, res)) return;
      await ensureReady();

      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream/servers') {
        const items = (await serverRows()).map(adminServer);
        const totals = items.reduce((acc, item) => {
          acc.servers++;
          acc.live += Number(item.counts.live || 0);
          acc.movie += Number(item.counts.movie || 0);
          acc.series += Number(item.counts.series || 0);
          if (item.status === 'online') acc.online++;
          if (item.status === 'syncing' || item.syncing) acc.syncing++;
          return acc;
        }, { servers: 0, online: 0, syncing: 0, live: 0, movie: 0, series: 0 });
        totals.total = totals.live + totals.movie + totals.series;
        return json(res, 200, { items, totals });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream/servers') {
        const item = await createServer(await readJson(req));
        return json(res, 201, { item });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream/categories') {
        return json(res, 200, { items: await listCategories(url.searchParams.get('serverId'), url.searchParams.get('type')) });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream/catalog') {
        return json(res, 200, { items: await listCatalog(Object.fromEntries(url.searchParams), false) });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream/bulk') {
        return json(res, 200, await bulkToggle(await readJson(req)));
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream/sync-all') {
        const rows = await serverRows();
        const started = [];
        for (const row of rows.filter(item => item.enabled)) {
          if (syncLocks.has(row.id)) continue;
          startSync(row.id, ['live','movie','series']);
          started.push(row.id);
        }
        return json(res, 202, { started });
      }

      const serverMatch = url.pathname.match(/^\/api\/v1\/admin\/xtream\/servers\/([0-9a-f-]+)(?:\/(test|sync))?$/i);
      if (serverMatch) {
        const id = serverMatch[1];
        const action = serverMatch[2];
        if (!validUuid(id)) return json(res, 400, { error: 'xtream_server_id_invalid' });
        if (!action && req.method === 'PATCH') return json(res, 200, { item: await patchServer(id, await readJson(req)) });
        if (!action && req.method === 'DELETE') {
          const result = await pool.query('DELETE FROM blofy_xtream_servers WHERE id=$1', [id]);
          return json(res, result.rowCount ? 200 : 404, result.rowCount ? { deleted: true } : { error: 'xtream_server_not_found' });
        }
        if (action === 'test' && req.method === 'POST') return json(res, 200, { item: await testServer(id) });
        if (action === 'sync' && req.method === 'POST') {
          const body = await readJson(req);
          const types = Array.isArray(body.types) ? body.types : ['live','movie','series'];
          startSync(id, types);
          return json(res, 202, { started: true, id, types: types.map(validType).filter(Boolean) });
        }
      }

      const categoryMatch = url.pathname.match(/^\/api\/v1\/admin\/xtream\/categories\/([0-9a-f-]+)\/(live|movie|series)\/([^/]+)$/i);
      if (categoryMatch && req.method === 'PATCH') {
        const body = await readJson(req);
        if (body.enabled === undefined) return json(res, 400, { error: 'nothing_to_update' });
        await patchCategory(categoryMatch[1], categoryMatch[2].toLowerCase(), decodeURIComponent(categoryMatch[3]), body.enabled);
        return json(res, 200, { updated: true });
      }

      const itemMatch = url.pathname.match(/^\/api\/v1\/admin\/xtream\/items\/([0-9a-f-]+)\/(live|movie|series)\/([^/]+)$/i);
      if (itemMatch && req.method === 'PATCH') {
        const body = await readJson(req);
        if (body.enabled === undefined) return json(res, 400, { error: 'nothing_to_update' });
        await patchItem(itemMatch[1], itemMatch[2].toLowerCase(), decodeURIComponent(itemMatch[3]), body.enabled);
        return json(res, 200, { updated: true });
      }

      return json(res, 404, { error: 'xtream_route_not_found' });
    } catch (error) {
      console.error('xtream request failed:', redactXtreamError(error));
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const status = Number(error?.status) || (String(error?.message || '').includes('private_host') ? 400 : 503);
      return json(res, status, { error: status === 503 ? 'xtream_unavailable' : String(error?.message || 'xtream_request_failed') });
    }
  });
};

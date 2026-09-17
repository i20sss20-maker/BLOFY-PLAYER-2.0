import { databaseOptions } from './database-options.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
import { ensureXtreamAdminReady } from './xtream-admin-hook.mjs';
import {
  assertPublicXtreamUrl,
  decryptXtreamSecret,
  normalizeXtreamBaseUrl,
  redactXtreamError,
  xtreamApiUrl
} from './xtream-core.mjs';
import {
  escapeM3uAttribute,
  formatGatewayCategory,
  formatGatewayItem,
  gatewayCredentialProof,
  generateGatewayPassword,
  generateGatewayUsername,
  normalizeGatewayPassword,
  normalizeGatewayUsername,
  safeGatewayExtension,
  stripUpstreamSecrets,
  verifyGatewayCredential
} from './xtream-gateway-core.mjs';
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import pg from 'pg';

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const KEY_HEX = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const pool = new pg.Pool({
  ...databaseOptions(DATABASE_URL),
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 15000,
  statement_timeout: 30000
});
pool.on('error', error => console.error('xtream gateway database error:', safeErrorSummary(error)));

const adminLimiter = createFixedWindowLimiter({ limit: 120, windowMs: 60_000 });
const publicLimiter = createFixedWindowLimiter({ limit: 1200, windowMs: 60_000 });
let readyPromise;

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

function text(res, status, body, contentType = 'text/plain; charset=utf-8', extra = {}) {
  const payload = String(body);
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra
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
  const rate = adminLimiter.consume(requestClientKey(req));
  if (!rate.allowed) {
    json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfterSeconds) });
    return false;
  }
  return true;
}

function requirePublicBudget(req, res) {
  const rate = publicLimiter.consume(requestClientKey(req));
  if (rate.allowed) return true;
  json(res, 429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfterSeconds) });
  return false;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64_000) throw Object.assign(new Error('payload_too_large'), { status: 413 });
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

function origin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwarded === 'http' || forwarded === 'https' ? forwarded : 'https';
  return host ? `${protocol}://${host}` : '';
}

function cleanLabel(value, fallback = 'BLOFY') {
  const text = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return (text || fallback).slice(0, 120);
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function ensureReady() {
  if (!readyPromise) readyPromise = (async () => {
    if (!DATABASE_URL) throw new Error('xtream_gateway_database_unavailable');
    if (!/^[a-fA-F0-9]{64}$/.test(KEY_HEX)) throw new Error('xtream_gateway_encryption_unavailable');
    await ensureXtreamAdminReady();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(718420681)');
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_accounts (
        id UUID PRIMARY KEY,
        label TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_proof TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        max_connections INTEGER NOT NULL DEFAULT 1 CHECK(max_connections BETWEEN 1 AND 20),
        expires_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_category_map (
        gateway_id BIGSERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
        source_category_id TEXT NOT NULL,
        UNIQUE(server_id,media_type,source_category_id)
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_item_map (
        gateway_id BIGSERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
        source_id TEXT NOT NULL,
        UNIQUE(server_id,media_type,source_id)
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_gateway_episode_map (
        gateway_id BIGSERIAL PRIMARY KEY,
        server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
        series_source_id TEXT NOT NULL,
        source_episode_id TEXT NOT NULL,
        container_extension TEXT,
        UNIQUE(server_id,series_source_id,source_episode_id)
      )`);
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_gateway_accounts_user ON blofy_xtream_gateway_accounts(username,enabled)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_gateway_item_lookup ON blofy_xtream_gateway_item_map(server_id,media_type,source_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_gateway_episode_lookup ON blofy_xtream_gateway_episode_map(server_id,source_episode_id)');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  })().catch(error => { readyPromise = null; throw error; });
  return readyPromise;
}

function adminAccount(row) {
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    enabled: Boolean(row.enabled),
    maxConnections: Number(row.max_connections),
    expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null
  };
}

async function listAccounts() {
  await ensureReady();
  return (await pool.query('SELECT * FROM blofy_xtream_gateway_accounts ORDER BY created_at DESC')).rows.map(adminAccount);
}

async function createAccount(body, req) {
  await ensureReady();
  const label = cleanLabel(body.label, 'BLOFY Player');
  const maxConnections = Math.max(1, Math.min(20, Number(body.maxConnections) || 1));
  let username = body.username ? normalizeGatewayUsername(body.username) : null;
  const password = body.password ? normalizeGatewayPassword(body.password) : generateGatewayPassword();
  let expiresAt = null;
  if (body.expiresAt != null && body.expiresAt !== '') {
    const parsed = new Date(body.expiresAt);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() <= Date.now()) throw Object.assign(new Error('xtream_gateway_expiry_invalid'), { status: 400 });
    expiresAt = parsed;
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!username) username = generateGatewayUsername();
    const id = crypto.randomUUID();
    const proof = gatewayCredentialProof(username, password, KEY_HEX);
    try {
      const row = (await pool.query(`INSERT INTO blofy_xtream_gateway_accounts(id,label,username,password_proof,enabled,max_connections,expires_at)
        VALUES($1,$2,$3,$4,TRUE,$5,$6) RETURNING *`, [id,label,username,proof,maxConnections,expiresAt])).rows[0];
      return {
        item: adminAccount(row),
        credentials: { serverUrl: origin(req), username, password }
      };
    } catch (error) {
      if (error?.code === '23505' && !body.username) { username = null; continue; }
      if (error?.code === '23505') throw Object.assign(new Error('xtream_gateway_username_exists'), { status: 409 });
      throw error;
    }
  }
  throw Object.assign(new Error('xtream_gateway_username_generation_failed'), { status: 503 });
}

async function patchAccount(id, body) {
  await ensureReady();
  if (!validUuid(id)) throw Object.assign(new Error('xtream_gateway_account_invalid'), { status: 400 });
  const updates = [];
  const values = [];
  const set = (column, value) => { values.push(value); updates.push(`${column}=$${values.length}`); };
  if (body.label !== undefined) set('label', cleanLabel(body.label));
  if (body.enabled !== undefined) set('enabled', Boolean(body.enabled));
  if (body.maxConnections !== undefined) {
    const max = Number(body.maxConnections);
    if (!Number.isInteger(max) || max < 1 || max > 20) throw Object.assign(new Error('xtream_gateway_max_connections_invalid'), { status: 400 });
    set('max_connections', max);
  }
  if (body.expiresAt !== undefined) {
    if (body.expiresAt == null || body.expiresAt === '') set('expires_at', null);
    else {
      const parsed = new Date(body.expiresAt);
      if (!Number.isFinite(parsed.getTime())) throw Object.assign(new Error('xtream_gateway_expiry_invalid'), { status: 400 });
      set('expires_at', parsed);
    }
  }
  if (!updates.length) throw Object.assign(new Error('nothing_to_update'), { status: 400 });
  values.push(id);
  const row = (await pool.query(`UPDATE blofy_xtream_gateway_accounts SET ${updates.join(',')},updated_at=NOW() WHERE id=$${values.length} RETURNING *`, values)).rows[0];
  if (!row) throw Object.assign(new Error('xtream_gateway_account_not_found'), { status: 404 });
  return adminAccount(row);
}

async function resetAccountPassword(id, req) {
  await ensureReady();
  if (!validUuid(id)) throw Object.assign(new Error('xtream_gateway_account_invalid'), { status: 400 });
  const existing = (await pool.query('SELECT * FROM blofy_xtream_gateway_accounts WHERE id=$1', [id])).rows[0];
  if (!existing) throw Object.assign(new Error('xtream_gateway_account_not_found'), { status: 404 });
  const password = generateGatewayPassword();
  const proof = gatewayCredentialProof(existing.username, password, KEY_HEX);
  const row = (await pool.query('UPDATE blofy_xtream_gateway_accounts SET password_proof=$2,updated_at=NOW() WHERE id=$1 RETURNING *', [id, proof])).rows[0];
  return { item: adminAccount(row), credentials: { serverUrl: origin(req), username: row.username, password } };
}

async function authenticate(usernameInput, passwordInput, { touch = false } = {}) {
  await ensureReady();
  let username, password;
  try {
    username = normalizeGatewayUsername(usernameInput);
    password = normalizeGatewayPassword(passwordInput);
  } catch { return null; }
  const row = (await pool.query('SELECT * FROM blofy_xtream_gateway_accounts WHERE username=$1', [username])).rows[0];
  if (!row || !row.enabled) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (!verifyGatewayCredential(row.password_proof, username, password, KEY_HEX)) return null;
  if (touch) void pool.query('UPDATE blofy_xtream_gateway_accounts SET last_used_at=NOW() WHERE id=$1', [row.id]).catch(() => {});
  return row;
}

async function ensureCategoryMaps(mediaType) {
  await ensureReady();
  await pool.query(`INSERT INTO blofy_xtream_gateway_category_map(server_id,media_type,source_category_id)
    SELECT c.server_id,c.media_type,c.source_category_id
    FROM blofy_xtream_categories c
    JOIN blofy_xtream_servers s ON s.id=c.server_id
    WHERE c.media_type=$1 AND c.enabled=TRUE AND s.enabled=TRUE
    ON CONFLICT(server_id,media_type,source_category_id) DO NOTHING`, [mediaType]);
}

async function ensureItemMaps(mediaType) {
  await ensureReady();
  await pool.query(`INSERT INTO blofy_xtream_gateway_item_map(server_id,media_type,source_id)
    SELECT i.server_id,i.media_type,i.source_id
    FROM blofy_xtream_items i
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
    WHERE i.media_type=$1 AND i.enabled=TRUE AND s.enabled=TRUE AND (c.enabled IS NULL OR c.enabled=TRUE)
    ON CONFLICT(server_id,media_type,source_id) DO NOTHING`, [mediaType]);
}

async function gatewayCategories(mediaType) {
  await ensureCategoryMaps(mediaType);
  return (await pool.query(`SELECT m.gateway_id,c.name
    FROM blofy_xtream_gateway_category_map m
    JOIN blofy_xtream_categories c ON c.server_id=m.server_id AND c.media_type=m.media_type AND c.source_category_id=m.source_category_id
    JOIN blofy_xtream_servers s ON s.id=c.server_id
    WHERE m.media_type=$1 AND c.enabled=TRUE AND s.enabled=TRUE
    ORDER BY s.priority,c.name`, [mediaType])).rows.map(formatGatewayCategory);
}

async function categoryFilter(mediaType, gatewayId) {
  if (gatewayId == null || gatewayId === '' || String(gatewayId) === '0') return null;
  const id = Number(gatewayId);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('xtream_gateway_category_invalid'), { status: 400 });
  const row = (await pool.query('SELECT server_id,source_category_id FROM blofy_xtream_gateway_category_map WHERE gateway_id=$1 AND media_type=$2', [id,mediaType])).rows[0];
  if (!row) throw Object.assign(new Error('xtream_gateway_category_not_found'), { status: 404 });
  return row;
}

async function walkGatewayItems(mediaType, filter, onRow) {
  await ensureCategoryMaps(mediaType);
  await ensureItemMaps(mediaType);
  let lastId = 0;
  for (;;) {
    const values = [mediaType, lastId];
    const where = ['m.media_type=$1','m.gateway_id>$2','s.enabled=TRUE','i.enabled=TRUE','(c.enabled IS NULL OR c.enabled=TRUE)'];
    if (filter) {
      values.push(filter.server_id, filter.source_category_id);
      where.push(`i.server_id=$${values.length-1}`, `i.category_id=$${values.length}`);
    }
    values.push(2000);
    const rows = (await pool.query(`SELECT m.gateway_id,i.server_id,i.source_id,i.category_id,i.name,i.icon_url,i.container_extension,i.metadata,
        cm.gateway_id AS category_gateway_id,s.priority
      FROM blofy_xtream_gateway_item_map m
      JOIN blofy_xtream_items i ON i.server_id=m.server_id AND i.media_type=m.media_type AND i.source_id=m.source_id
      JOIN blofy_xtream_servers s ON s.id=i.server_id
      LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
      LEFT JOIN blofy_xtream_gateway_category_map cm ON cm.server_id=i.server_id AND cm.media_type=i.media_type AND cm.source_category_id=i.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY m.gateway_id ASC LIMIT $${values.length}`, values)).rows;
    if (!rows.length) break;
    for (const row of rows) await onRow(row);
    lastId = Number(rows[rows.length - 1].gateway_id);
    if (rows.length < 2000) break;
  }
}

async function streamGatewayItems(res, mediaType, categoryId) {
  const filter = await categoryFilter(mediaType, categoryId);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.write('[');
  let first = true;
  await walkGatewayItems(mediaType, filter, row => {
    if (!first) res.write(',');
    first = false;
    res.write(JSON.stringify(formatGatewayItem(mediaType, row)));
  });
  res.end(']');
}

async function gatewayItemById(mediaType, gatewayId) {
  const id = Number(gatewayId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (await pool.query(`SELECT m.gateway_id,i.server_id,i.source_id,i.category_id,i.name,i.icon_url,i.container_extension,i.metadata,
      cm.gateway_id AS category_gateway_id,s.base_url,s.username_secret,s.password_secret,s.enabled AS server_enabled
    FROM blofy_xtream_gateway_item_map m
    JOIN blofy_xtream_items i ON i.server_id=m.server_id AND i.media_type=m.media_type AND i.source_id=m.source_id
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_gateway_category_map cm ON cm.server_id=i.server_id AND cm.media_type=i.media_type AND cm.source_category_id=i.category_id
    WHERE m.gateway_id=$1 AND m.media_type=$2 AND i.enabled=TRUE`, [id,mediaType])).rows[0] || null;
}

function decryptServerCredentials(row) {
  return {
    username: decryptXtreamSecret(row.username_secret, KEY_HEX, `username:${row.server_id}`),
    password: decryptXtreamSecret(row.password_secret, KEY_HEX, `password:${row.server_id}`)
  };
}

async function checkedFetch(url, { timeoutMs = 30000, method = 'GET', headers = {}, signal } = {}) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    await assertPublicXtreamUrl(`${current.protocol}//${current.host}`);
    const response = await fetch(current, {
      method,
      redirect: 'manual',
      headers,
      signal: signal || AbortSignal.timeout(timeoutMs)
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirects === 3) throw new Error('xtream_gateway_redirect_invalid');
      current = new URL(location, current);
      if (!['http:','https:'].includes(current.protocol)) throw new Error('xtream_gateway_redirect_invalid');
      continue;
    }
    return response;
  }
  throw new Error('xtream_gateway_redirect_loop');
}

async function fetchUpstreamApi(row, action, extra = {}) {
  const creds = decryptServerCredentials(row);
  const response = await checkedFetch(xtreamApiUrl(row.base_url, creds.username, creds.password, action, extra), {
    timeoutMs: 45000,
    headers: { accept: 'application/json', 'user-agent': 'BLOFY-Xtream-Gateway/1.0' }
  });
  if (!response.ok) throw new Error(`xtream_gateway_upstream_${response.status}`);
  const textBody = await response.text();
  if (Buffer.byteLength(textBody) > 12_000_000) throw new Error('xtream_gateway_info_too_large');
  try { return JSON.parse(textBody); }
  catch { throw new Error('xtream_gateway_upstream_json_invalid'); }
}

async function vodInfo(gatewayId) {
  const row = await gatewayItemById('movie', gatewayId);
  if (!row || !row.server_enabled) return null;
  const payload = stripUpstreamSecrets(await fetchUpstreamApi(row, 'get_vod_info', { vod_id: row.source_id }));
  const movieData = payload?.movie_data && typeof payload.movie_data === 'object' ? payload.movie_data : {};
  return {
    ...payload,
    movie_data: {
      ...movieData,
      stream_id: Number(row.gateway_id),
      name: movieData.name || row.name,
      category_id: row.category_gateway_id == null ? '0' : String(row.category_gateway_id),
      container_extension: safeGatewayExtension(movieData.container_extension || row.container_extension, 'mp4'),
      direct_source: ''
    }
  };
}

async function ensureEpisodeMaps(serverId, seriesSourceId, episodes) {
  if (!episodes.length) return new Map();
  const unique = [...new Map(episodes.map(item => [item.sourceId, item])).values()];
  await pool.query(`INSERT INTO blofy_xtream_gateway_episode_map(server_id,series_source_id,source_episode_id,container_extension)
    SELECT $1::uuid,$2::text,x.source_id,x.container_extension
    FROM jsonb_to_recordset($3::jsonb) AS x(source_id text,container_extension text)
    ON CONFLICT(server_id,series_source_id,source_episode_id) DO UPDATE SET container_extension=EXCLUDED.container_extension`,
    [serverId, String(seriesSourceId), JSON.stringify(unique.map(item => ({ source_id: item.sourceId, container_extension: item.extension })))]);
  const ids = unique.map(item => item.sourceId);
  const rows = (await pool.query(`SELECT gateway_id,source_episode_id,container_extension FROM blofy_xtream_gateway_episode_map
    WHERE server_id=$1 AND series_source_id=$2 AND source_episode_id=ANY($3::text[])`, [serverId,String(seriesSourceId),ids])).rows;
  return new Map(rows.map(row => [String(row.source_episode_id), { id: Number(row.gateway_id), extension: safeGatewayExtension(row.container_extension, 'mp4') }]));
}

async function seriesInfo(gatewayId) {
  const row = await gatewayItemById('series', gatewayId);
  if (!row || !row.server_enabled) return null;
  const raw = await fetchUpstreamApi(row, 'get_series_info', { series_id: row.source_id });
  const payload = stripUpstreamSecrets(raw);
  const sourceEpisodes = [];
  if (raw?.episodes && typeof raw.episodes === 'object') {
    for (const list of Object.values(raw.episodes)) {
      if (!Array.isArray(list)) continue;
      for (const episode of list) {
        if (!episode || episode.id == null) continue;
        sourceEpisodes.push({ sourceId: String(episode.id), extension: safeGatewayExtension(episode.container_extension, 'mp4') });
      }
    }
  }
  const mapped = await ensureEpisodeMaps(row.server_id, row.source_id, sourceEpisodes);
  const episodes = {};
  if (raw?.episodes && typeof raw.episodes === 'object') {
    for (const [season, list] of Object.entries(raw.episodes)) {
      if (!Array.isArray(list)) continue;
      episodes[season] = list.map(episode => {
        const clean = stripUpstreamSecrets(episode);
        const map = mapped.get(String(episode?.id));
        return {
          ...clean,
          id: map?.id ?? clean.id,
          container_extension: map?.extension || safeGatewayExtension(clean.container_extension, 'mp4'),
          direct_source: ''
        };
      });
    }
  }
  return { ...payload, episodes };
}

async function episodeByGatewayId(gatewayId) {
  const id = Number(gatewayId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (await pool.query(`SELECT e.gateway_id,e.server_id,e.source_episode_id,e.container_extension,
      s.base_url,s.username_secret,s.password_secret,s.enabled AS server_enabled
    FROM blofy_xtream_gateway_episode_map e JOIN blofy_xtream_servers s ON s.id=e.server_id
    WHERE e.gateway_id=$1`, [id])).rows[0] || null;
}

function mediaUpstreamUrl(row, kind, sourceId, extension) {
  const creds = decryptServerCredentials(row);
  const base = normalizeXtreamBaseUrl(row.base_url) + '/';
  const ext = safeGatewayExtension(extension, kind === 'live' ? 'ts' : 'mp4');
  const path = `${kind}/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${encodeURIComponent(String(sourceId))}.${ext}`;
  return new URL(path, base);
}

async function proxyMedia(req, res, kind, username, password, gatewayId, requestedExtension) {
  if (!requirePublicBudget(req, res)) return;
  const account = await authenticate(username, password, { touch: false });
  if (!account) return text(res, 401, 'Unauthorized');
  let row, sourceId, extension;
  if (kind === 'series') {
    row = await episodeByGatewayId(gatewayId);
    if (!row || !row.server_enabled) return text(res, 404, 'Stream not found');
    sourceId = row.source_episode_id;
    extension = row.container_extension;
  } else {
    row = await gatewayItemById(kind === 'live' ? 'live' : 'movie', gatewayId);
    if (!row || !row.server_enabled) return text(res, 404, 'Stream not found');
    sourceId = row.source_id;
    extension = row.container_extension;
  }
  const controller = new AbortController();
  const abort = () => { if (!controller.signal.aborted) controller.abort(); };
  res.on('close', () => { if (!res.writableEnded) abort(); });
  const upstream = mediaUpstreamUrl(row, kind, sourceId, requestedExtension || extension);
  const headers = { 'user-agent': String(req.headers['user-agent'] || 'BLOFY-Xtream-Gateway/1.0') };
  if (req.headers.range) headers.range = String(req.headers.range);
  const response = await checkedFetch(upstream, {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    timeoutMs: 30000,
    headers,
    signal: controller.signal
  });
  if (!(response.ok || response.status === 206)) return text(res, 502, 'Upstream unavailable');
  const outputHeaders = {};
  for (const name of ['content-type','content-length','content-range','accept-ranges','cache-control','last-modified','etag']) {
    const value = response.headers.get(name);
    if (value) outputHeaders[name] = value;
  }
  outputHeaders['x-content-type-options'] = 'nosniff';
  res.writeHead(response.status, outputHeaders);
  if (req.method === 'HEAD' || !response.body) return res.end();
  const stream = Readable.fromWeb(response.body);
  stream.on('error', error => {
    if (!controller.signal.aborted) console.error('xtream media relay failed:', redactXtreamError(error));
    if (!res.destroyed) res.destroy();
  });
  stream.pipe(res);
}

function playerServerInfo(req) {
  const base = new URL(origin(req) || 'https://localhost');
  const secure = base.protocol === 'https:';
  return {
    url: base.hostname,
    port: secure ? '443' : (base.port || '80'),
    https_port: secure ? '443' : '',
    server_protocol: secure ? 'https' : 'http',
    rtmp_port: '0',
    timezone: 'UTC',
    timestamp_now: Math.floor(Date.now() / 1000),
    time_now: new Date().toISOString().replace('T', ' ').slice(0, 19)
  };
}

function accountInfo(row, username, password) {
  return {
    username,
    password,
    message: 'BLOFY Xtream Gateway',
    auth: 1,
    status: 'Active',
    exp_date: row.expires_at ? String(Math.floor(new Date(row.expires_at).getTime() / 1000)) : null,
    is_trial: '0',
    active_cons: '0',
    created_at: row.created_at ? String(Math.floor(new Date(row.created_at).getTime() / 1000)) : String(Math.floor(Date.now()/1000)),
    max_connections: String(row.max_connections || 1),
    allowed_output_formats: ['ts']
  };
}

async function handlePlayerApi(req, res, url) {
  if (!requirePublicBudget(req, res)) return;
  const username = url.searchParams.get('username') || '';
  const password = url.searchParams.get('password') || '';
  const account = await authenticate(username, password, { touch: true });
  if (!account) return json(res, 200, { user_info: { auth: 0, status: 'Disabled' }, server_info: playerServerInfo(req) });
  const action = String(url.searchParams.get('action') || '');
  if (!action) return json(res, 200, { user_info: accountInfo(account, username, password), server_info: playerServerInfo(req) });
  if (action === 'get_live_categories') return json(res, 200, await gatewayCategories('live'));
  if (action === 'get_vod_categories') return json(res, 200, await gatewayCategories('movie'));
  if (action === 'get_series_categories') return json(res, 200, await gatewayCategories('series'));
  if (action === 'get_live_streams') return streamGatewayItems(res, 'live', url.searchParams.get('category_id'));
  if (action === 'get_vod_streams') return streamGatewayItems(res, 'movie', url.searchParams.get('category_id'));
  if (action === 'get_series') return streamGatewayItems(res, 'series', url.searchParams.get('category_id'));
  if (action === 'get_vod_info') {
    const value = await vodInfo(url.searchParams.get('vod_id'));
    return json(res, value ? 200 : 404, value || { error: 'vod_not_found' });
  }
  if (action === 'get_series_info') {
    const value = await seriesInfo(url.searchParams.get('series_id'));
    return json(res, value ? 200 : 404, value || { error: 'series_not_found' });
  }
  if (action === 'get_short_epg' || action === 'get_simple_data_table') return json(res, 200, { epg_listings: [] });
  return json(res, 200, []);
}

async function handleM3u(req, res, url) {
  if (!requirePublicBudget(req, res)) return;
  const username = url.searchParams.get('username') || '';
  const password = url.searchParams.get('password') || '';
  const account = await authenticate(username, password, { touch: true });
  if (!account) return text(res, 401, 'Unauthorized');
  const base = origin(req);
  res.writeHead(200, {
    'content-type': 'audio/x-mpegurl; charset=utf-8',
    'cache-control': 'no-store',
    'content-disposition': 'inline; filename="blofy.m3u"'
  });
  res.write('#EXTM3U\n');
  for (const mediaType of ['live','movie']) {
    await walkGatewayItems(mediaType, null, row => {
      const item = formatGatewayItem(mediaType, row);
      const group = escapeM3uAttribute(row.metadata?.genre || (mediaType === 'live' ? 'Live' : 'Movies'));
      const name = escapeM3uAttribute(row.name);
      const logo = escapeM3uAttribute(row.icon_url || '');
      const ext = mediaType === 'live' ? 'ts' : safeGatewayExtension(row.container_extension, 'mp4');
      const kind = mediaType === 'live' ? 'live' : 'movie';
      res.write(`#EXTINF:-1 tvg-name="${name}" tvg-logo="${logo}" group-title="${group}",${name}\n`);
      res.write(`${base}/${kind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${row.gateway_id}.${ext}\n`);
    });
  }
  res.end();
}

async function gatewayHealth() {
  await ensureReady();
  const accounts = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_accounts WHERE enabled=TRUE AND (expires_at IS NULL OR expires_at>NOW())`)).rows[0]?.count || 0);
  const rows = (await pool.query(`SELECT media_type,COUNT(*)::int AS count FROM blofy_xtream_items i JOIN blofy_xtream_servers s ON s.id=i.server_id
    WHERE s.enabled=TRUE AND i.enabled=TRUE GROUP BY media_type`)).rows;
  const catalog = { live: 0, movie: 0, series: 0 };
  for (const row of rows) if (Object.hasOwn(catalog,row.media_type)) catalog[row.media_type] = Number(row.count);
  return { ok: true, compatible: 'Xtream Codes API', accounts, catalog, playbackProxy: true };
}

const previousCreateServer = http.createServer.bind(http);
http.createServer = function withBlofyXtreamGateway(listener) {
  if (typeof listener !== 'function') return previousCreateServer(listener);
  return previousCreateServer(async (req, res) => {
    if (res.writableEnded || res.destroyed) return;
    let url;
    try { url = new URL(req.url || '/', 'http://localhost'); }
    catch { return listener(req, res); }
    try {
      if (req.method === 'GET' && url.pathname === '/xtream-gateway-admin.js') {
        const body = await readFile(new URL('../web/xtream-gateway-admin.js', import.meta.url));
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }
      if (req.method === 'GET' && url.pathname === '/xtream/health') return json(res, 200, await gatewayHealth());
      if ((req.method === 'GET' || req.method === 'POST') && (url.pathname === '/player_api.php' || url.pathname === '/panel_api.php')) return handlePlayerApi(req, res, url);
      if (req.method === 'GET' && url.pathname === '/get.php') return handleM3u(req, res, url);
      if (req.method === 'GET' && url.pathname === '/xmltv.php') {
        const account = await authenticate(url.searchParams.get('username') || '', url.searchParams.get('password') || '');
        return account ? text(res, 200, '<?xml version="1.0" encoding="UTF-8"?><tv></tv>\n', 'application/xml; charset=utf-8') : text(res, 401, 'Unauthorized');
      }
      const mediaMatch = url.pathname.match(/^\/(live|movie|series)\/([^/]+)\/([^/]+)\/([0-9]+)(?:\.([A-Za-z0-9]{1,8}))?$/i);
      if (mediaMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        return proxyMedia(req, res, mediaMatch[1].toLowerCase(), decodeURIComponent(mediaMatch[2]), decodeURIComponent(mediaMatch[3]), mediaMatch[4], mediaMatch[5]);
      }

      if (!url.pathname.startsWith('/api/v1/admin/xtream-gateway')) return listener(req, res);
      if (!requireAdmin(req, res)) return;
      await ensureReady();
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream-gateway') {
        const items = await listAccounts();
        return json(res, 200, { serverUrl: origin(req), items });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream-gateway/accounts') {
        return json(res, 201, await createAccount(await readJson(req), req));
      }
      const match = url.pathname.match(/^\/api\/v1\/admin\/xtream-gateway\/accounts\/([0-9a-f-]+)(?:\/(reset))?$/i);
      if (match) {
        const id = match[1];
        if (!validUuid(id)) return json(res, 400, { error: 'xtream_gateway_account_invalid' });
        if (match[2] === 'reset' && req.method === 'POST') return json(res, 200, await resetAccountPassword(id, req));
        if (!match[2] && req.method === 'PATCH') return json(res, 200, { item: await patchAccount(id, await readJson(req)) });
        if (!match[2] && req.method === 'DELETE') {
          const result = await pool.query('DELETE FROM blofy_xtream_gateway_accounts WHERE id=$1', [id]);
          return json(res, result.rowCount ? 200 : 404, result.rowCount ? { deleted: true } : { error: 'xtream_gateway_account_not_found' });
        }
      }
      return json(res, 404, { error: 'xtream_gateway_route_not_found' });
    } catch (error) {
      console.error('xtream gateway request failed:', redactXtreamError(error));
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const status = Number(error?.status) || 503;
      return json(res, status, { error: status === 503 ? 'xtream_gateway_unavailable' : String(error?.message || 'xtream_gateway_request_failed') });
    }
  });
};

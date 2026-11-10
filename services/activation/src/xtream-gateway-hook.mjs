import { collectSourceEpisodes, mapSeriesEpisodes } from './xtream-series-resolver.mjs';
import { databaseOptions } from './database-options.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';
import {safeXtreamTransportCategory} from './xtream-transport-errors.mjs';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
import {ensureXtreamAdminReady,getXtreamStudioBranding} from './xtream-admin-hook.mjs';
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
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { validateBulkAccountRequest } from './xtream-bulk-policy.mjs';
import { gatewayItemsPageQuery,gatewayOrderedItemsPageQuery,gatewayOrderCursor } from './xtream-gateway-query.mjs';
import {xtreamCatalogVersionForAccount} from './xtream-catalog-revision.mjs';
import { mergeXtreamPlayerRequest } from './xtream-player-post.mjs';
import { inspectXtreamMediaChunk } from './xtream-media-inspector.mjs';
import { verifiedXtreamMediaContentType } from './xtream-media-response-type.mjs';
import { readXtreamProviderDenialHint } from './xtream-provider-denial.mjs';
import { normalizeXtreamEpg } from './xtream-epg.mjs';
import { acceptsXtreamGzip } from './xtream-catalog-compression.mjs';
import { shouldRetryXtreamWithoutRange,firstByteXtreamRange } from './xtream-media-range.mjs';
import { recordXtreamPlayback,xtreamPlaybackSnapshot } from './xtream-playback-metrics.mjs';
import { XtreamDenialCooldown } from './xtream-denial-cooldown.mjs';
import { createGatewayUsageThrottle } from './xtream-gateway-usage-throttle.mjs';
import {createStreamDurationCodes,ensureStreamCodeTable} from './xtream-duration-codes.mjs';
import {createStreamCommercial,ensureStreamCommercialSchema} from './xtream-code-commercial.mjs';
import {parseStreamAppToken,verifyStreamAppToken,bearerFromRequest}
  from './xtream-code-app-token.mjs';
import {encryptGatewayAccountPassword,decryptGatewayAccountPassword} from './xtream-account-vault.mjs';
import { readXtreamGatewayJsonResponse } from './xtream-gateway-response.mjs';
import { createXtreamHealthSnapshot } from './xtream-health-snapshot.mjs';
import {relayEligible,issueStreamRelayGrant} from './xtream-stream-relay-bridge.mjs';
import {permittedLicensedLiveFanout} from './xtream-licensed-live-fanout-policy.mjs';
import {shouldUseIndependentSourceMedia,shouldFallbackIndependentVod} from './xtream-independent-source-media-policy.mjs';
import {shouldCompareRelay404Direct} from './xtream-relay-404-direct-recovery.mjs';
import {readSanitizedXtreamRelayFailure} from './xtream-relay-diagnostic.mjs';
import {customerMediaFailureStatus} from './xtream-customer-media-failure.mjs';
import {ensureUnavailableMediaTable,validUnavailableKey,recoverySources,
 recoveryEnabled,registerProvider404,noteMediaRestored,
 createRegistryWriteGuard,unavailableMediaSummary,
 expediteUnavailableRecheck} from './xtream-unavailable-media-registry.mjs';
import {runUnavailableRecheckBatch,classifyUnavailableProbe} from './xtream-unavailable-media-recheck.mjs';
import {mayRefreshMovieExtension,correctedMovieExtension,
  mayRefreshEpisodeExtension,correctedEpisodeExtension} from './xtream-vod-extension-recovery.mjs';
import {shouldUseIndependentXtreamSource,fetchIndependentXtreamSource} from './xtream-independent-catalog-relay.mjs';
import {sameSeriesRecoveryEpisode} from './xtream-recovery-episode-resolution.mjs';

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
const mediaDenialCooldown = new XtreamDenialCooldown();
// Bound metadata refresh attempts for missing movies. Avoid repeatedly
// querying the provider's catalog for the same broken item across viewers.
const movieRefreshCooldown=new Map();
function movieRefreshDue(key,now=Date.now()){
  for(const [id,until] of movieRefreshCooldown){
    if(until<=now)movieRefreshCooldown.delete(id);
  }
  if((movieRefreshCooldown.get(key)||0)>now)return false;
  if(movieRefreshCooldown.size>=256)movieRefreshCooldown.delete(movieRefreshCooldown.keys().next().value);
  movieRefreshCooldown.set(key,now+120000);
  return true;
}
const accountUsageThrottle = createGatewayUsageThrottle();
let streamCodes=null;
let streamCommercial=null;
const streamCodeLimiter=createFixedWindowLimiter({limit:6,windowMs:15*60_000});
// Short numeric vouchers are more susceptible to distributed guessing.
// Bound all public redemption attempts as well as each client IP.
const streamCodeGlobalLimiter=createFixedWindowLimiter({limit:120,windowMs:60*60_000});
let readyPromise;
const unavailableWriteGuard=createRegistryWriteGuard();
let unavailableRecoveryTimerStarted=false,unavailableRecoveryBusy=false;

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
      await client.query('ALTER TABLE blofy_xtream_gateway_accounts ADD COLUMN IF NOT EXISTS source_id UUID');
      await client.query('ALTER TABLE blofy_xtream_gateway_accounts ADD COLUMN IF NOT EXISTS credential_vault TEXT');
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
      await ensureUnavailableMediaTable(client);
      await ensureStreamCodeTable(client);
      await ensureStreamCommercialSchema(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  })().catch(error => { readyPromise = null; throw error; });
  const ready=await readyPromise;
  if(!streamCodes)streamCodes=createStreamDurationCodes({pool,keyHex:KEY_HEX});
  if(!streamCommercial)streamCommercial=createStreamCommercial({pool,keyHex:KEY_HEX});
  // Opt-in, source-allowlisted, lease-based recovery. Normal requests do not
  // wait for health probes. Timers are unref'd and are never enabled by default.
  if(!unavailableRecoveryTimerStarted&&recoveryEnabled()){
    unavailableRecoveryTimerStarted=true;
    const first=setTimeout(()=>{void runDueUnavailableMedia().catch(()=>{});},45000);
    first.unref?.();
    const timer=setInterval(()=>{void runDueUnavailableMedia().catch(()=>{});},3600000);
    timer.unref?.();
  }
  return ready;
}

function adminAccount(row) {
  return {
    id: row.id,
    label: row.label,
    username: row.username,
    sourceId: row.source_id || null,
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

// NULL means all published BLOFY sources (existing accounts keep this mode).
// A bound account must NEVER switch to all when a source is removed.
async function checkedAccountSourceId(value) {
  if (value == null || value === '') return null;
  const id=String(value);
  if(!validUuid(id))throw Object.assign(new Error('xtream_gateway_source_id_invalid'),{status:400});
  const row=(await pool.query(`SELECT id FROM blofy_xtream_servers
     WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
       AND deletion_requested_at IS NULL`,[id])).rows[0];
  if(!row)throw Object.assign(new Error('xtream_gateway_source_not_ready'),{status:409});
  return row.id;
}

async function createAccount(body, req) {
  await ensureReady();
  const label = cleanLabel(body.label, 'BLOFY Player');
  const sourceId=await checkedAccountSourceId(body.sourceId);
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
    const vault=encryptGatewayAccountPassword(id,password,KEY_HEX);
    try {
      const row = (await pool.query(`INSERT INTO blofy_xtream_gateway_accounts(id,label,username,password_proof,enabled,max_connections,expires_at,source_id,credential_vault)
        VALUES($1,$2,$3,$4,TRUE,$5,$6,$7,$8) RETURNING *`, [id,label,username,proof,maxConnections,expiresAt,sourceId,vault])).rows[0];
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

async function createAccountsBulk(body, req) {
  await ensureReady();
  const { count,maxConnections,expiresAt }=validateBulkAccountRequest(body);
  const label=cleanLabel(body.label,'BLOFY Player');
  const sourceId=await checkedAccountSourceId(body.sourceId);
  const connection=await pool.connect();
  const created=[], issued=new Set();
  try{
    await connection.query('BEGIN');
    for(let i=0;i<count;i++){
      let username=generateGatewayUsername();
      for(let tries=0;issued.has(username)&&tries<5;tries++)username=generateGatewayUsername();
      if(issued.has(username))throw Object.assign(new Error('xtream_gateway_bulk_username_collision'),{status:409});
      issued.add(username);
      const password=generateGatewayPassword();
      const id=crypto.randomUUID(),proof=gatewayCredentialProof(username,password,KEY_HEX);
      const vault=encryptGatewayAccountPassword(id,password,KEY_HEX);
      const accountLabel=count===1?label:`${label} ${String(i+1).padStart(2,'0')}`;
      const row=(await connection.query(`INSERT INTO blofy_xtream_gateway_accounts(id,label,username,password_proof,enabled,max_connections,expires_at,source_id,credential_vault)
        VALUES($1,$2,$3,$4,TRUE,$5,$6,$7,$8) RETURNING *`,[
        id,accountLabel,username,proof,maxConnections,expiresAt,sourceId,vault
      ])).rows[0];
      created.push({item:adminAccount(row),username,password});
    }
    await connection.query('COMMIT');
  }catch(error){
    await connection.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{connection.release();}
  const host=origin(req);
  return {serverUrl:host,count:created.length,items:created.map(x=>x.item),
    credentials:created.map(x=>({serverUrl:host,username:x.username,password:x.password}))};
}

async function patchAccount(id, body) {
  await ensureReady();
  if (!validUuid(id)) throw Object.assign(new Error('xtream_gateway_account_invalid'), { status: 400 });
  const updates = [];
  const values = [];
  const set = (column, value) => { values.push(value); updates.push(`${column}=$${values.length}`); };
  if (body.label !== undefined) set('label', cleanLabel(body.label));
  if (body.sourceId !== undefined) set('source_id', await checkedAccountSourceId(body.sourceId));
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
  const vault=encryptGatewayAccountPassword(id,password,KEY_HEX);
  const row = (await pool.query('UPDATE blofy_xtream_gateway_accounts SET password_proof=$2,credential_vault=$3,updated_at=NOW() WHERE id=$1 RETURNING *', [id, proof,vault])).rows[0];
  return { item: adminAccount(row), credentials: { serverUrl: origin(req), username: row.username, password } };
}

async function revealAccountCredentials(id,req){
  await ensureReady();
  if(!validUuid(id))throw Object.assign(new Error('xtream_gateway_account_invalid'),{status:400});
  const row=(await pool.query('SELECT id,username,credential_vault FROM blofy_xtream_gateway_accounts WHERE id=$1',[id])).rows[0];
  if(!row)throw Object.assign(new Error('xtream_gateway_account_not_found'),{status:404});
  const password=decryptGatewayAccountPassword(id,row.credential_vault,KEY_HEX);
  if(!password)throw Object.assign(new Error('xtream_gateway_password_not_recoverable'),{status:409});
  const serverUrl=origin(req);
  const params=new URLSearchParams({username:row.username,password,type:'m3u_plus',output:'ts'});
  return {credentials:{serverUrl,username:row.username,password,
    m3uUrl:serverUrl+'/get.php?'+params.toString()}};
}

async function authenticateAppBearer(req){
  const token=bearerFromRequest(req),parsed=parseStreamAppToken(token);
  if(!parsed)return null;
  await ensureReady();
  const row=(await pool.query(`SELECT a.*,c.account_id,c.code_hash,c.redeemed_device_hash
    FROM blofy_xtream_gateway_accounts a
    JOIN blofy_xtream_gateway_duration_codes c ON c.account_id=a.id
    WHERE a.id=$1 AND a.enabled=TRUE AND c.redeemed_at IS NOT NULL
      AND c.revoked_at IS NULL AND c.redeemed_device_hash IS NOT NULL
      AND (a.expires_at IS NULL OR a.expires_at>NOW())
    LIMIT 1`,[parsed.accountId])).rows[0];
  if(!row||!verifyStreamAppToken(token,row,KEY_HEX))return null;
  return row;
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
  if (touch && accountUsageThrottle.shouldWrite(row.id))
    void pool.query('UPDATE blofy_xtream_gateway_accounts SET last_used_at=NOW() WHERE id=$1', [row.id])
      .catch(() => accountUsageThrottle.forget(row.id));
  return row;
}

// A 290k-item catalog used to scan and ON CONFLICT every item for every
// Xtream player request. Single-flight + bounded freshness avoids repeated
// heavyweight map INSERTs while still detecting newly imported items.
const categoryMapJobs=new Map();
const itemMapJobs=new Map();
const MAP_FRESHNESS_MS=20000;
async function oncePerMediaMap(cache,key,task){
  const old=cache.get(key),now=Date.now();
  if(old && (!old.settled || now-old.startedAt<MAP_FRESHNESS_MS))return old.promise;
  const entry={startedAt:now,promise:null,settled:false};
  entry.promise=Promise.resolve().then(task);
  cache.set(key,entry);
  try{return await entry.promise;}
  catch(error){if(cache.get(key)===entry)cache.delete(key);throw error;}
  finally{entry.settled=true;}
}

async function ensureCategoryMaps(mediaType,sourceId=null) {
  await ensureReady();
  const key=mediaType+':'+(sourceId||'*');
  return oncePerMediaMap(categoryMapJobs,key,()=>pool.query(`INSERT INTO blofy_xtream_gateway_category_map(server_id,media_type,source_category_id)
    SELECT c.server_id,c.media_type,c.source_category_id
    FROM blofy_xtream_categories c
    JOIN blofy_xtream_servers s ON s.id=c.server_id
    WHERE c.media_type=$1 AND c.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND ($2::uuid IS NULL OR s.id=$2::uuid)
    ON CONFLICT(server_id,media_type,source_category_id) DO NOTHING`,[mediaType,sourceId]));
}

async function ensureItemMaps(mediaType,sourceId=null) {
  await ensureReady();
  const key=mediaType+':'+(sourceId||'*');
  return oncePerMediaMap(itemMapJobs,key,()=>pool.query(`INSERT INTO blofy_xtream_gateway_item_map(server_id,media_type,source_id)
    SELECT i.server_id,i.media_type,i.source_id
    FROM blofy_xtream_items i
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
    WHERE i.media_type=$1 AND i.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND (c.enabled IS NULL OR c.enabled=TRUE)
      AND ($2::uuid IS NULL OR i.server_id=$2::uuid)
    ON CONFLICT(server_id,media_type,source_id) DO NOTHING`,[mediaType,sourceId]));
}

async function gatewayCategories(mediaType, sourceId=null) {
  await ensureCategoryMaps(mediaType,sourceId);
  return (await pool.query(`SELECT m.gateway_id,c.name
    FROM blofy_xtream_gateway_category_map m
    JOIN blofy_xtream_categories c ON c.server_id=m.server_id AND c.media_type=m.media_type AND c.source_category_id=m.source_category_id
    JOIN blofy_xtream_servers s ON s.id=c.server_id
    WHERE m.media_type=$1 AND c.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND ($2::uuid IS NULL OR s.id=$2::uuid)
    ORDER BY s.priority,c.sort_order,c.name`, [mediaType,sourceId])).rows.map(formatGatewayCategory);
}

async function categoryFilter(mediaType, gatewayId, sourceId=null) {
  if (gatewayId == null || gatewayId === '' || String(gatewayId) === '0') return null;
  const id = Number(gatewayId);
  if (!Number.isSafeInteger(id) || id < 1) throw Object.assign(new Error('xtream_gateway_category_invalid'), { status: 400 });
  const row = (await pool.query('SELECT server_id,source_category_id FROM blofy_xtream_gateway_category_map WHERE gateway_id=$1 AND media_type=$2 AND ($3::uuid IS NULL OR server_id=$3::uuid)', [id,mediaType,sourceId])).rows[0];
  if (!row) throw Object.assign(new Error('xtream_gateway_category_not_found'), { status: 404 });
  return row;
}

async function walkGatewayItems(mediaType, filter, onRow, sourceId=null) {
  await ensureCategoryMaps(mediaType,sourceId);
  await ensureItemMaps(mediaType,sourceId);
  let cursor=null;
  for (;;) {
    const page=gatewayOrderedItemsPageQuery(mediaType,cursor,{filter,sourceId});
    const rows=(await pool.query(page)).rows;
    if (!rows.length) break;
    for (const row of rows) await onRow(row);
    cursor=gatewayOrderCursor(rows[rows.length-1]);
    if (rows.length < 2000) break;
  }
}

async function writeStreamChunk(res,chunk) {
  if(res.destroyed||res.writableEnded)throw new Error('xtream_client_disconnected');
  if(res.write(chunk))return;
  await new Promise((resolve,reject)=>{
    const cleanup=()=>{res.off('drain',ok);res.off('close',closed);res.off('error',failed);};
    const ok=()=>{cleanup();resolve();};
    const closed=()=>{cleanup();reject(new Error('xtream_client_disconnected'));};
    const failed=()=>{cleanup();reject(new Error('xtream_stream_write_failed'));};
    res.once('drain',ok);res.once('close',closed);res.once('error',failed);
  });
}

async function streamGatewayItems(req,res,mediaType,categoryId,sourceId=null) {
  const filter=await categoryFilter(mediaType,categoryId,sourceId);
  // Prepare source mappings before committing a successful response.
  await ensureCategoryMaps(mediaType,sourceId);
  await ensureItemMaps(mediaType,sourceId);
  const gzipEnabled=acceptsXtreamGzip(req.headers['accept-encoding']);
  const headers={
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'vary':'Accept-Encoding'
  };
  if(gzipEnabled)headers['content-encoding']='gzip';
  // Stream compress only when the player explicitly accepts gzip. This keeps
  // giant JSON catalogs (including 100k+ movie lists) from filling slow links.
  const gzip=gzipEnabled?createGzip({level:4}):null;
  const output=gzip||res;
  if(gzip){
    const clientClosed=()=>{if(!res.writableEnded&&!gzip.destroyed)gzip.destroy();};
    res.once('close',clientClosed);
    gzip.once('close',()=>res.off('close',clientClosed));
    gzip.once('error',()=>{if(!res.destroyed)res.destroy();});
  }
  res.writeHead(200,headers);
  if(gzip)gzip.pipe(res);
  try{
    await writeStreamChunk(output,'[');
    let first=true;
    await walkGatewayItems(mediaType,filter,async row=>{
      const prefix=first?'':',';
      first=false;
      await writeStreamChunk(output,prefix+JSON.stringify(formatGatewayItem(mediaType,row)));
    },sourceId);
    await writeStreamChunk(output,']');
    output.end();
  }catch(error){
    if(gzip&&!gzip.destroyed)gzip.destroy();
    throw error;
  }
}

async function gatewayItemById(mediaType, gatewayId, sourceId=null) {
  const id = Number(gatewayId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (await pool.query(`SELECT m.gateway_id,i.server_id,i.source_id,i.category_id,
      COALESCE(NULLIF(i.custom_name,''),i.name) AS name,
      COALESCE(NULLIF(i.custom_icon_url,''),i.icon_url) AS icon_url,
      i.featured,i.channel_number,i.container_extension,i.metadata,
      cm.gateway_id AS category_gateway_id,s.base_url,s.username_secret,s.password_secret,s.enabled AS server_enabled,
      s.name AS source_name,
      (SELECT COUNT(*)::int FROM blofy_xtream_servers sx
        WHERE lower(btrim(sx.name))=lower(btrim(s.name))
          AND sx.deletion_requested_at IS NULL) AS source_name_matches,
      (s.account_info->>'isRestreamer' = 'true') AS source_restreamer_allowed
    FROM blofy_xtream_gateway_item_map m
    JOIN blofy_xtream_items i ON i.server_id=m.server_id AND i.media_type=m.media_type AND i.source_id=m.source_id
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
    LEFT JOIN blofy_xtream_gateway_category_map cm ON cm.server_id=i.server_id AND cm.media_type=i.media_type AND cm.source_category_id=i.category_id
    WHERE m.gateway_id=$1 AND m.media_type=$2 AND i.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE AND (c.enabled IS NULL OR c.enabled=TRUE)
      AND ($3::uuid IS NULL OR i.server_id=$3::uuid)`, [id,mediaType,sourceId])).rows[0] || null;
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
      await response.body?.cancel().catch(()=>{});
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
  // Enforce the 12 MB limit as bytes arrive rather than after fully
  // buffering the payload. Reject and release HTTP error bodies.
  return readXtreamGatewayJsonResponse(response);
}

// Account-scoped program guide for one accessible channel. The provider API
// may not support EPG; an unavailable guide must never look like a fake listing.
async function liveEpg(gatewayId, sourceId=null, action='get_short_epg', limit=20){
  const empty={epg_listings:[]};
  const id=Number(gatewayId);
  if(!Number.isSafeInteger(id)||id<1)return empty;
  const row=await gatewayItemById('live',id,sourceId);
  if(!row||!row.server_enabled)return empty;
  const creds=decryptServerCredentials(row);
  const qs={stream_id:row.source_id};
  if(action==='get_short_epg')qs.limit=Math.max(1,Math.min(50,Number(limit)||20));
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  let response;
  try{
    response=await checkedFetch(xtreamApiUrl(row.base_url,creds.username,creds.password,action,qs),{
      timeoutMs:10000,signal:controller.signal,
      headers:{accept:'application/json','user-agent':'BLOFY-Xtream-EPG/1.0'}
    });
    if(!response.ok)return empty;
    const contentType=String(response.headers.get('content-type')||'').toLowerCase();
    if(contentType.includes('text/html'))return empty;
    if(!response.body)return empty;
    let bytes=0;const chunks=[];
    for await (const part of response.body){
      bytes+=part.byteLength;
      if(bytes>1024*1024)return empty;
      chunks.push(Buffer.from(part));
    }
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return normalizeXtreamEpg(payload,action==='get_short_epg'?qs.limit:50);
  }catch{
    // Do not leak provider URLs, usernames or passwords through player API.
    return empty;
  }finally{
    clearTimeout(timeout);controller.abort();
    try{await response?.body?.cancel()}catch{}
  }
}

async function vodInfo(gatewayId, sourceId=null) {
  const row = await gatewayItemById('movie', gatewayId, sourceId);
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
    ON CONFLICT(server_id,series_source_id,source_episode_id) DO UPDATE
      SET container_extension=EXCLUDED.container_extension
      WHERE blofy_xtream_gateway_episode_map.container_extension IS DISTINCT FROM EXCLUDED.container_extension`,
    [serverId, String(seriesSourceId), JSON.stringify(unique.map(item => ({ source_id: item.sourceId, container_extension: item.extension })))]);
  const ids = unique.map(item => item.sourceId);
  const rows = (await pool.query(`SELECT gateway_id,source_episode_id,container_extension FROM blofy_xtream_gateway_episode_map
    WHERE server_id=$1 AND series_source_id=$2 AND source_episode_id=ANY($3::text[])`, [serverId,String(seriesSourceId),ids])).rows;
  return new Map(rows.map(row => [String(row.source_episode_id), { id: Number(row.gateway_id), extension: safeGatewayExtension(row.container_extension, 'mp4') }]));
}

async function seriesInfo(gatewayId, sourceId=null) {
  const row = await gatewayItemById('series', gatewayId, sourceId);
  if (!row || !row.server_enabled) return null;
  const raw = await fetchUpstreamApi(row, 'get_series_info', { series_id: row.source_id });
  const payload = stripUpstreamSecrets(raw);
  // Only hand out stable IDs that exist in the episode map for this series.
  // Missing mappings are deliberately omitted; raw provider IDs would point
  // to unrelated BLOFY gateway IDs and cause false 404/502 playback errors.
  const sourceEpisodes = collectSourceEpisodes(raw?.episodes);
  const mapped = await ensureEpisodeMaps(row.server_id, row.source_id, sourceEpisodes);
  const episodes = mapSeriesEpisodes(raw?.episodes, mapped, stripUpstreamSecrets);
  return { ...payload, episodes };
}

async function episodeByGatewayId(gatewayId,sourceId=null) {
  const id = Number(gatewayId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (await pool.query(`SELECT e.gateway_id,e.server_id,e.series_source_id,e.source_episode_id,e.container_extension,
      s.base_url,s.username_secret,s.password_secret,s.enabled AS server_enabled
    FROM blofy_xtream_gateway_episode_map e JOIN blofy_xtream_servers s ON s.id=e.server_id
    WHERE e.gateway_id=$1 AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND ($2::uuid IS NULL OR e.server_id=$2::uuid)`, [id,sourceId])).rows[0] || null;
}

function mediaUpstreamUrl(row, kind, sourceId, extension) {
  const creds = decryptServerCredentials(row);
  const base = normalizeXtreamBaseUrl(row.base_url) + '/';
  const ext = safeGatewayExtension(extension, kind === 'live' ? 'ts' : 'mp4');
  const path = `${kind}/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${encodeURIComponent(String(sourceId))}.${ext}`;
  return new URL(path, base);
}

// One authorized source lookup, bounded to 4.5 seconds and 24 KiB. Source
// metadata never reaches the player or logs. No catalog writes.
async function freshAdvertisedMovieExtension(row,sourceId,previousExtension) {
  const creds=decryptServerCredentials(row);
  const url=xtreamApiUrl(row.base_url,creds.username,creds.password,
    'get_vod_info',{vod_id:String(sourceId)});
  let response,reader;
  try{
    const timeout=AbortSignal.timeout(4500);
    response=shouldUseIndependentXtreamSource(row.server_id)
      ?await fetchIndependentXtreamSource(url.href,{timeoutMs:4000})
      :await checkedFetch(url,{timeoutMs:4000,signal:timeout,
        headers:{accept:'application/json','user-agent':'BLOFY-Xtream-Gateway/1.0'}});
    if(response.status!==200||!response.body)return null;
    const size=Number(response.headers.get('content-length')||0);
    if(size>24576)return null;
    reader=response.body.getReader();
    const chunks=[];let count=0;
    while(true){
      const part=await reader.read();
      if(part.done)break;
      count+=part.value?.byteLength||0;
      if(count>24576)return null;
      chunks.push(Buffer.from(part.value));
    }
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return correctedMovieExtension(payload,sourceId,previousExtension);
  }catch{return null;}
  finally{
    if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
    else await response?.body?.cancel().catch(()=>{});
  }
}

// Optional same-episode recovery: the episode remains bound to its existing
// series and source. No rewritten IDs, alternate credentials or DB updates.
async function freshAdvertisedEpisodeExtension(row,sourceId,previousExtension) {
  if(!row.series_source_id)return null;
  const creds=decryptServerCredentials(row);
  const url=xtreamApiUrl(row.base_url,creds.username,creds.password,
    'get_series_info',{series_id:String(row.series_source_id)});
  let response,reader;
  try{
    const signal=AbortSignal.timeout(7500);
    response=shouldUseIndependentXtreamSource(row.server_id)
      ?await fetchIndependentXtreamSource(url.href,{timeoutMs:6000})
      :await checkedFetch(url,{timeoutMs:6000,signal,
        headers:{accept:'application/json','user-agent':'BLOFY-Xtream-Gateway/1.0'}});
    if(response.status!==200||!response.body)return null;
    const size=Number(response.headers.get('content-length')||0);
    if(size>1500000)return null;
    reader=response.body.getReader();
    const chunks=[];let count=0;
    while(true){
      // A relay response's stream can stall after headers. Bound the body too.
      let timer;
      let step;
      try{
        step=await Promise.race([
          reader.read(),
          new Promise((_,reject)=>{
            timer=setTimeout(()=>reject(Error('episode_metadata_timeout')),7500);
          })
        ]);
      }finally{clearTimeout(timer);}
      if(step.done)break;
      count+=step.value?.byteLength||0;
      if(count>1500000)return null;
      chunks.push(Buffer.from(step.value));
    }
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return correctedEpisodeExtension(payload,row.series_source_id,sourceId,previousExtension);
  }catch{return null;}
  finally{
    if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
    else await response?.body?.cancel().catch(()=>{});
  }
}

const recoverySuccessGuard=createRegistryWriteGuard({cooldownMs:21600000,max:5000});
function mediaRegistryKey(row,kind,sourceId){
 return validUnavailableKey({
  serverId:row?.server_id,kind,itemId:sourceId,
  seriesId:kind==='series'?row?.series_source_id:''
 });
}
function asyncNoteMissing(key){
 if(!key||!recoverySources().has(key.serverId))return;
 const fingerprint=key.serverId+':'+key.kind+':'+key.itemId+':'+key.seriesId;
 if(unavailableWriteGuard(fingerprint))
  void registerProvider404(pool,key).catch(()=>{});
}
function asyncNoteRecovered(key){
 if(!key||!recoverySources().has(key.serverId))return;
 const fingerprint=key.serverId+':'+key.kind+':'+key.itemId+':'+key.seriesId;
 if(recoverySuccessGuard(fingerprint))
  void noteMediaRestored(pool,key).catch(()=>{});
}

// Admin source probes can register a missing episode before a subscriber
// ever loads the series, so the gateway episode-map row may not yet exist.
// Read the already-imported series' current official get_series_info through
// the same authorized source. Accept only the *original* episode ID from
// that exact series and use only its declared extension. No map insertions.
async function recoverOriginalUnmappedEpisode(key){
 if(key.kind!=='series')return null;
 let row;
 try{
  row=(await pool.query(`SELECT s.id AS server_id,s.base_url,
     s.username_secret,s.password_secret
    FROM blofy_xtream_servers s
    JOIN blofy_xtream_items i ON i.server_id=s.id
      AND i.media_type='series' AND i.source_id=$2 AND i.enabled=TRUE
    WHERE s.id=$1 AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND s.deletion_requested_at IS NULL LIMIT 1`,
   [key.serverId,key.seriesId])).rows[0];
 }catch{return null;}
 if(!row)return null;
 let response;
 try{
  const creds=decryptServerCredentials(row);
  const url=xtreamApiUrl(row.base_url,creds.username,creds.password,
   'get_series_info',{series_id:key.seriesId});
  response=shouldUseIndependentXtreamSource(key.serverId)
   ?await fetchIndependentXtreamSource(url.href,{timeoutMs:6500})
   :await checkedFetch(url,{method:'GET',timeoutMs:7500,
     signal:AbortSignal.timeout(9500),
     headers:{accept:'application/json',
      'user-agent':'BLOFY-Unavailable-Series-Check/1.0'}});
  const json=await readXtreamGatewayJsonResponse(response,{maxBytes:1500000});
  const exact=sameSeriesRecoveryEpisode(json,key.itemId);
  return exact?{...row,container_extension:exact.extension}:null;
 }catch{return null;}
 finally{try{await response?.body?.cancel()}catch{}}
}

// One approved, unchanged provider file URL through the existing authenticated
// STREAM ticket service. No alternate source, ID, credentials or CDN guessing.
// Each probe reads only the first media chunk and cancels its remaining body.
async function probeUnavailableMediaOnSameSource(key){
 const params=key.kind==='movie'?[key.serverId,key.itemId]:
  [key.serverId,key.itemId,key.seriesId];
 const sql=key.kind==='movie'
  ?`SELECT i.server_id,i.container_extension,s.base_url,
     s.username_secret,s.password_secret FROM blofy_xtream_items i
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    WHERE i.server_id=$1 AND i.source_id=$2
      AND i.media_type='movie' AND i.enabled=TRUE
      AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND s.deletion_requested_at IS NULL LIMIT 1`
  :`SELECT e.server_id,e.container_extension,s.base_url,
     s.username_secret,s.password_secret FROM blofy_xtream_gateway_episode_map e
    JOIN blofy_xtream_servers s ON s.id=e.server_id
    WHERE e.server_id=$1 AND e.source_episode_id=$2
      AND e.series_source_id=$3 AND s.enabled=TRUE
      AND s.publish_catalog=TRUE AND s.deletion_requested_at IS NULL LIMIT 1`;
 let row;
 try{row=(await pool.query(sql,params)).rows[0];}
 catch{return 'transient';}
 // For operator-discovered series, absence of a player map must not
 // prevent a true same-episode media recheck. Never infer another ID.
 if(!row&&key.kind==='series')
  row=await recoverOriginalUnmappedEpisode(key);
 if(!row)return 'transient';
 const ext=safeGatewayExtension(row.container_extension,'mp4');
 if(!shouldUseIndependentSourceMedia({
  sourceId:key.serverId,kind:key.kind,extension:ext
 }))return 'transient';
 let response,reader;
 try{
  const original=mediaUpstreamUrl(row,key.kind,key.itemId,ext);
  const signed=await issueStreamRelayGrant({sourceUrl:original.href,kind:key.kind});
  response=await checkedFetch(new URL(signed),{
   timeoutMs:12000,signal:AbortSignal.timeout(12000),
   method:'GET',headers:{range:'bytes=0-1023',
    'user-agent':'BLOFY-Unavailable-First-Byte/1.0'}
  });
  if(response.status===502){
   const relayFailure=await readSanitizedXtreamRelayFailure(response);
   return classifyUnavailableProbe({status:502,relayFailure});
  }
  if(![200,206].includes(response.status)||!response.body)
   return 'transient';
  reader=response.body.getReader();
  const first=await reader.read();
  const valid=!!first.value?.byteLength&&!first.done&&
   inspectXtreamMediaChunk(first.value,response.headers.get('content-type')).valid;
  return classifyUnavailableProbe({status:response.status,firstChunkValid:valid});
 }catch{return 'transient';}
 finally{
  if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
  else {try{await response?.body?.cancel()}catch{}}
 }
}
async function runDueUnavailableMedia(){
 const totals={checked:0,recovered:0,stillMissing:0,transient:0,
  busy:false};
 if(unavailableRecoveryBusy||!recoveryEnabled())
  return {...totals,busy:unavailableRecoveryBusy};
 unavailableRecoveryBusy=true;
 try{
  // Each source has its own DB lease, which prevents duplicate probes across
  // replicas and keeps traffic below three first-byte attempts per hour.
  for(const id of recoverySources()){
   const result=await runUnavailableRecheckBatch({
    pool,sourceId:id,probe:probeUnavailableMediaOnSameSource,limit:3
   });
   for(const field of ['checked','recovered','stillMissing','transient'])
    totals[field]+=Number(result[field])||0;
   if(result.checked){
    console.info('BLOFY_UNAVAILABLE_MEDIA_RECHECK',JSON.stringify({
     sourceId:id,checked:result.checked,recovered:result.recovered,
     stillMissing:result.stillMissing,transient:result.transient,
     firstMediaBytesOnly:true,subscriberCutover:false,
     catalogMutation:false,providerCredentialsLogged:false
    }));
   }
  }
  return totals;
 }finally{unavailableRecoveryBusy=false;}
}

// Explicit operator one-shot: reconsider at most two *already recorded*
// missing items on one source immediately. Separate from the periodic timer.
// No media or subscriber writes except the registry status/backoff.
if(process.env.BLOFY_XTREAM_UNAVAILABLE_EXPEDITE_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void (async()=>{
   await ensureReady();
   const sourceId=String(process.env.BLOFY_XTREAM_UNAVAILABLE_EXPEDITE_SOURCE_ID||'').trim().toLowerCase();
   if(!recoveryEnabled()||!validUuid(sourceId)||!recoverySources().has(sourceId))return;
   const expedited=await expediteUnavailableRecheck(pool,sourceId,{limit:2});
   const totals=await runDueUnavailableMedia();
   console.info('BLOFY_UNAVAILABLE_EXPEDITE_PROOF',JSON.stringify({
    sourceId,expedited,...totals,firstMediaBytesOnly:true,
    catalogMutation:false,subscriberCutover:false,credentialsLogged:false
   }));
  })().catch(()=>console.warn('BLOFY_UNAVAILABLE_EXPEDITE_PROOF',
   JSON.stringify({ok:false,code:'expedite_unavailable',
    catalogMutation:false,subscriberCutover:false,credentialsLogged:false})));
 },25000);
 timer.unref?.();
}

// Optional first rollout: register only provider-confirmed 404 for the three
// already well-known first movie samples, using the same original source ID.
// No player auth bypass, mass catalog scan, alternate-ID guess, or subscriber
// source change. Disabled after a single operator-led production boot.
async function seedUnavailableMediaOnce(){
 if(process.env.BLOFY_XTREAM_UNAVAILABLE_SEED_ON_BOOT!=='1')return;
 try{
  await ensureReady();
  for(const serverId of recoverySources()){
   const source=(await pool.query(`SELECT id FROM blofy_xtream_servers
    WHERE id=$1 AND enabled=TRUE AND publish_catalog=TRUE
      AND deletion_requested_at IS NULL LIMIT 1`,[serverId])).rows[0];
   if(!source)continue;
   const items=(await pool.query(`SELECT source_id FROM blofy_xtream_items
    WHERE server_id=$1 AND media_type='movie' AND enabled=TRUE
    ORDER BY name ASC LIMIT 3`,[serverId])).rows;
   const aggregate={sourceId:serverId,checked:0,verifiedMissing:0,
    firstMediaBytes:0,transient:0,mediaDeleted:false,
    catalogMutation:false,subscriberCutover:false,credentialsLogged:false};
   for(const item of items){
    const key=validUnavailableKey({serverId,kind:'movie',itemId:item.source_id});
    if(!key)continue;
    const result=await probeUnavailableMediaOnSameSource(key);
    aggregate.checked++;
    if(result==='provider404'){
     await registerProvider404(pool,key);
     aggregate.verifiedMissing++;
    }else if(result==='recovered')aggregate.firstMediaBytes++;
    else aggregate.transient++;
    if(aggregate.checked<3)await new Promise(resolve=>setTimeout(resolve,750));
   }
   console.info('BLOFY_UNAVAILABLE_MEDIA_SEED',JSON.stringify(aggregate));
  }
 }catch{
  console.warn('BLOFY_UNAVAILABLE_MEDIA_SEED',
   JSON.stringify({ok:false,code:'safe_sample_unavailable',
    catalogMutation:false,subscriberCutover:false,credentialsLogged:false}));
 }
}
if(process.env.BLOFY_XTREAM_UNAVAILABLE_SEED_ON_BOOT==='1'){
 const timer=setTimeout(()=>{void seedUnavailableMediaOnce()},30000);
 timer.unref?.();
}

async function proxyMedia(req, res, kind, username, password, gatewayId, requestedExtension, authorizedAccount=null) {
  if (!requirePublicBudget(req, res)) return;
  const account = await authenticate(username, password, { touch: false }) || authorizedAccount;
  if (!account) {
    // A rejected BLOFY account is not an upstream media 403/404.
    if(req.method!=='HEAD')recordXtreamPlayback({kind,phase:'failed',itemId:gatewayId,reason:'gateway_auth_denied'});
    return text(res, 401, 'Unauthorized');
  }
  let row, sourceId, extension;
  if (kind === 'series') {
    row = await episodeByGatewayId(gatewayId,account.source_id||null);
    if (!row || !row.server_enabled) {
      if(req.method!=='HEAD')recordXtreamPlayback({kind,phase:'failed',itemId:gatewayId,reason:'catalog_item_unavailable'});
      return text(res, 404, 'Stream not found');
    }
    sourceId = row.source_episode_id;
    extension = row.container_extension;
  } else {
    row = await gatewayItemById(kind === 'live' ? 'live' : 'movie', gatewayId,account.source_id||null);
    if (!row || !row.server_enabled) {
      if(req.method!=='HEAD')recordXtreamPlayback({kind,phase:'failed',itemId:gatewayId,reason:'catalog_item_unavailable'});
      return text(res, 404, 'Stream not found');
    }
    sourceId = row.source_id;
    extension = row.container_extension;
  }
  // A media client's requested filename extension might be guessed. Movies and
  // episodes use the authoritative extension stored at import time, not a guess.
  // Live streams may choose TS or HLS when the source supports those formats.
  const mediaExtension=kind==='live'?(requestedExtension||extension):(extension||requestedExtension);
  const startedAt=Date.now();
  let actualStreamStartedAt=0,closedTelemetryRecorded=false,feedEndedNormally=false;
  // A rejected individual channel cannot block another channel or source.
  // This is an in-memory guard against repeat viewer requests, not a way
  // around the provider's permissions. Only verified 403/456 trigger it.
  const cooldownKey=String(row.server_id)+':'+kind+':'+String(gatewayId);
  // The account and catalog item have already passed authorization.
  // Track only verified upstream media failures, never local auth/catalog 404.
  const unavailableKey=mediaRegistryKey(row,kind,sourceId);
  const observe=(phase,details={})=>{
    if(req.method!=='HEAD')recordXtreamPlayback({kind,itemId:gatewayId,sourceId:row.server_id,phase,...details});
  };
  if(req.method!=='HEAD'){
    const rejection=mediaDenialCooldown.active(cooldownKey);
    if(rejection){
      observe('failed',{upstreamStatus:rejection.status,reason:'upstream_denial_cooldown'});
      return text(res,502,'Upstream playback temporarily unavailable','text/plain; charset=utf-8',
        {'retry-after':String(rejection.retryAfterSeconds)});
    }
  }
  const upstream = mediaUpstreamUrl(row, kind, sourceId, mediaExtension);
  // Licensed live delivery can use one upstream TS feed with fanout to
  // independently authorized BLOFY viewers. Distributor permissions are
  // verified from the SOURCE's Xtream user_info; each subscriber is
  // validated above. Hard fail if shared-mode confirmation is missing;
  // never create 100 separate upstream requests as an accidental fallback.
  if(req.method==='GET'&&permittedLicensedLiveFanout({
      sourceId:row.server_id,sourceName:row.source_name,
      sourceNameMatches:row.source_name_matches,
      kind,extension:mediaExtension,
      upstreamRestreamer:row.source_restreamer_allowed===true
    })){
    try{
      const destination=await issueStreamRelayGrant({
        sourceUrl:upstream.href,kind,sharedLive:true,requireSharedLive:true
      });
      res.writeHead(307,{'location':destination,'cache-control':'no-store',
        'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
      return res.end();
    }catch{
      observe('failed',{reason:'licensed_fanout_unavailable'});
      return text(res,503,'Live distribution temporarily unavailable',
        'text/plain; charset=utf-8',{'retry-after':'4'});
    }
  }
  // Optional one-account canary: transfer the data plane to the isolated
  // Railway project. Authentication, catalog restrictions, source selection
  // and subscriber expiry stay checked here first. Disabled by default.
  if(relayEligible({accountId:account.id,kind,extension:mediaExtension})){
    try{
      const destination=await issueStreamRelayGrant({
        sourceUrl:upstream.href,kind,
        // Legacy account canary remains per-viewer only. Shared fanout
        // is exclusively available through the source-scoped licensed
        // branch above, which requires actual upstream restream rights.
        sharedLive:false
      });
      res.writeHead(307,{'location':destination,'cache-control':'no-store',
        'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
      return res.end();
    }catch{
      // If the new media plane cannot issue a safe ticket, keep the old
      // playback route operational for this request and customer.
      console.warn('BLOFY_STREAM_RELAY_CANARY_FALLBACK',{kind,reason:'relay_unavailable'});
    }
  }
  let mediaFetchTarget=upstream;
  let directSourceTarget=upstream;
  let usingIndependentRelay=false;
  // Use independent Railway egress only for explicitly allowed source/kind:
  // live TS, or separately enabled VOD (movie/episode). All source, catalog,
  // subscriber and expiry checks have already completed above.
  // If the protected service cannot issue a ticket, fall back immediately.
  if(shouldUseIndependentSourceMedia({
    sourceId:row.server_id,kind,extension:mediaExtension
  })){
    try{
      mediaFetchTarget=new URL(await issueStreamRelayGrant({sourceUrl:upstream.href,kind}));
      usingIndependentRelay=true;
    }catch{
      console.warn('BLOFY_XTREAM_INDEPENDENT_SOURCE_FALLBACK',{
        kind,sourceId:row.server_id,reason:'relay_ticket_unavailable'});
    }
  }
  // Keep each viewer's stream independent. Only retry failures before video bytes reach them.
  const client = new AbortController();
  const abort = () => { if (!client.signal.aborted) client.abort(); };
  const onClose = () => {
    if (!res.writableEnded) {
      if(kind==='live'&&actualStreamStartedAt>0&&!closedTelemetryRecorded&&!feedEndedNormally){
        closedTelemetryRecorded=true;
        observe('client_closed',{reason:'client_or_proxy_closed',
          durationMs:Date.now()-actualStreamStartedAt});
      }
      abort();
    }
  };
  req.once('aborted', abort);
  res.once('close', onClose);
  const headers = { 'user-agent': String(req.headers['user-agent'] || 'BLOFY-Xtream-Gateway/1.0') };
  if (req.headers.range) headers.range = String(req.headers.range);
  // A provider returning 404/416 only for "Range: bytes=0-..." can be
  // rechecked once with plain GET. Never discard a nonzero seek request.
  const initialRange=firstByteXtreamRange(headers.range)&&req.method==='GET';
  const movieRefreshAllowed=kind==='movie'&&req.method==='GET'&&
    mayRefreshMovieExtension(row.server_id);
  const episodeRefreshAllowed=kind==='series'&&req.method==='GET'&&
    mayRefreshEpisodeExtension(row.server_id);
  const fallbackAllowed=req.method==='GET'&&shouldFallbackIndependentVod({
    sourceId:row.server_id,kind,extension:mediaExtension
  });
  const relay404DirectAllowed=shouldCompareRelay404Direct({
    sourceId:row.server_id,kind,method:req.method,range:headers.range,
    usingIndependentRelay:true,relayFailure:'relay_provider_not_found'
  });
  const maxAttempts=req.method==='HEAD'?1:
    (initialRange?3:2)+(movieRefreshAllowed||episodeRefreshAllowed?1:0)+
    (fallbackAllowed?1:0)+(relay404DirectAllowed?1:0);
  let noRangeRetried=false, transientRetried=false,extensionRefreshTried=false,
    fallbackTried=false,directCompareTried=false;
  try {
    for (let attempt=1;attempt<=maxAttempts;attempt++) {
      if (client.signal.aborted) return;
      const controller = new AbortController();
      const cancel = () => controller.abort();
      client.signal.addEventListener('abort', cancel, { once: true });
      let reader = null, response = null;
      try {
        let timer = setTimeout(() => controller.abort(new Error('headers_timeout')), 12000);
        try {
          response = await checkedFetch(mediaFetchTarget, {
            method: req.method === 'HEAD' ? 'HEAD' : 'GET',
            timeoutMs: 12000, headers, signal: controller.signal
          });
        } finally { clearTimeout(timer); }
        if (!(response.ok || response.status === 206)) {
          // An independent relay may surface provider 404 as outer HTTP 502.
          // Do not retry that same unavailable file or count it as a transient
          // gateway outage. Only read the fixed sanitized body of our relay.
          const relayFailure=usingIndependentRelay&&response.status===502?
            await readSanitizedXtreamRelayFailure(response):null;
          const confirmedMissing=relayFailure==='relay_provider_not_found';
          const retryable=!confirmedMissing&&[408,500,502,503,504].includes(response.status);
          const retryWithoutRange = shouldRetryXtreamWithoutRange({
            status:response.status,range:headers.range,method:req.method,
            alreadyRetried:noRangeRetried
          }) && attempt < maxAttempts;
          console.warn('xtream media upstream status', {kind, itemId:gatewayId, status:response.status, attempt,
            retryWithoutRange,relayFailure});
          // Never expose upstream bodies; store only a fixed, allowlisted hint
          // if the provider itself explained a denied request.
          const shouldRefresh=(movieRefreshAllowed||episodeRefreshAllowed)&&
            !extensionRefreshTried&&!retryWithoutRange&&
            (response.status===404||confirmedMissing)&&attempt<maxAttempts&&
            movieRefreshDue(String(row.server_id)+':'+kind+':'+String(sourceId));
          if(shouldRefresh){
            extensionRefreshTried=true;
            await response.body?.cancel().catch(()=>{});
            const freshExtension=episodeRefreshAllowed?
              await freshAdvertisedEpisodeExtension(row,sourceId,mediaExtension):
              await freshAdvertisedMovieExtension(row,sourceId,mediaExtension);
            if(freshExtension){
              const corrected=mediaUpstreamUrl(row,kind,sourceId,freshExtension);
              try{
                mediaFetchTarget=usingIndependentRelay?
                  new URL(await issueStreamRelayGrant({
                    sourceUrl:corrected.href,kind})):corrected;
                directSourceTarget=corrected;
                // The provider advertised an extension for the SAME movie or
                // episode. The mapping and catalog remain untouched.
                console.info('BLOFY_VOD_EXTENSION_RECOVERY',{
                  kind,state:'provider_extension_changed',sourceId:row.server_id});
                continue;
              }catch{}
            }
          }
          // If provider 404 differs across the two Railway egress regions,
          // check the EXACT same authorized URL once through the original
          // gateway. A direct 404 remains final; do not switch sources or IDs.
          if(shouldCompareRelay404Direct({sourceId:row.server_id,kind,
              method:req.method,range:headers.range,usingIndependentRelay,
              relayFailure,alreadyTried:directCompareTried}) &&
              attempt<maxAttempts && !client.signal.aborted){
            directCompareTried=true;
            fallbackTried=true; // never bounce back to the failing relay
            await response.body?.cancel().catch(()=>{});
            mediaFetchTarget=directSourceTarget;
            usingIndependentRelay=false;
            if(firstByteXtreamRange(headers.range))delete headers.range;
            delete headers['if-range'];
            console.info('BLOFY_VOD_RELAY404_DIRECT_COMPARE',{
              kind,sourceId:row.server_id,state:'same_file_direct_attempt'});
            continue;
          }
          const providerHint=retryWithoutRange||shouldRefresh||usingIndependentRelay?null:
            await readXtreamProviderDenialHint(response);
          // Some upstream proxies return 502/503 instead of throwing for a
          // broken connection. Only the original route can trigger this
          // source-allowed fallback; confirmed missing media and provider
          // denials remain terminal. Do not switch a healthy stream.
          const httpEgressFailure=fallbackAllowed&&!fallbackTried&&
            !usingIndependentRelay&&!res.headersSent&&!providerHint&&
            (response.status===502||response.status===503)&&
            attempt<maxAttempts;
          if(httpEgressFailure){
            fallbackTried=true;
            await response.body?.cancel().catch(()=>{});
            try{
              mediaFetchTarget=new URL(await issueStreamRelayGrant({
                sourceUrl:upstream.href,kind
              }));
              usingIndependentRelay=true;
              console.info('BLOFY_VOD_EGRESS_FALLBACK',{
                kind,sourceId:row.server_id,state:'retry_via_relay',cause:'upstream_http'
              });
              continue;
            }catch{
              console.warn('BLOFY_VOD_EGRESS_FALLBACK',{
                kind,sourceId:row.server_id,state:'relay_ticket_unavailable'
              });
            }
          }
          // Respect provider refusals, and cool down this channel only.
          if(req.method!=='HEAD')mediaDenialCooldown.denied(cooldownKey,response.status);
          await response.body?.cancel().catch(()=>{});
          if(retryWithoutRange){
            noRangeRetried=true;
            delete headers.range;
            continue;
          }
          if (retryable && !transientRetried && attempt < maxAttempts) {
            transientRetried=true;
            await new Promise(resolve=>setTimeout(resolve, 200*attempt));
            continue;
          }
          // The authenticated STREAM relay may envelope a provider 404 as
          // 502. Return terminal 404 ONLY when its fixed diagnostic verified
          // that original upstream status. Do not induce client retry storms
          // or falsely blame BLOFY for a file the provider did not serve.
          const clientStatus=customerMediaFailureStatus({
            usingIndependentRelay,relayStatus:response.status,relayFailure
          });
          observe('failed',{
            upstreamStatus:confirmedMissing?404:response.status,
            reason:relayFailure||(['403','404','408','429','456','500','502','503','504'].includes(String(response.status))
              ?'upstream_http_'+response.status:'upstream_http_other'),
            providerHint,attempts:attempt
          });
          // Only final, verified provider-file 404 after safe range/extension
          // handling. No row is created for 502 transport errors or HTTP HEAD.
          if(req.method==='GET'&&(confirmedMissing||response.status===404))
            asyncNoteMissing(unavailableKey);
          return text(res,clientStatus,
            clientStatus===404?'Media unavailable':'Upstream unavailable');
        }
        const outputHeaders = {};
        for (const name of ['content-type','content-length','content-range','accept-ranges','cache-control','last-modified','etag']) {
          const value = response.headers.get(name);
          if (value) outputHeaders[name] = value;
        }
        outputHeaders['x-content-type-options'] = 'nosniff';
        if (req.method === 'HEAD' || !response.body) {
          res.writeHead(response.status, outputHeaders);
          return res.end();
        }
        reader = response.body.getReader();
        const readChunk = async (duration) => {
          const timeout = setTimeout(() => controller.abort(new Error('media_read_timeout')), duration);
          try { return await reader.read(); } finally { clearTimeout(timeout); }
        };
        const first = await readChunk(15000);
        if (first.done || !first.value?.byteLength) throw new Error('upstream_empty_media');
        const inspection=inspectXtreamMediaChunk(first.value,response.headers.get('content-type'));
        if(!inspection.valid)throw new Error(inspection.reason);
        // The app-only product promises that upstream Xtream URLs and
        // passwords never leave BLOFY. Raw HLS playlists may contain absolute
        // provider URLs or credential-bearing relative segment paths. Refuse
        // those bytes until a segment-rewriting authorized HLS gateway exists.
        // Legacy Xtream accounts remain unchanged.
        if(authorizedAccount&&inspection.format==='hls'){
          await response.body?.cancel().catch(()=>{});
          observe('failed',{reason:'app_hls_secure_proxy_required',attempts:attempt});
          return text(res,415,'Protected HLS proxy not configured');
        }
        // Some providers label MP4/MKV as octet-stream. Use the verified
        // container type only when the source supplied no meaningful MIME.
        // Preserve bytes, range headers, codec and existing explicit types.
        const verifiedType=verifiedXtreamMediaContentType(
          response.headers.get('content-type'),inspection);
        if(verifiedType)outputHeaders['content-type']=verifiedType;
        // Confirm alternate egress only after validated media bytes.
        if(directCompareTried&&!usingIndependentRelay){
          console.info('BLOFY_VOD_RELAY404_DIRECT_COMPARE',{
            kind,sourceId:row.server_id,state:'direct_media_first_bytes_received'});
        }
        // Confirm fallback only after validated media bytes; a ticket is not success.
        if(fallbackTried&&usingIndependentRelay){
          console.info('BLOFY_VOD_EGRESS_FALLBACK',{
            kind,sourceId:row.server_id,state:'media_first_bytes_received'
          });
        }
        // Only announce a successful response once the provider really sent media bytes.
        mediaDenialCooldown.clear(cooldownKey);
        // First validated media bytes clear any existing unavailable state.
        // No content is deleted or returned to the viewer by this DB update.
        if(req.method==='GET')asyncNoteRecovered(unavailableKey);
        observe('started',{upstreamStatus:response.status,startupMs:Date.now()-startedAt,attempts:attempt});
        actualStreamStartedAt=Date.now();
        res.writeHead(response.status, outputHeaders);
        const stream = Readable.from((async function* () {
          yield first.value;
          while (true) {
            const chunk = await readChunk(45000);
            if (chunk.done) return;
            if (chunk.value?.byteLength) yield chunk.value;
          }
        })());
        await pipeline(stream, res);
        feedEndedNormally=true;
        if(kind==='live'&&actualStreamStartedAt>0){
          observe('ended',{reason:'upstream_stream_ended',durationMs:Date.now()-actualStreamStartedAt});
        }
        return;
      } catch (error) {
        if (client.signal.aborted) return;
        const reason = controller.signal.reason?.message || error?.message || 'media_error';
        const networkReason=safeXtreamTransportCategory(error);
        const safeReason = ['headers_timeout','media_read_timeout','upstream_empty_media','upstream_non_media_response'].includes(reason)
          ? reason : (networkReason||'upstream_unreachable');
        console.warn('xtream media relay error', {kind,itemId:gatewayId,reason:safeReason,attempt});
        // Switch egress ONLY if the original connection failed before
        // headers/media; never on a provider 403/404/456 or after bytes begin.
        // Existing working playback remains on its original direct route.
        const transportFailure=['upstream_unreachable','headers_timeout',
          'xtream_transport_connection_reset','connection_reset','timeout']
          .includes(safeReason);
        if(fallbackAllowed&&!fallbackTried&&!usingIndependentRelay&&
          !res.headersSent&&transportFailure&&attempt<maxAttempts){
          fallbackTried=true;
          try{
            mediaFetchTarget=new URL(await issueStreamRelayGrant({
              sourceUrl:upstream.href,kind
            }));
            usingIndependentRelay=true;
            console.info('BLOFY_VOD_EGRESS_FALLBACK',{
              kind,sourceId:row.server_id,state:'retry_via_relay',cause:'transport'
            });
            continue;
          }catch{
            console.warn('BLOFY_VOD_EGRESS_FALLBACK',{
              kind,sourceId:row.server_id,state:'relay_ticket_unavailable'
            });
          }
        }
        if (!res.headersSent && !transientRetried && attempt < maxAttempts && safeReason!=='upstream_non_media_response') {
          transientRetried=true;
          await new Promise(resolve=>setTimeout(resolve,200*attempt));
          continue;
        }
        if(res.headersSent)closedTelemetryRecorded=true;
        observe(res.headersSent?'interrupted':'failed',{reason:safeReason,attempts:attempt,
          durationMs:actualStreamStartedAt>0?Date.now()-actualStreamStartedAt:null});
        if (!res.headersSent) return text(res, safeReason==='headers_timeout'||safeReason==='media_read_timeout'?504:502, 'Upstream unavailable');
        if (!res.destroyed) res.destroy();
        return;
      } finally {
        controller.abort();
        client.signal.removeEventListener('abort',cancel);
        if (reader) {
          try { await reader.cancel(); } catch {}
          try { reader.releaseLock(); } catch {}
        }
      }
    }
  } finally {
    req.off('aborted',abort);
    res.off('close',onClose);
  }
}

// Explicit operator-only probe. Check first bytes, never return upstream URLs,
// source IDs, provider passwords, client IPs or full media payloads.
let itemProbeAt=0;
let itemProbeRunning=false;
async function probeGatewayMedia(kind,itemId){
  if(!['live','movie','series'].includes(kind)||!Number.isSafeInteger(itemId)||itemId<1)
    throw Object.assign(new Error('xtream_media_probe_invalid'),{status:400});
  const now=Date.now();
  if(itemProbeRunning)throw Object.assign(new Error('xtream_media_probe_busy'),{status:429});
  if(now-itemProbeAt<12000)throw Object.assign(new Error('xtream_media_probe_cooldown'),{status:429});
  itemProbeAt=now;
  itemProbeRunning=true;
  const started=Date.now();
  let reader,response;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const row=kind==='series'
      ?await episodeByGatewayId(itemId)
      :await gatewayItemById(kind==='live'?'live':'movie',itemId);
    if(!row||!row.server_enabled)return{ok:false,kind,itemId,reason:'catalog_item_not_found',httpStatus:null};
    const ext=safeGatewayExtension(row.container_extension,kind==='live'?'ts':'mp4');
    const sourceId=kind==='series'?row.source_episode_id:row.source_id;
    const upstream=mediaUpstreamUrl(row,kind,sourceId,ext);
    let url=upstream;
    // The operator's probe must follow the same opt-in TS transport as
    // subscribers. Otherwise an upstream reset is a false negative while
    // real gateway playback uses the independent STREAM service.
    if(shouldUseIndependentSourceMedia({
      sourceId:row.server_id,kind,extension:ext
    })){
      try{
        url=new URL(await issueStreamRelayGrant({sourceUrl:upstream.href,kind}));
      }catch{
        // A failed capability request must never change source permissions,
        // retry a denied provider response, or leak a signed media URL.
        console.warn('BLOFY_XTREAM_GATEWAY_PROBE_FALLBACK',{
          kind,reason:'relay_ticket_unavailable'
        });
      }
    }
    const probeHeaders={
      'user-agent':'BLOFY-Media-Diagnostics/1.0',
      ...(kind==='live'?{}:{range:'bytes=0-2047'})
    };
    response=await checkedFetch(url,{
      method:'GET',headers:probeHeaders,signal:controller.signal
    });
    let rangeFallbackUsed=false;
    // Keep diagnostics consistent with the actual playback gateway: some
    // providers return 404/416 only for a first-byte Range request.
    if(shouldRetryXtreamWithoutRange({status:response.status,range:probeHeaders.range})){
      await response.body?.cancel().catch(()=>{});
      response=null;
      delete probeHeaders.range;
      rangeFallbackUsed=true;
      response=await checkedFetch(url,{method:'GET',headers:probeHeaders,signal:controller.signal});
    }
    const status=response.status;
    if(!(response.ok||status===206)){
      const providerHint=await readXtreamProviderDenialHint(response);
      return{ok:false,kind,itemId,httpStatus:status,reason:'upstream_http_'+status,
        ...(providerHint?{providerHint}:{}),elapsedMs:Date.now()-started};
    }
    if(!response.body)return{ok:false,kind,itemId,httpStatus:status,reason:'upstream_empty_media',elapsedMs:Date.now()-started};
    reader=response.body.getReader();
    let first;
    do{first=await reader.read()}while(!first.done&&!first.value?.byteLength);
    if(first.done)return{ok:false,kind,itemId,httpStatus:status,reason:'upstream_empty_media',elapsedMs:Date.now()-started};
    const inspection=inspectXtreamMediaChunk(first.value,response.headers.get('content-type'));
    if(!inspection.valid)
      return{ok:false,kind,itemId,httpStatus:status,reason:inspection.reason,elapsedMs:Date.now()-started};
    return{ok:true,kind,itemId,httpStatus:status,format:inspection.format,rangeFallbackUsed,elapsedMs:Date.now()-started,
      note:'first_media_bytes_only'};
  }catch(error){
    return{ok:false,kind,itemId,httpStatus:null,
      reason:controller.signal.aborted?'timeout':'source_unreachable',elapsedMs:Date.now()-started};
  }finally{
    clearTimeout(timeout);
    controller.abort();
    if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
    else if(response?.body){try{await response.body.cancel()}catch{}}
    itemProbeRunning=false;
  }
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
  // Many Xtream-compatible clients submit credentials/actions via POST body.
  url = await mergeXtreamPlayerRequest(req, url);
  const username = url.searchParams.get('username') || '';
  const password = url.searchParams.get('password') || '';
  const bearerAccount=(!username&&!password&&bearerFromRequest(req))?
    await authenticateAppBearer(req):null;
  const account = await authenticate(username, password, { touch: true }) || bearerAccount;
  if (!account) return json(res, 200, { user_info: { auth: 0, status: 'Disabled' }, server_info: playerServerInfo(req) });
  const action = String(url.searchParams.get('action') || '');
  if (!action) {
    const studio=await getXtreamStudioBranding();
    const user=accountInfo(account,bearerAccount?'':username,bearerAccount?'':password);
    user.message=studio.name;
    return json(res,200,{user_info:user,server_info:{
      ...playerServerInfo(req),server_name:studio.name,
      server_logo:studio.logoUrl?origin(req)+studio.logoUrl:''
    }});
  }
  // BLOFY-specific extension: device may check revision before explicitly
  // refreshing standard Xtream lists. Authentication and source scope are
  // identical to every other player_api action; no per-user state changes.
  if(action==='get_blofy_catalog_version'){
    res.setHeader('cache-control','private, no-store');
    const status=await xtreamCatalogVersionForAccount(
      pool,account.source_id||null,url.searchParams.get('since'));
    return json(res,status.ok?200:409,status);
  }
  if (action === 'get_live_categories') return json(res, 200, await gatewayCategories('live',account.source_id||null));
  if (action === 'get_vod_categories') return json(res, 200, await gatewayCategories('movie',account.source_id||null));
  if (action === 'get_series_categories') return json(res, 200, await gatewayCategories('series',account.source_id||null));
  if (action === 'get_live_streams') return streamGatewayItems(req,res, 'live', url.searchParams.get('category_id'),account.source_id||null);
  if (action === 'get_vod_streams') return streamGatewayItems(req,res, 'movie', url.searchParams.get('category_id'),account.source_id||null);
  if (action === 'get_series') return streamGatewayItems(req,res, 'series', url.searchParams.get('category_id'),account.source_id||null);
  if (action === 'get_vod_info') {
    const value = await vodInfo(url.searchParams.get('vod_id'),account.source_id||null);
    return json(res, value ? 200 : 404, value || { error: 'vod_not_found' });
  }
  if (action === 'get_series_info') {
    const value = await seriesInfo(url.searchParams.get('series_id'),account.source_id||null);
    return json(res, value ? 200 : 404, value || { error: 'series_not_found' });
  }
  if (action === 'get_short_epg' || action === 'get_simple_data_table') {
    const data=await liveEpg(url.searchParams.get('stream_id'),account.source_id||null,
      action,url.searchParams.get('limit'));
    return json(res,200,data);
  }
  return json(res, 200, []);
}

async function handleM3u(req, res, url) {
  if (!requirePublicBudget(req, res)) return;
  const username = url.searchParams.get('username') || '';
  const password = url.searchParams.get('password') || '';
  const account = await authenticate(username, password, { touch: true });
  if (!account) return text(res, 401, 'Unauthorized');
  const base = origin(req);
  // These credentials are identical for every entry in this authorized M3U
  // export. Encode them once rather than hundreds of thousands of times.
  const encodedAccount = encodeURIComponent(username)+'/'+encodeURIComponent(password);
  for(const kind of ['live','movie']){
    await ensureCategoryMaps(kind,account.source_id||null);
    await ensureItemMaps(kind,account.source_id||null);
  }
  res.writeHead(200, {
    'content-type': 'audio/x-mpegurl; charset=utf-8',
    'cache-control': 'no-store',
    'content-disposition': 'inline; filename="blofy.m3u"'
  });
  await writeStreamChunk(res,'#EXTM3U\n');
  for (const mediaType of ['live','movie']) {
    await walkGatewayItems(mediaType, null, async row => {
      // M3U uses only the already-selected source fields; formatting a full
      // Xtream API object per entry was unused work on huge playlist exports.
      const group = escapeM3uAttribute(row.category_name || row.metadata?.genre || (mediaType === 'live' ? 'Live' : 'Movies'));
      const name = escapeM3uAttribute(row.name);
      const logo = escapeM3uAttribute(row.icon_url || '');
      const ext = mediaType === 'live' ? 'ts' : safeGatewayExtension(row.container_extension, 'mp4');
      const kind = mediaType === 'live' ? 'live' : 'movie';
      // One write/drain check per entry rather than two: quicker exports
      // without changing M3U order, paths, credentials or authorization.
      await writeStreamChunk(res,`#EXTINF:-1 tvg-name="${name}" tvg-logo="${logo}" group-title="${group}",${name}\n`+
        `${base}/${kind}/${encodedAccount}/${row.gateway_id}.${ext}\n`);
    }, account.source_id||null);
  }
  res.end();
}

async function collectGatewayHealth() {
  await ensureReady();
  const accounts = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_accounts WHERE enabled=TRUE AND (expires_at IS NULL OR expires_at>NOW())`)).rows[0]?.count || 0);
  const rows = (await pool.query(`SELECT media_type,COUNT(*)::int AS count FROM blofy_xtream_items i JOIN blofy_xtream_servers s ON s.id=i.server_id
    WHERE s.enabled=TRUE AND s.publish_catalog=TRUE AND i.enabled=TRUE GROUP BY media_type`)).rows;
  const catalog = { live: 0, movie: 0, series: 0 };
  for (const row of rows) if (Object.hasOwn(catalog,row.media_type)) catalog[row.media_type] = Number(row.count);
  return { ok: true, compatible: 'Xtream Codes API', accounts, catalog, playbackProxy: true };
}
// Health totals can scan a large library; no need to rerun the aggregation
// for every polling device. Never cache authentication or playback decisions.
const cachedGatewayHealth = createXtreamHealthSnapshot(collectGatewayHealth);
async function gatewayHealth(){ return cachedGatewayHealth(); }

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
      if (req.method === 'GET' && url.pathname === '/stream/activate') {
        const page=await readFile(new URL('../web/stream-activate.html',import.meta.url));
        res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-length':page.length,
          'cache-control':'no-store','referrer-policy':'no-referrer',
          'content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          'x-content-type-options':'nosniff'});
        return res.end(page);
      }
      if (req.method === 'GET' && url.pathname === '/stream/activate.js') {
        const asset=await readFile(new URL('../web/stream-activate.js',import.meta.url));
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','content-length':asset.length,
          'cache-control':'no-store','x-content-type-options':'nosniff'});
        return res.end(asset);
      }
      if (req.method === 'POST' && (url.pathname === '/api/v1/stream/redeem' ||
          url.pathname === '/api/v1/stream/app/redeem')) {
        const rate=streamCodeLimiter.consume(requestClientKey(req));
        if(!rate.allowed)return json(res,429,{ok:false,code:'stream_code_rate_limited'},
          {'retry-after':String(rate.retryAfterSeconds)});
        const overall=streamCodeGlobalLimiter.consume('all_redemptions');
        if(!overall.allowed)return json(res,429,{ok:false,code:'stream_code_rate_limited'},
          {'retry-after':String(overall.retryAfterSeconds)});
        await ensureReady();
        const data=await readJson(req);
        const result=await streamCodes.redeem(data.code,'https://blofyplayer.com',
          {deviceKey:data.deviceKey??null,
           appOnly:url.pathname==='/api/v1/stream/app/redeem'});
        return json(res,201,result,{'referrer-policy':'no-referrer',
          'cache-control':'no-store, private','pragma':'no-cache'});
      }
      if(req.method==='GET'&&url.pathname==='/api/v1/stream/app/session'){
        const account=await authenticateAppBearer(req);
        if(!account)return json(res,401,{ok:false,error:'stream_app_session_invalid'},
          {'cache-control':'no-store'});
        const expiry=account.expires_at?new Date(account.expires_at).getTime():null;
        const now=Date.now();
        return json(res,200,{ok:true,active:true,
          serverNow:now,expiresAt:expiry,
          daysRemaining:expiry==null?null:Math.max(0,Math.ceil((expiry-now)/86400000))},
          {'cache-control':'no-store'});
      }
      const tokenMedia=url.pathname.match(
        /^\/api\/v1\/stream\/media\/(live|movie|series)\/([0-9]+)(?:\.([A-Za-z0-9]{1,8}))?$/i);
      if(tokenMedia&&(req.method==='GET'||req.method==='HEAD')){
        const account=await authenticateAppBearer(req);
        if(!account)return text(res,401,'Unauthorized');
        if(tokenMedia[3]?.toLowerCase()==='m3u8')
          return text(res,415,'Protected HLS proxy not configured');
        return proxyMedia(req,res,tokenMedia[1].toLowerCase(),'','',
          tokenMedia[2],tokenMedia[3],account);
      }
      if (req.method === 'GET' && url.pathname === '/xtream/health') return json(res, 200, await gatewayHealth());
      if ((req.method === 'GET' || req.method === 'POST') && (url.pathname === '/player_api.php' || url.pathname === '/panel_api.php')) return await handlePlayerApi(req, res, url);
      if (req.method === 'GET' && url.pathname === '/get.php') return await handleM3u(req, res, url);
      if (req.method === 'GET' && url.pathname === '/xmltv.php') {
        const account = await authenticate(url.searchParams.get('username') || '', url.searchParams.get('password') || '');
        return account ? text(res, 200, '<?xml version="1.0" encoding="UTF-8"?><tv></tv>\n', 'application/xml; charset=utf-8') : text(res, 401, 'Unauthorized');
      }
      const mediaMatch = url.pathname.match(/^\/(live|movie|series)\/([^/]+)\/([^/]+)\/([0-9]+)(?:\.([A-Za-z0-9]{1,8}))?$/i);
      if (mediaMatch && (req.method === 'GET' || req.method === 'HEAD')) {
        return await proxyMedia(req, res, mediaMatch[1].toLowerCase(), decodeURIComponent(mediaMatch[2]), decodeURIComponent(mediaMatch[3]), mediaMatch[4], mediaMatch[5]);
      }

      if (!url.pathname.startsWith('/api/v1/admin/xtream-gateway')) return listener(req, res);
      if (!requireAdmin(req, res)) return;
      await ensureReady();
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream-gateway/playback-probe') {
        const body=await readJson(req);
        const raw=String(body.itemId??'');
        if(!/^[1-9][0-9]{0,14}$/.test(raw))
          return json(res,400,{error:'xtream_media_probe_invalid'});
        const result=await probeGatewayMedia(body.kind,Number(raw));
        return json(res,200,result);
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream-gateway/playback-health') {
        return json(res,200,{ok:true,metrics:xtreamPlaybackSnapshot()});
      }
      // Operator-only aggregate view: no media URLs, credentials, content
      // names, gateway account identities or subscriber permissions.
      if(req.method==='GET'&&url.pathname==='/api/v1/admin/xtream-gateway/unavailable-media'){
        const sourceId=url.searchParams.get('sourceId')||null;
        const result=await unavailableMediaSummary(pool,sourceId);
        return json(res,result.ok?200:400,result);
      }
      if(req.method==='POST'&&url.pathname==='/api/v1/admin/xtream-gateway/unavailable-media/recheck'){
        if(!recoveryEnabled())
          return json(res,409,{ok:false,error:'unavailable_recheck_disabled'});
        // Recheck only DB-leased records already due. No client playback.
        await runDueUnavailableMedia();
        return json(res,200,await unavailableMediaSummary(pool));
      }
      if(req.method==='POST'&&url.pathname==='/api/v1/admin/xtream-gateway/unavailable-media/recheck-now'){
        if(!recoveryEnabled())
          return json(res,409,{ok:false,error:'unavailable_recheck_disabled'});
        const body=await readJson(req);
        const sourceId=String(body.sourceId||'').trim().toLowerCase();
        if(!validUuid(sourceId)||!recoverySources().has(sourceId))
          return json(res,400,{ok:false,error:'unavailable_source_not_allowed'});
        // Source-specific manual button cannot override other source grants.
        // SQL excludes leased and recently rechecked items automatically.
        const expedited=await expediteUnavailableRecheck(pool,sourceId,{limit:2});
        const result=await runDueUnavailableMedia();
        return json(res,200,{ok:true,expedited,...result,
          scope:'verified_unavailable_media_only',subscriberCutover:false,
          catalogMutation:false});
      }
      if(req.method==='GET'&&url.pathname==='/api/v1/admin/xtream-gateway/codes') {
        return json(res,200,await streamCodes.list({
          limit:Number(url.searchParams.get('limit')||40),
          offset:Number(url.searchParams.get('offset')||0)
        }));
      }
      if(req.method==='POST'&&url.pathname==='/api/v1/admin/xtream-gateway/codes') {
        return json(res,201,await streamCodes.issue(await readJson(req)));
      }
      const codeReveal=url.pathname.match(/^\/api\/v1\/admin\/xtream-gateway\/codes\/([0-9a-f-]{36})\/reveal$/i);
      if(req.method==='GET'&&codeReveal){
        const result=await streamCodes.reveal(codeReveal[1]);
        return json(res,result.ok?200:result.code==='stream_code_not_found'?404:409,
          result,{'cache-control':'no-store','referrer-policy':'no-referrer'});
      }
      const codeRevoke=url.pathname.match(/^\/api\/v1\/admin\/xtream-gateway\/codes\/([0-9a-f-]{36})\/revoke$/i);
      if(req.method==='POST'&&codeRevoke)
        return json(res,200,await streamCodes.revoke(codeRevoke[1]));
      if(req.method==='GET'&&url.pathname==='/api/v1/admin/xtream-gateway/codes/sales-summary')
        return json(res,200,await streamCommercial.salesSummary());
      const commercialAction=url.pathname.match(/^\/api\/v1\/admin\/xtream-gateway\/codes\/([0-9a-f-]{36})\/(sell|extend|transfer)$/i);
      if(req.method==='POST'&&commercialAction){
        const id=commercialAction[1],kind=commercialAction[2];
        if(kind==='transfer')return json(res,200,
          await streamCommercial.reissueForDeviceTransfer(id),{'cache-control':'no-store'});
        const body=await readJson(req);
        if(kind==='extend')return json(res,200,await streamCommercial.extend(id,body));
        if(kind==='sell')return json(res,200,await streamCommercial.markSold(id,body));
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream-gateway') {
        const items = await listAccounts();
        return json(res, 200, { serverUrl: origin(req), items });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream-gateway/accounts') {
        return json(res, 201, await createAccount(await readJson(req), req));
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream-gateway/accounts/bulk') {
        return json(res, 201, await createAccountsBulk(await readJson(req), req));
      }
      const match = url.pathname.match(/^\/api\/v1\/admin\/xtream-gateway\/accounts\/([0-9a-f-]+)(?:\/(reset|credentials))?$/i);
      if (match) {
        const id = match[1];
        if (!validUuid(id)) return json(res, 400, { error: 'xtream_gateway_account_invalid' });
        if (match[2] === 'reset' && req.method === 'POST') return json(res, 200, await resetAccountPassword(id, req));
        if (match[2] === 'credentials' && req.method === 'GET') return json(res,200,await revealAccountCredentials(id,req));
        if (!match[2] && req.method === 'PATCH') return json(res, 200, { item: await patchAccount(id, await readJson(req)) });
        if (!match[2] && req.method === 'DELETE') {
          const result = await pool.query('DELETE FROM blofy_xtream_gateway_accounts WHERE id=$1', [id]);
          return json(res, result.rowCount ? 200 : 404, result.rowCount ? { deleted: true } : { error: 'xtream_gateway_account_not_found' });
        }
      }
      return json(res, 404, { error: 'xtream_gateway_route_not_found' });
    } catch (error) {
      // A player leaving a large catalog is not a server failure.
      if(error?.message==='xtream_client_disconnected')return;
      console.error('xtream gateway request failed:', redactXtreamError(error));
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) { res.destroy(); return; }
      const status = Number(error?.status) || 503;
      return json(res, status, { error: status === 503 ? 'xtream_gateway_unavailable' : String(error?.message || 'xtream_gateway_request_failed') });
    }
  });
};

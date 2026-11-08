import { databaseOptions } from './database-options.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';
import {safeXtreamTransportCategory} from './xtream-transport-errors.mjs';
import {withXtreamAccountReconnect} from './xtream-api-resilience.mjs';
import {createXtreamSyncQueue} from './xtream-sync-queue.mjs';
import {xtreamConnectionReport} from './xtream-smart-connection.mjs';
import {runXtreamBootDiagnostics} from './xtream-boot-diagnostics.mjs';
import {observeRailwayEgress,probeXtreamSocket} from './xtream-egress-inspector.mjs';
import {probeXtreamHttp11} from './xtream-http-compat-probe.mjs';
import {compareXtreamFromIndependentRailway} from './xtream-independent-probe.mjs';
import {shouldUseIndependentXtreamSource,fetchIndependentXtreamSource,
  fetchIndependentXtreamManifest,probeIndependentXtreamClientProfiles} from './xtream-independent-catalog-relay.mjs';
import {issueStreamRelayGrant} from './xtream-stream-relay-bridge.mjs';
import {shouldUseIndependentSourceMedia} from './xtream-independent-source-media-policy.mjs';
import {probeOfficialXtreamPlaylistRoute} from './xtream-official-m3u-probe.mjs';
import {readSanitizedXtreamRelayFailure} from './xtream-relay-diagnostic.mjs';
import {probeXtreamM3uAvailability} from './xtream-m3u-availability.mjs';
import {compareXtreamAdvertisedOrigin} from './xtream-advertised-origin-diagnostic.mjs';
import {auditEntireXtreamStoredCatalog} from './xtream-full-catalog-integrity-audit.mjs';
import {reconcileXtreamM3uWithImportedCatalog} from './xtream-m3u-catalog-reconciliation.mjs';
import {inspectSameXtreamVodInfo} from './xtream-vod-info-direct-source-audit.mjs';
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
  xtreamApiUrl,
  xtreamM3uUrl
} from './xtream-core.mjs';
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { downloadXtreamM3uCatalog } from './xtream-m3u-catalog.mjs';
import { distinctXtreamRecords } from './xtream-import-dedup.mjs';
import { assessXtreamSync } from './xtream-sync-guard.mjs';
import { CONTROL_PATH, controlPage, deleteConfirmationPage, readControlForm } from './xtream-native-controls.mjs';
import { xtreamEpisodeSamples, xtreamEpisodePlaybackCandidates, xtreamProbeMessage } from './xtream-series-probe.mjs';
import { inspectXtreamMediaChunk } from './xtream-media-inspector.mjs';
import { shouldRetryXtreamWithoutRange } from './xtream-media-range.mjs';
import { summarizeSourceMediaProbe,sourceMediaSummary,sourceAccountWarnings } from './xtream-source-media-health.mjs';
import { readXtreamProviderDenialHint } from './xtream-provider-denial.mjs';
import { xtreamAllowedLiveFormats,shouldStopXtreamFormatComparison,outputFormatDescription } from './xtream-live-output-policy.mjs';
import {liveDiagnosticTimeoutMs} from './xtream-live-probe-budget.mjs';
import { auditXtreamCatalogSample } from './xtream-library-insights.mjs';
import { normalizeXtreamDetails,mergedXtreamMetadata } from './xtream-item-details.mjs';
import { tmdbConfigured,validatedTmdbId,fetchTmdbDetails } from './xtream-tmdb.mjs';
import { sortXtreamCategories } from './xtream-category-sort.mjs';
import {createStudioPro} from './xtream-studio-pro.mjs';
import {normalizeXtreamEpg} from './xtream-epg.mjs';
import {normalizeStudioName,normalizeStudioItemEdit,readStudioLogoRequest} from './xtream-studio-policy.mjs';
import { nativeXtreamCsrfToken } from './xtream-native-csrf.mjs';

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_TOKEN = String(process.env.BLOFY_ADMIN_TOKEN || '').trim();
const ADMIN_SESSION_KEY=crypto.createHmac('sha256',ADMIN_TOKEN)
  .update(JSON.stringify(['blofy-admin-session-v3',
    String(process.env.BLOFY_ADMIN_USERNAME||'').trim(),
    String(process.env.BLOFY_ADMIN_PASSWORD||'').trim()])).digest();

const KEY_HEX = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
const pool = new pg.Pool({
  ...databaseOptions(DATABASE_URL),
  max: 4,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 15000,
  statement_timeout: 30000
});
pool.on('error', error => console.error('xtream database error:', safeErrorSummary(error)));

// Reserve connections for short, committed administration mutations.
// Long catalog synchronizations and cleanup must never starve Delete/Pause.
const controlPool = new pg.Pool({
  ...databaseOptions(DATABASE_URL),
  max: 2,
  connectionTimeoutMillis: 2500,
  idleTimeoutMillis: 15000,
  statement_timeout: 6500
});
controlPool.on('error', error => console.error('xtream admin database error:',safeErrorSummary(error)));

async function sourceMutation(sql, values) {
  for (let attempt=0;attempt<3;attempt++) {
    let client;
    try {
      client = await controlPool.connect();
      await client.query('BEGIN');
      // Fail quickly instead of leaving user actions pending for the HTTP
      // gateway's 15-second timeout when imports hold conflicting row locks.
      await client.query("SET LOCAL lock_timeout='1300ms'");
      await client.query("SET LOCAL statement_timeout='2800ms'");
      const result=await client.query(sql,values);
      await client.query('COMMIT');
      return result;
    } catch(error) {
      if(client)await client.query('ROLLBACK').catch(()=>{});
      const retryable=['55P03','57014','53300'].includes(String(error?.code||''))
        || /lock timeout|timeout exceeded when trying to connect|Connection terminated unexpectedly/i.test(String(error?.message||''));
      if(!retryable)throw error;
      if(attempt===2)throw Object.assign(new Error('xtream_source_busy_retry'),{status:409});
      await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
    } finally {
      client?.release();
    }
  }
  throw Object.assign(new Error('xtream_source_busy_retry'),{status:409});
}

const limiter = createFixedWindowLimiter({ limit: 180, windowMs: 60_000 });
const syncLocks = new Set();
// One source-wide import at a time, preserving time for playback/admin queries.
// Queued imports are visible, cancellable, and never store upstream credentials.
const syncQueue=createXtreamSyncQueue({
  concurrency:1,maxPending:16,
  onError:(id,error)=>console.error('xtream sync failed:',id,redactXtreamError(error))
});
const syncProgress = new Map();
const cancelledSources = new Set();
const purgeRunning = new Set();
let purgeSweepStarted = false;
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
      await client.query('ALTER TABLE blofy_xtream_servers ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ');
      await client.query("ALTER TABLE blofy_xtream_servers ADD COLUMN IF NOT EXISTS media_probe_state JSONB NOT NULL DEFAULT '{}'::jsonb");
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_categories (
        server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK(media_type IN ('live','movie','series')),
        source_category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 100000,
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
      // Publisher controls survive every Xtream re-import.
      await client.query('ALTER TABLE blofy_xtream_items ADD COLUMN IF NOT EXISTS custom_name TEXT');
      await client.query('ALTER TABLE blofy_xtream_items ADD COLUMN IF NOT EXISTS custom_icon_url TEXT');
      await client.query('ALTER TABLE blofy_xtream_items ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE');
      await client.query('ALTER TABLE blofy_xtream_items ADD COLUMN IF NOT EXISTS channel_number INTEGER');
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_studio_branding (
        id SMALLINT PRIMARY KEY CHECK(id=1),
        display_name TEXT NOT NULL DEFAULT 'BLOFY STREAM',
        logo_mime TEXT,
        logo_bytes BYTEA,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      await client.query(`INSERT INTO blofy_xtream_studio_branding(id,display_name)
        VALUES(1,'BLOFY STREAM') ON CONFLICT(id) DO NOTHING`);
      await client.query('ALTER TABLE blofy_xtream_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100000');
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
  const result = await readyPromise;
  if (!purgeSweepStarted) {
    purgeSweepStarted = true;
    const timer=setInterval(() => {
      void resumePendingPurges().catch(error =>
        console.warn('Xtream purge scan failed:', redactXtreamError(error)));
    }, 60000);
    timer.unref?.();
    setTimeout(() => void resumePendingPurges().catch(error =>
      console.warn('Xtream startup purge scan failed:', redactXtreamError(error))), 250);
  }
  return result;
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
    mediaSummary:sourceMediaSummary(row.media_probe_state),
    mediaWarnings:sourceAccountWarnings(row.account_info),
    counts,
    syncing: syncQueue.has(row.id)||syncLocks.has(row.id),
    queued:syncQueue.isQueued(row.id),
    syncProgress:syncQueue.isQueued(row.id)
      ? {mediaType:'queued',imported:0}
      : syncProgress.get(row.id) || null,
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
  return (await controlPool.query('SELECT * FROM blofy_xtream_servers WHERE deletion_requested_at IS NULL ORDER BY priority ASC,name ASC')).rows;
}

async function serverById(id) {
  await ensureReady();
  if (!validUuid(id)) return null;
  return (await controlPool.query('SELECT * FROM blofy_xtream_servers WHERE id=$1 AND deletion_requested_at IS NULL', [id])).rows[0] || null;
}

// A large catalog can hold thousands of foreign-key references. Mark a source
// disabled immediately and remove its records in bounded batches; a request must
// not spend the proxy's 15s timeout deleting 100,000+ rows.
const XTREAM_PURGE_TABLES = [
  'blofy_xtream_gateway_episode_map',
  'blofy_xtream_gateway_item_map',
  'blofy_xtream_gateway_category_map',
  'blofy_xtream_items',
  'blofy_xtream_categories'
];

async function purgeSource(id) {
  // One catalog cleanup at a time: avoid overwhelming PostgreSQL while admins
  // are attempting to pause/delete other sources or serve existing viewers.
  if (purgeRunning.has(id) || purgeRunning.size>=1) return;
  purgeRunning.add(id);
  cancelledSources.add(id);
  try {
    for (const table of XTREAM_PURGE_TABLES) {
      for (;;) {
        const result = await pool.query(`DELETE FROM ${table}
          WHERE ctid IN (SELECT ctid FROM ${table} WHERE server_id=$1 LIMIT 400)`, [id]);
        if (!result.rowCount) break;
        // Yield the event loop between bounded deletes; concurrent requests can
        // still pause other sources or read customer accounts.
        await new Promise(resolve => setTimeout(resolve,12));
      }
    }
    await pool.query('DELETE FROM blofy_xtream_servers WHERE id=$1 AND deletion_requested_at IS NOT NULL', [id]);
    console.info('Xtream source cleanup completed:',id);
  } catch (error) {
    // deletion_requested_at remains persisted, so startup/periodic retries
    // safely resume rather than exposing a partially removed source.
    console.warn('Xtream source cleanup will retry:', id, redactXtreamError(error));
  } finally {
    purgeRunning.delete(id);
    if (!syncLocks.has(id)) cancelledSources.delete(id);
  }
}

async function resumePendingPurges() {
  const pending = await pool.query('SELECT id FROM blofy_xtream_servers WHERE deletion_requested_at IS NOT NULL LIMIT 20');
  for (const row of pending.rows) void purgeSource(row.id);
}

async function requestDeleteSource(id) {
  await ensureReady();
  // Cancel future import batches before competing for the record lock.
  cancelledSources.add(id);
  syncQueue.cancel(id);
  const result = await sourceMutation(`UPDATE blofy_xtream_servers
    SET enabled=FALSE,publish_catalog=FALSE,status='offline',
        deletion_requested_at=COALESCE(deletion_requested_at,NOW()),updated_at=NOW()
    WHERE id=$1 RETURNING id`,[id]);
  if (!result.rows.length) return false;
  cancelledSources.add(id);
  void purgeSource(id);
  return true;
}

async function checkedFetch(url, { timeoutMs = 30000,sourceId=null } = {}) {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    try {
      await assertPublicXtreamUrl(`${current.protocol}//${current.host}`);
    } catch (error) {
      const category=safeXtreamTransportCategory(error);
      if(category)throw new Error(category);
      throw error; // Invalid or private host rejection stays explicit.
    }
    let response;
    try {
      response = shouldUseIndependentXtreamSource(sourceId)
        ? await fetchIndependentXtreamSource(current,{timeoutMs})
        : await fetch(current, {
            method: 'GET',redirect: 'manual',
            headers: {accept:'application/json,text/plain;q=0.8,*/*;q=0.1',
              'user-agent':'BLOFY-Xtream/1.0'},
            signal: AbortSignal.timeout(timeoutMs)
          });
    } catch (error) {
      // Source-specific network failure, not a failed BLOFY account login.
      // Keep source host, credentials and provider internals out of API errors.
      throw new Error(safeXtreamTransportCategory(error)||'xtream_transport_unreachable');
    }
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(()=>{});
      if (!location || redirects === 3) throw new Error('xtream_redirect_invalid');
      current = new URL(location, current);
      if (!['http:', 'https:'].includes(current.protocol)) throw new Error('xtream_redirect_invalid');
      continue;
    }
    if (!response.ok) {
      // Unread rejected API bodies retain upstream sockets; always release
      // them before handling the provider status or falling back to M3U.
      const status=response.status;
      await response.body?.cancel().catch(()=>{});
      throw new Error(`xtream_http_${status}`);
    }
    return response;
  }
  throw new Error('xtream_redirect_loop');
}

// Real series diagnostics: first confirm the selected source serves
// get_series_info, then (for episode mode) read the first bytes of an actual
// /series/<account>/<episode-id> media file. Never return source credentials.
async function probeXtreamEpisodeMedia(source,creds,episode) {
  const started=Date.now(),controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9500);
  const path=['series',creds.username,creds.password,String(episode.id)]
    .map(encodeURIComponent).join('/')+'.'+episode.extension;
  let target=new URL(path,normalizeXtreamBaseUrl(source.base_url)+'/');
  let usingIndependentRelay=false;
  // The original PLAYER egress is known to reset this provider's media.
  // Only selected source uses the verified independent STREAM proxy.
  if(shouldUseIndependentXtreamSource(source.id)){
    try{
      target=new URL(await issueStreamRelayGrant({
        sourceUrl:target.href,kind:'series'
      }));
      usingIndependentRelay=true;
    }catch{}
  }
  let httpStatus=null,contentType='',errorCode=null,reader=null,response=null,providerHint=null;
  let useFirstByteRange=true;
  try{
    for(let hop=0;hop<=3;hop++){
      await assertPublicXtreamUrl(target.origin);
      response=await fetch(target,{
        method:'GET',redirect:'manual',signal:controller.signal,
        headers:{
          'user-agent':'BLOFY-Media-Probe/1.0',
          ...(useFirstByteRange?{range:'bytes=0-1023'}:{}),
          accept:'*/*'
        }
      });
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('location');
        await response.body?.cancel().catch(()=>{});
        if(!location||hop===3)throw new Error('redirect_invalid');
        target=new URL(location,target);
        if(!['http:','https:'].includes(target.protocol))throw new Error('redirect_invalid');
        continue;
      }
      if(shouldRetryXtreamWithoutRange({status:response.status,
        range:useFirstByteRange?'bytes=0-1023':'',alreadyRetried:!useFirstByteRange}) && hop<3){
        await response.body?.cancel().catch(()=>{});
        useFirstByteRange=false;
        continue;
      }
      httpStatus=response.status;
      contentType=String(response.headers.get('content-type')||'').slice(0,100);
      if((httpStatus===200||httpStatus===206)&&response.body){
        reader=response.body.getReader();
        const first=await reader.read();
        if(first.done||!first.value?.byteLength)errorCode='empty_media';
        else {
          const inspection=inspectXtreamMediaChunk(first.value,contentType);
          if(!inspection.valid)errorCode=inspection.reason;
        }
      }else if(usingIndependentRelay&&response.status===502){
        errorCode=await readSanitizedXtreamRelayFailure(response);
      }else providerHint=await readXtreamProviderDenialHint(response);
      break;
    }
  }catch(error){
    errorCode=controller.signal.aborted?'timeout':
      ['redirect_invalid','xtream_private_host_blocked','xtream_host_unresolved'].includes(String(error?.message||''))
        ?String(error.message):(safeXtreamTransportCategory(error)||'upstream_unreachable');
  }finally{
    clearTimeout(timeout);
    controller.abort();
    if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
  }
  const ok=(httpStatus===200||httpStatus===206)
    && !errorCode && !/text\/html|application\/json|text\/xml/i.test(contentType);
  return{ok,httpStatus,contentType,providerHint,latencyMs:Date.now()-started,error:errorCode,
    rangeFallbackUsed:!useFirstByteRange};
}

async function probeXtreamSeries(id,mediaType){
  const source=await serverById(id);
  if(!source)throw Object.assign(new Error('xtream_server_not_found'),{status:404});
  if(!source.enabled)throw Object.assign(new Error('xtream_source_paused'),{status:409});
  // An episode probe needs only one series to bound upstream request time.
  const candidates=(await pool.query(`SELECT source_id,name
    FROM blofy_xtream_items
    WHERE server_id=$1 AND media_type='series' AND enabled=TRUE
    ORDER BY name ASC LIMIT $2`,[id,2])).rows;
  if(!candidates.length)return{ok:false,mediaType,reason:'no_imported_items',checks:[]};
  const creds=decryptCredentials(source),checks=[];
  for(const series of candidates){
    const started=Date.now();
    let httpStatus=null,errorCode=null,details=null;
    try{
      const response=await checkedFetch(xtreamApiUrl(
        source.base_url,creds.username,creds.password,'get_series_info',
        {series_id:String(series.source_id)}
      ),{timeoutMs:9500,sourceId:source.id});
      httpStatus=response.status;
      const chunks=[];
      let bytes=0;
      if(!response.body)throw new Error('no_episode_info');
      for await(const part of response.body){
        bytes+=part.byteLength;
        if(bytes>1_500_000)throw new Error('series_response_too_large');
        chunks.push(Buffer.from(part));
      }
      let payload;
      try{payload=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
      catch{throw new Error('series_response_invalid')}
      if(!payload?.episodes)throw new Error('no_episode_info');
      details=xtreamEpisodeSamples(payload,2);
      if(!details.episodeCount)throw new Error('no_playable_episodes');
      if(mediaType==='episode'){
        // Try different seasons/positions, not merely the first episode.
        // A 404 for one stale episode must not condemn the entire source.
        for(const episode of xtreamEpisodePlaybackCandidates(payload,3,{withPositions:true})){
          const playback=await probeXtreamEpisodeMedia(source,creds,episode);
          const position=' · '+(episode.seasonNumber===null?'موسم غير مرقم':'موسم '+episode.seasonNumber)+
            ' · حلقة '+episode.episodeNumber;
          checks.push({
            // Display episode position, never the provider's stream ID or URL.
            title:cleanText(series.name,120)+position,mediaType,
            seriesHttpStatus:httpStatus,seasonCount:details.seasonCount,
            episodeCount:details.episodeCount,
            directSourceAdvertised:episode.directSourceAdvertised===true,
            ...playback
          });
          // Provider-level access restrictions should never be bypassed by
          // probing different IDs, filenames, headers or extra accounts.
          if(playback.ok||[401,403,456].includes(playback.httpStatus))break;
        }
      }else{
        checks.push({
          title:cleanText(series.name,150),mediaType,httpStatus,
          latencyMs:Date.now()-started,ok:true,error:null,
          seasonCount:details.seasonCount,episodeCount:details.episodeCount
        });
      }
    }catch(error){
      const code=String(error?.message||'');
      const match=code.match(/^xtream_http_([0-9]{3})$/);
      if(match)httpStatus=Number(match[1]);
      const safeErrors=new Set(['no_episode_info','no_playable_episodes','series_response_invalid','series_response_too_large']);
      errorCode=safeErrors.has(code)?code:
        /(?:abort|timeout)/i.test(code)?'timeout':
        match?code:'upstream_unreachable';
      checks.push({
        title:cleanText(series.name,150),mediaType,httpStatus,
        latencyMs:Date.now()-started,ok:false,error:errorCode
      });
    }
    if(checks.at(-1)?.ok||[401,403,456].includes(checks.at(-1)?.httpStatus))break;
  }
  return{ok:checks.some(check=>check.ok),mediaType,checks,
    note:'مسلسلات: فحص API والحلقات. الحلقات: قراءة أول بايتات الفيديو فقط؛ لا يثبت استمرار الصوت والصورة.'};
}

// Keep source login/metadata health distinct from tested video availability.
// A provider's HTTP 456 does not mean the Xtream API has gone offline.
async function persistSourceMediaProbe(id,kind,result){
  const probe=summarizeSourceMediaProbe(kind,result);
  try{
    await pool.query(`UPDATE blofy_xtream_servers
      SET media_probe_state=COALESCE(media_probe_state,'{}'::jsonb) ||
        jsonb_build_object($2::text,$3::jsonb)
      WHERE id=$1 AND deletion_requested_at IS NULL`,[id,kind,JSON.stringify(probe)]);
  }catch(error){
    // Never fail a read-only operator diagnosis because the status history
    // could not be persisted. Do not log source URL, secrets or stream IDs.
    console.warn('xtream source diagnostic persistence failed:',String(error?.code||'unknown').slice(0,20));
  }
}

// Short, explicit playback probe: checks the actual upstream media endpoint,
// not just player_api.php authentication. Credentials and source URLs never
// appear in the response; the request is initiated by the administrator only.
async function probeXtreamPlayback(id,mediaType='live',{forcePortalDirect=false}={}) {
  if(mediaType==='series'||mediaType==='episode')return probeXtreamSeries(id,mediaType);
  if(!['live','movie'].includes(mediaType))
    throw Object.assign(new Error('xtream_probe_type_invalid'),{status:400});
  const source=await serverById(id);
  if(!source)throw Object.assign(new Error('xtream_server_not_found'),{status:404});
  if(!source.enabled)throw Object.assign(new Error('xtream_source_paused'),{status:409});
  const candidates=(await pool.query(`SELECT source_id,name,container_extension,
      metadata->>'directSourcePresent' AS advertised_direct_source
    FROM blofy_xtream_items
    WHERE server_id=$1 AND media_type=$2 AND enabled=TRUE
    ORDER BY name ASC LIMIT 4`,[id,mediaType])).rows;
  if(!candidates.length)return {ok:false,mediaType,reason:'no_imported_items',checks:[]};
  const creds=decryptCredentials(source),checks=[];
  const livePolicy=mediaType==='live'?xtreamAllowedLiveFormats(source.account_info):null;
  if(livePolicy&&!livePolicy.formats.length)return{
    ok:false,mediaType,reason:'output_format_not_allowed',checks:[],
    note:outputFormatDescription(livePolicy)
  };
  // TS and M3U8 are tested only when explicitly declared by the source.
  // Keep the entire live comparison below the 14.5s browser timeout.
  const liveDeadline=Date.now()+11500;
  outer:for(const item of candidates){
    const importedExt=String(item.container_extension||'mp4').replace(/^\./,'').toLowerCase();
    for(const ext of (livePolicy?livePolicy.formats:[importedExt])){
    if(livePolicy&&Date.now()>liveDeadline-1200)break outer;
    if(!/^[a-z0-9]{1,8}$/.test(ext)||!item.source_id)continue;
    const path=[mediaType==='movie'?'movie':'live',creds.username,creds.password,String(item.source_id)]
      .map(encodeURIComponent).join('/')+'.'+ext;
    let target=new URL(path,normalizeXtreamBaseUrl(source.base_url)+'/');
    let usingIndependentRelay=false;
    // Admin playback checks must use the SAME egress that serves selected
    // client TS streams; otherwise the old portal falsely reports resets.
    if(!forcePortalDirect&&(shouldUseIndependentSourceMedia({
      sourceId:source.id,kind:mediaType,extension:ext
    })||(mediaType==='movie'&&shouldUseIndependentXtreamSource(source.id)))){
      try{
        target=new URL(await issueStreamRelayGrant({
          sourceUrl:target.href,kind:mediaType
        }));
        usingIndependentRelay=true;
      }catch{}
    }
    const started=Date.now(),controller=new AbortController();
    // Live playback can legitimately take >4.5s to return its first media
    // bytes; use a bounded longer probe without extending the global
    // 11.5s browser budget or changing the customer playback timeout.
    const timeout=setTimeout(()=>controller.abort(),livePolicy?
      liveDiagnosticTimeoutMs(liveDeadline-Date.now()):9500);
    let httpStatus=null,contentType='',errorCode=null,providerHint=null;
    let useFirstByteRange=mediaType==='movie';
    try{
      for(let hop=0;hop<=3;hop++){
        await assertPublicXtreamUrl(target.origin);
        const response=await fetch(target,{
          method:'GET',redirect:'manual',signal:controller.signal,
          headers:{
            'user-agent':'BLOFY-Media-Probe/1.0',
            ...(useFirstByteRange?{range:'bytes=0-1023'}:{})
          }
        });
        if([301,302,303,307,308].includes(response.status)){
          const redirect=response.headers.get('location');
          await response.body?.cancel().catch(()=>{});
          if(!redirect||hop===3)throw new Error('redirect_invalid');
          target=new URL(redirect,target);
          if(!['http:','https:'].includes(target.protocol))throw new Error('redirect_invalid');
          continue;
        }
        if(shouldRetryXtreamWithoutRange({status:response.status,
          range:useFirstByteRange?'bytes=0-1023':'',alreadyRetried:!useFirstByteRange}) && hop<3){
          await response.body?.cancel().catch(()=>{});
          useFirstByteRange=false;
          continue;
        }
        httpStatus=response.status;
        contentType=String(response.headers.get('content-type')||'').slice(0,100);
        if((httpStatus===200||httpStatus===206) && response.body){
          const reader=response.body.getReader();
          try{
            const first=await reader.read();
            if(first.done||!first.value?.byteLength)errorCode='empty_media';
            else {
              const inspection=inspectXtreamMediaChunk(first.value,contentType);
              if(!inspection.valid)errorCode=inspection.reason;
            }
          }finally{
            try{await reader.cancel()}catch{}
            try{reader.releaseLock()}catch{}
          }
        }else if(usingIndependentRelay&&response.status===502){
          // Only inspect the fixed sanitized response from our own relay.
          // Preserve HTTP 502 while identifying a confirmed provider 404.
          errorCode=await readSanitizedXtreamRelayFailure(response);
        }else providerHint=await readXtreamProviderDenialHint(response);
        break;
      }
    }catch(error){
      errorCode=controller.signal.aborted?'timeout':
      ['redirect_invalid','xtream_private_host_blocked','xtream_host_unresolved'].includes(String(error?.message||''))
        ?String(error.message):(safeXtreamTransportCategory(error)||'upstream_unreachable');
    }finally{clearTimeout(timeout);}
    const ok=(httpStatus===200||httpStatus===206)
      && !errorCode && !/text\/html|application\/json|text\/xml/i.test(contentType);
    checks.push({
      title:cleanText(item.name,160),mediaType,httpStatus,contentType,
      ...(livePolicy?{outputFormat:ext}:{}),
      latencyMs:Date.now()-started,ok,error:errorCode,providerHint,
      directSourceAdvertised:item.advertised_direct_source==='true',
      rangeFallbackUsed:mediaType==='movie'&&!useFirstByteRange
    });
    // Respect access denials. A 456 is never treated as permission to try
    // other endpoints, identities or formats after an upstream rejection.
    if(shouldStopXtreamFormatComparison(httpStatus))break outer;
    // Once a provider-advertised format delivers actual media bytes, stop.
    // Testing HLS after valid TS previously caused a false partial failure
    // when this particular provider resets HLS despite serving TS correctly.
    // Continue to the next declared format only if the current one failed.
    if(ok)break outer;
    }
    // Compare each advertised output format for one item before moving on;
    // stop as soon as any of this item's declared formats serves media.
    if(checks.some(check=>check.ok))break;
  }
  return {ok:checks.some(check=>check.ok),mediaType,checks,
    note:(livePolicy?outputFormatDescription(livePolicy)+' HLS: وصول القائمة لا يؤكد عمل مقاطع الفيديو. ':'')+
      'فحص استجابة HTTP للبث فقط. التأكد من عرض الصورة والصوت يحتاج تشغيلًا فعليًا بالمشغل.'};
}

async function fetchAccount(row,{timeoutMs=20000,maxAttempts=2}={}) {
  const creds = decryptCredentials(row);
  await assertPublicXtreamUrl(row.base_url);
  const response = await withXtreamAccountReconnect(
    ()=>checkedFetch(xtreamApiUrl(row.base_url,creds.username,creds.password),{timeoutMs,sourceId:row.id}),
    {describe:redactXtreamError,maxAttempts}
  );
  const text = await response.text();
  if (Buffer.byteLength(text) > 1_000_000) throw new Error('xtream_account_response_too_large');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('xtream_account_response_invalid'); }
  const info = sanitizeXtreamAccount(payload);
  if (!info.authenticated) throw Object.assign(new Error('xtream_auth_failed'), { status: 401 });
  return info;
}

const smartConnectionCooldowns=new Map();
const smartConnectionResults=new Map(); // diagnostic text only, expires after ten minutes
async function runSmartConnection(id){
  const row=await serverById(id);
  if(!row)throw Object.assign(new Error('xtream_server_not_found'),{status:404});
  if(!row.enabled)throw Object.assign(new Error('xtream_source_paused'),{status:409});
  // An administrator cannot use the endpoint to continuously poll an upstream.
  const now=Date.now();
  const old=smartConnectionCooldowns.get(id)||0;
  if(now-old<30_000)return {
    ...xtreamConnectionReport({errorCode:'xtream_connection_unknown',checkedAt:now}),
    rateLimited:true,
    title:'تم الفحص مؤخرًا',
    nextStep:'انتظر 30 ثانية قبل إعادة الفحص حتى لا تضغط على المصدر.'
  };
  smartConnectionCooldowns.set(id,now);
  if(smartConnectionCooldowns.size>512){
    for(const [key,time] of smartConnectionCooldowns){
      if(now-time>120_000)smartConnectionCooldowns.delete(key);
    }
  }
  try {
    // One bounded GET (8 seconds) using the credentials already stored on
    // this authenticated source. No catalog sync, no media downloads and no
    // source/subscriber DB mutations.
    await fetchAccount(row,{timeoutMs:8000,maxAttempts:1});
    return xtreamConnectionReport({ok:true,checkedAt:Date.now()});
  }catch(error){
    return xtreamConnectionReport({errorCode:redactXtreamError(error),checkedAt:Date.now()});
  }
}

// Read-only parity check from the original PLAYER egress for the SAME
// alphabetically first movie IDs checked over isolated STREAM earlier.
if(process.env.BLOFY_XTREAM_DIRECT_MEDIA_PROBE_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
   if(!validUuid(id))return;
   const result=await probeXtreamPlayback(id,'movie',{forcePortalDirect:true});
   console.info('BLOFY_XTREAM_DIRECT_MEDIA_PROOF',JSON.stringify({
    sourceId:id,ok:result.ok===true,
    checks:(result.checks||[]).slice(0,4).map(row=>({
      status:Number.isInteger(row.httpStatus)?row.httpStatus:null,
      ok:row.ok===true,
      error:['timeout','upstream_unreachable','empty_media',
        'upstream_non_media_response','xtream_transport_connection_reset',
        'xtream_host_unresolved','xtream_private_host_blocked',
        'redirect_invalid'].includes(row.error)?row.error:row.error?'other':null,
      rangeFallbackUsed:row.rangeFallbackUsed===true
    })),
    catalogMutation:false,customerCutover:false,
    mediaPlayed:false,credentialsLogged:false
   }));
  })().catch(()=>{
   console.warn('BLOFY_XTREAM_DIRECT_MEDIA_PROOF',JSON.stringify({
    ok:false,code:'direct_probe_unavailable',
    catalogMutation:false,credentialsLogged:false
   }));
  });
 },25000);
 timer.unref?.();
}

// One-shot official M3U API availability check, using existing encrypted
// source credentials. No indexing, playback or source DB updates.
if(process.env.BLOFY_XTREAM_M3U_ONE_SHOT==='1'){
  const timer=setTimeout(()=>{
    void(async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!/^[0-9a-f-]{36}$/i.test(id))return;
      const row=(await serverRows()).find(item=>item.id===id&&item.enabled===true);
      if(!row)return;
      const creds=decryptCredentials(row);
      const result=await probeXtreamM3uAvailability({
        baseUrl:row.base_url,username:creds.username,password:creds.password
      });
      console.info('BLOFY_XTREAM_M3U_AVAILABILITY',JSON.stringify({
        sourceId:row.id,...result,
        catalogImported:false,mediaPlayed:false,credentialsLogged:false
      }));
    })().catch(()=>console.warn('BLOFY_XTREAM_M3U_AVAILABILITY_FAILED','unavailable'));
  },16000);
  timer.unref?.();
}

// Operator-only media-client compatibility check. Revisit the SAME first
// three sorted movie IDs that produce mixed 206/404 in the admin probe.
// No catalog edits, no alternative stream IDs, no customer routing changes.
if(process.env.BLOFY_XTREAM_MEDIA_CLIENT_PROFILES_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
   if(!validUuid(id)||!shouldUseIndependentXtreamSource(id))return;
   await ensureReady();
   const source=await serverById(id);
   if(!source?.enabled)return;
   const items=(await pool.query(
    "SELECT source_id,container_extension FROM blofy_xtream_items "+
    "WHERE server_id=$1 AND media_type='movie' AND enabled=TRUE "+
    "ORDER BY name ASC LIMIT 3",[id])).rows;
   const creds=decryptCredentials(source),samples=[];
   for(const item of items){
    const ext=String(item.container_extension||'').toLowerCase().replace(/^\./,'');
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(item.source_id||''))||
       !/^(mp4|mkv|avi|mov|webm|ts)$/.test(ext))continue;
    const path=['movie',creds.username,creds.password,String(item.source_id)]
      .map(encodeURIComponent).join('/')+'.'+ext;
    const target=new URL(path,normalizeXtreamBaseUrl(source.base_url)+'/');
    samples.push({kind:'movie',sourceUrl:target.href});
   }
   if(!samples.length)return;
   const result=await probeIndependentXtreamClientProfiles(samples);
   console.info('BLOFY_XTREAM_MEDIA_CLIENT_PROFILE_PROOF',JSON.stringify({
    sourceId:id,...result,customerCutover:false,
    catalogMutation:false,sourceCredentialsLogged:false
   }));
  })().catch(()=>{
   console.warn('BLOFY_XTREAM_MEDIA_CLIENT_PROFILE_PROOF',JSON.stringify({
    ok:false,code:'profile_diagnostic_unavailable',
    catalogMutation:false,sourceCredentialsLogged:false
   }));
  });
 },25000);
 timer.unref?.();
}

// Operator-only, one-shot provider metadata comparison of the two imported
// movie IDs that consistently return 404 through all media client profiles.
// The official action is now accepted by the isolated source-pinned relay.
// No signed source URL, secrets, movie names/IDs or raw response are logged.
if(process.env.BLOFY_XTREAM_VOD_INFO_SAME_ID_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
   if(!validUuid(id)||!shouldUseIndependentXtreamSource(id))return;
   const source=await serverById(id);
   if(!source?.enabled)return;
   const creds=decryptCredentials(source);
   const items=(await pool.query(
    "SELECT source_id,container_extension FROM blofy_xtream_items "+
    "WHERE server_id=$1 AND media_type='movie' AND enabled=TRUE "+
    "ORDER BY name ASC LIMIT 2",[id])).rows;
   const checks=[];
   for(const item of items){
    const url=xtreamApiUrl(source.base_url,creds.username,creds.password,
      'get_vod_info',{vod_id:String(item.source_id)});
    let response,bytes=0,buffer=[];
    let result={ok:false,code:'vod_info_unavailable'};
    try{
     response=await fetchIndependentXtreamSource(url.href,{timeoutMs:7500});
     if(response.status===200&&response.body){
      const reader=response.body.getReader();
      try{
       for(;;){
        const chunk=await reader.read();
        if(chunk.done)break;
        bytes+=chunk.value?.byteLength||0;
        if(bytes>131072)throw Error('too_large');
        buffer.push(Buffer.from(chunk.value));
       }
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      const data=JSON.parse(Buffer.concat(buffer).toString('utf8'));
      result=inspectSameXtreamVodInfo(data,item.source_id,item.container_extension);
     }
    }catch{}finally{await response?.body?.cancel().catch(()=>{});}
    checks.push({index:checks.length+1,...result});
   }
   console.info('BLOFY_XTREAM_VOD_INFO_SAME_ID_PROOF',JSON.stringify({
    sourceId:id,checks,mediaRequests:0,customerCutover:false,
    catalogMutation:false,credentialsLogged:false
   }));
  })().catch(()=>console.warn('BLOFY_XTREAM_VOD_INFO_SAME_ID_PROOF',
   JSON.stringify({ok:false,code:'probe_unavailable',
    mediaRequests:0,catalogMutation:false,credentialsLogged:false})));
 },24000);
 timer.unref?.();
}

// Full local audit scans every imported item and stored episode mapping,
// without contacting any media provider or changing any source/subscriber.
if(process.env.BLOFY_XTREAM_FULL_CATALOG_AUDIT_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
   if(!validUuid(id))return;
   await ensureReady();
   const source=await serverById(id);
   if(!source?.enabled)return;
   const report=await auditEntireXtreamStoredCatalog(pool,id);
   console.info('BLOFY_XTREAM_FULL_CATALOG_AUDIT',JSON.stringify({
    sourceId:id,...report,mediaRequests:0,sourceMutation:false,
    customerCutover:false,credentialsLogged:false
   }));
  })().catch(()=>{
   console.warn('BLOFY_XTREAM_FULL_CATALOG_AUDIT',JSON.stringify({
    ok:false,code:'read_only_audit_unavailable',mediaRequests:0,
    sourceMutation:false,credentialsLogged:false
   }));
  });
 },25000);
 timer.unref?.();
}

// One-shot read-only dry run of the ACTUAL M3U importer, not a database
// synchronization. Source 2's original 80+ MiB playlist must be parsed
// safely through the approved STREAM relay when direct transport resets.
// Never write catalog rows, clear existing items or expose source secrets.
if(process.env.BLOFY_XTREAM_M3U_IMPORT_DRY_RUN_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
   if(!validUuid(id)||!shouldUseIndependentXtreamSource(id))return;
   await ensureReady();
   const source=await serverById(id);
   if(!source?.enabled)return;
   const creds=decryptCredentials(source);
   const catalog=await downloadXtreamM3uCatalog({
    baseUrl:source.base_url,username:creds.username,password:creds.password
   },{
    independentImpl:manifest=>fetchIndependentXtreamManifest(manifest.href)
   });
   const live=catalog.records.live||[],movie=catalog.records.movie||[];
   console.info('BLOFY_XTREAM_M3U_IMPORT_DRY_RUN',JSON.stringify({
    sourceId:id,ok:true,readOnly:true,
    rawLiveRecords:live.length,rawMovieRecords:movie.length,
    uniqueLiveIds:new Set(live.map(x=>x.sourceId)).size,
    uniqueMovieIds:new Set(movie.map(x=>x.sourceId)).size,
    categoryCounts:{live:catalog.categories.live.length,
      movie:catalog.categories.movie.length},
    sourceMutation:false,customerCutover:false,credentialsLogged:false
   }));
  })().catch(error=>{
   const code=String(error?.message||'');
   const allowed=new Set(['xtream_m3u_timeout','xtream_m3u_unavailable',
    'xtream_m3u_too_large','xtream_m3u_retained_too_large',
    'xtream_m3u_invalid_header','xtream_m3u_line_too_large']);
   console.warn('BLOFY_XTREAM_M3U_IMPORT_DRY_RUN',JSON.stringify({
    ok:false,code:allowed.has(code)?code:'dry_run_unavailable',
    sourceMutation:false,customerCutover:false,credentialsLogged:false
   }));
  });
 },36000);
 timer.unref?.();
}

// An operator may reconcile the entire stored movie/live ID set with one
// official provider M3U download. Never probe every media URL or re-import.
if(process.env.BLOFY_XTREAM_M3U_FULL_ID_COMPARE_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
   if(!validUuid(id))return;
   await ensureReady();
   const source=await serverById(id);
   if(!source?.enabled)return;
   const creds=decryptCredentials(source);
   const sameMovieSamples=(await pool.query(
     "SELECT source_id,container_extension FROM blofy_xtream_items "+
     "WHERE server_id=$1 AND media_type='movie' AND enabled=TRUE "+
     "ORDER BY name ASC LIMIT 3",[id])).rows;
   // Audit the exact episode IDs from the same first two imported series
   // used by the existing playback diagnostic. This is API metadata only:
   // no per-episode media requests, DB mutations or customer routing changes.
   const sameEpisodeSamples=[];
   if(shouldUseIndependentXtreamSource(id)){
    const seriesRows=(await pool.query(
     "SELECT source_id FROM blofy_xtream_items "+
     "WHERE server_id=$1 AND media_type='series' AND enabled=TRUE "+
     "ORDER BY name ASC LIMIT 2",[id])).rows;
    for(const series of seriesRows){
     if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(series.source_id||'')))continue;
     let response,reader;
     try{
      const apiUrl=xtreamApiUrl(source.base_url,creds.username,creds.password,
       'get_series_info',{series_id:String(series.source_id)});
      response=await fetchIndependentXtreamSource(apiUrl.href,{timeoutMs:10000});
      if(response.status!==200||!response.body)continue;
      reader=response.body.getReader();
      let size=0,tooLarge=false,parts=[];
      for(;;){
       const item=await reader.read();
       if(item.done)break;
       size+=item.value?.byteLength||0;
       if(size>1500000){tooLarge=true;break;}
       parts.push(Buffer.from(item.value));
      }
      if(tooLarge)continue;
      const payload=JSON.parse(Buffer.concat(parts).toString('utf8'));
      for(const episode of xtreamEpisodePlaybackCandidates(payload,3)){
       if(sameEpisodeSamples.length>=6)break;
       sameEpisodeSamples.push({id:episode.id,extension:episode.extension});
      }
     }catch{
      // An unavailable series API must never block the movie/live audit.
     }finally{
      if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
      else{try{await response?.body?.cancel()}catch{}}
     }
    }
   }
   const report=await reconcileXtreamM3uWithImportedCatalog({
    pool,sourceId:id,baseUrl:source.base_url,
    username:creds.username,password:creds.password
   },{
    // Same imported movie IDs, read-only, no per-media request.
    sameMovieSamples,sameEpisodeSamples,
    // Source-specific protected egress; never used for a different Xtream
    // source or any customer playback route.
    independentImpl:shouldUseIndependentXtreamSource(id)?
      manifest=>fetchIndependentXtreamManifest(manifest.href):null
   });
   console.info('BLOFY_XTREAM_M3U_FULL_ID_COMPARE',JSON.stringify({
    sourceId:id,...report,sourceMutation:false,customerCutover:false,
    credentialsLogged:false
   }));
  })().catch(()=>{
   console.warn('BLOFY_XTREAM_M3U_FULL_ID_COMPARE',JSON.stringify({
    ok:false,code:'reconciliation_unavailable',sourceMutation:false,
    mediaRequests:0,credentialsLogged:false
   }));
  });
 },30000);
 timer.unref?.();
}

// One-shot, read-only comparison with player_api.php server_info. Clients
// often use the advertised media host/port, whereas the BLOFY gateway uses
// the saved API base URL for both login and playback. This probe never logs
// either host, credentials, response bodies or raw source URLs.
if(process.env.BLOFY_XTREAM_ADVERTISED_ORIGIN_PROBE_ON_BOOT==='1'){
  const t=setTimeout(()=>{
    void(async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!validUuid(id))return;
      const row=await serverById(id);
      if(!row?.enabled)return;
      const creds=decryptCredentials(row);
      const response=await checkedFetch(
        xtreamApiUrl(row.base_url,creds.username,creds.password),
        {timeoutMs:7500,sourceId:id}
      );
      if(response.status!==200||!response.body){
        await response.body?.cancel().catch(()=>{});
        console.info('BLOFY_XTREAM_ADVERTISED_ORIGIN_PROOF',JSON.stringify({
          sourceId:id,ok:false,code:'api_unavailable',
          customerCutover:false,credentialsLogged:false}));
        return;
      }
      const reader=response.body.getReader(),parts=[];
      let size=0;
      try{
        for(;;){
          const part=await reader.read();
          if(part.done)break;
          size+=part.value?.byteLength||0;
          if(size>128000)throw Error('oversized');
          parts.push(Buffer.from(part.value));
        }
      }finally{
        try{await reader.cancel()}catch{}
        try{reader.releaseLock()}catch{}
      }
      const doc=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(![1,'1',true].includes(doc?.user_info?.auth))throw Error('auth');
      const result=compareXtreamAdvertisedOrigin(row.base_url,doc?.server_info);
      console.info('BLOFY_XTREAM_ADVERTISED_ORIGIN_PROOF',JSON.stringify({
        sourceId:id,...result,customerCutover:false,
        credentialsLogged:false,sourceMutation:false}));
    })().catch(()=>{
      console.warn('BLOFY_XTREAM_ADVERTISED_ORIGIN_PROOF',
        JSON.stringify({ok:false,code:'probe_unavailable',
          customerCutover:false,credentialsLogged:false}));
    });
  },18000);
  t.unref?.();
}

// One-time transport compatibility experiment for a single saved source.
// This does NOT modify the production request handler, and must not be used to
// ignore HTTP 401/403/456 or to impersonate a permitted client identity.
if(process.env.BLOFY_XTREAM_HTTP11_ONE_SHOT==='1'){
  const timer=setTimeout(()=>{
    void(async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!/^[0-9a-f-]{36}$/i.test(id))return;
      const row=(await serverRows()).find(item=>item.id===id&&item.enabled===true);
      if(!row)return;
      const creds=decryptCredentials(row);
      const result=await probeXtreamHttp11(xtreamApiUrl(row.base_url,creds.username,creds.password));
      console.info('BLOFY_XTREAM_HTTP11_COMPARISON',JSON.stringify({
        sourceId:row.id,...result,contentDownloaded:false,mediaTested:false
      }));
    })().catch(()=>console.warn('BLOFY_XTREAM_HTTP11_COMPARISON_FAILED','unavailable'));
  },16000);
  timer.unref?.();
}

// One-time, admin-authorized network diagnosis. This runs from the SAME
// production portal process: no Railway Function with its own egress IP.
// Never changes source settings, subscriber data or published streaming URLs.
if(process.env.BLOFY_XTREAM_EGRESS_ONE_SHOT==='1'){
  const timer=setTimeout(()=>{
    void(async()=>{
      const egress=await observeRailwayEgress();
      console.info('BLOFY_EGRESS_IP_CHECK',JSON.stringify(egress));
      const selectedId=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(selectedId)){
        console.info('BLOFY_EGRESS_SOURCE_CHECK',JSON.stringify({status:'not_selected'}));
        return;
      }
      const row=(await serverRows()).find(item=>item.id===selectedId&&item.enabled===true);
      if(!row){
        console.info('BLOFY_EGRESS_SOURCE_CHECK',JSON.stringify({status:'not_found_or_disabled'}));
        return;
      }
      const transport=await probeXtreamSocket(row.base_url);
      let accountCode='xtream_api_reachable';
      try{await fetchAccount(row,{timeoutMs:8000,maxAttempts:1});}
      catch(error){accountCode=xtreamConnectionReport({errorCode:redactXtreamError(error)}).code;}
      console.info('BLOFY_EGRESS_SOURCE_CHECK',JSON.stringify({
        sourceId:row.id,transport,accountCode,
        mediaChecked:false,credentialsLogged:false
      }));
    })().catch(()=>console.warn('BLOFY_EGRESS_DIAG_FAILED','unavailable'));
  },14000);
  timer.unref?.();
}

// One-shot, explicitly gated production-to-production account metadata test.
// Reads existing encrypted source credentials in-memory and sends exactly one
// bounded request over pinned authenticated HTTPS to independent STREAM.
// Does not start catalog sync, media streaming or modify any source status.
if(process.env.BLOFY_XTREAM_INDEPENDENT_CATALOG_PROBE_ON_BOOT==='1'){
  const testTimer=setTimeout(()=>{
    void (async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!validUuid(id))return;
      const row=await serverById(id);
      if(!row||!row.enabled)return;
      const creds=decryptCredentials(row);
      const accountUrl=xtreamApiUrl(row.base_url,creds.username,creds.password,'get_live_categories');
      // This probe intentionally bypasses the client-routing feature flag;
      // all production account and sync traffic remains on its current path.
      const response=await fetchIndependentXtreamSource(accountUrl.href,{timeoutMs:16000});
      const status=response.status,reader=response.body?.getReader();
      let chunks=[],bytes=0,complete=false;
      try{
        if(reader){
          while(true){
            const n=await reader.read();
            if(n.done){complete=true;break;}
            const part=Buffer.from(n.value||[]);
            bytes+=part.length;
            if(bytes>2_000_000)break;
            chunks.push(part);
          }
        }
        let arr=null;
        if(complete&&status===200){
          try{const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if(Array.isArray(parsed))arr=parsed.length;
          }catch{}
        }
        console.info('BLOFY_XTREAM_INDEPENDENT_CATALOG_PROOF',JSON.stringify({
          sourceId:id,httpStatus:status,categoryCount:arr,
          ok:status===200&&arr!==null,
          indexed:false,customerCutover:false,credentialsLogged:false
        }));
      }finally{if(reader){
        if(!complete)await reader.cancel().catch(()=>{});
        reader.releaseLock();
      }}
    })().catch(()=>{
      console.warn('BLOFY_XTREAM_INDEPENDENT_CATALOG_PROOF',
        JSON.stringify({ok:false,code:'probe_unavailable',customerCutover:false}));
    });
  },19000);
  testTimer.unref?.();
}

if(process.env.BLOFY_XTREAM_INDEPENDENT_PROBE_ON_BOOT==='1'){
  const probeTimer=setTimeout(()=>{
    void (async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!validUuid(id))return;
      const row=await serverById(id);
      if(!row||!row.enabled)return;
      const creds=decryptCredentials(row);
      const target=xtreamApiUrl(row.base_url,creds.username,creds.password).href;
      const result=await compareXtreamFromIndependentRailway(target);
      console.info('BLOFY_XTREAM_INDEPENDENT_COMPARE',
        JSON.stringify({sourceId:id,...result,realPlaybackVerified:false,credentialsLogged:false}));
    })().catch(()=>{
      console.warn('BLOFY_XTREAM_INDEPENDENT_COMPARE',
        JSON.stringify({ok:false,code:'probe_failed',credentialsLogged:false}));
    });
  },19000);
  probeTimer.unref?.();
}

// Opt-in, one-shot production probe: only enabled during an explicit
// diagnostic release. No database changes, catalog requests or media reads.
// Never print source URLs, account details, provider messages or credentials.
if(process.env.BLOFY_XTREAM_ONE_SHOT_DIAGNOSTIC==='1'){
  const timer=setTimeout(()=>{
    void (async()=>{
      const sources=await serverRows();
      const reports=await runXtreamBootDiagnostics({
        rows:sources,
        probe:async row=>{
          try{
            await fetchAccount(row,{timeoutMs:8000,maxAttempts:1});
            return xtreamConnectionReport({ok:true});
          }catch(error){
            return xtreamConnectionReport({errorCode:redactXtreamError(error)});
          }
        },
        log:report=>console.info('BLOFY_XTREAM_DIAGNOSTIC',JSON.stringify(report)),
        wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))
      });
      console.info('BLOFY_XTREAM_DIAGNOSTIC_END',JSON.stringify({
        checked:reports.length,failed:reports.filter(x=>x.code!=='xtream_api_reachable').length
      }));
    })().catch(error=>console.warn('BLOFY_XTREAM_DIAGNOSTIC_FAILED',
      String(error?.code||'unavailable').slice(0,36)));
  },12000);
  timer.unref?.();
}

// Explicit one-time release smoke test, never run during ordinary restarts.
// Test only the first account API that is reachable and already has indexed
// content. Read the initial media bytes; DO NOT claim picture/audio playback.
if(process.env.BLOFY_XTREAM_ONE_SHOT_MEDIA_PROBE==='1'){
  const timer=setTimeout(()=>{
    void(async()=>{
      const sources=(await serverRows()).filter(row=>row.enabled===true);
      let tested=0;
      for(const row of sources.slice(0,4)){
        let reachable=false;
        try{
          await fetchAccount(row,{timeoutMs:8000,maxAttempts:1});
          reachable=true;
        }catch{}
        if(!reachable)continue;
        const counts=row.counts||{};
        // Never probe unavailable/unindexed kinds or the failed account.
        const types=[
          Number(counts.live)>0?'live':null,
          Number(counts.movie)>0?'movie':null,
          Number(counts.series)>0?'episode':null
        ].filter(Boolean);
        for(const mediaType of types){
          try{
            const result=await probeXtreamPlayback(row.id,mediaType);
            // Logs deliberately exclude provider URLs, titles, stream IDs,
            // credentials and the contents of any returned media chunk.
            const checks=Array.isArray(result.checks)?result.checks:[];
            const first=checks[0]||{};
            const status=Number(first.httpStatus);
            const safeCode=typeof first.error==='string'&&
              /^(?:xtream_[a-z0-9_]+|timeout|empty_media|upstream_unreachable|upstream_non_media_response|upstream_html_instead_of_video|no_episode_info|no_playable_episodes)$/.test(first.error)
                ?first.error:'none';
            console.info('BLOFY_REAL_MEDIA_SAMPLE',JSON.stringify({
              sourceId:row.id,type:mediaType,ok:Boolean(result.ok),
              httpStatus:Number.isInteger(status)&&status>=100&&status<=599?status:null,
              code:safeCode,checkCount:checks.length,pictureAndSoundVerified:false
            }));
            tested++;
          }catch(error){
            console.info('BLOFY_REAL_MEDIA_SAMPLE',JSON.stringify({
              sourceId:row.id,type:mediaType,ok:false,
              code:'sample_unavailable',checkCount:0,pictureAndSoundVerified:false
            }));
          }
          await new Promise(resolve=>setTimeout(resolve,650));
        }
        break; // Exactly one provider in the pilot.
      }
      console.info('BLOFY_REAL_MEDIA_SAMPLE_END',JSON.stringify({tested}));
    })().catch(()=>console.warn('BLOFY_REAL_MEDIA_SAMPLE_FAILED','unavailable'));
  },16000);
  timer.unref?.();
}

async function testServer(id) {
  const row = await serverById(id);
  if (!row) throw Object.assign(new Error('xtream_server_not_found'), { status: 404 });
  if (!row.enabled) throw Object.assign(new Error('xtream_source_paused'), { status: 409 });
  try {
    const info = await fetchAccount(row);
    const result = await pool.query(`UPDATE blofy_xtream_servers SET status='online',account_info=$2::jsonb,last_error=NULL,last_test_at=NOW(),updated_at=NOW()
      WHERE id=$1 AND enabled=TRUE AND deletion_requested_at IS NULL RETURNING *`, [id, JSON.stringify(info)]);
    if(!result.rows[0])throw Object.assign(new Error('xtream_source_paused'),{status:409});
    return adminServer(result.rows[0]);
  } catch (error) {
    const message = redactXtreamError(error);
    await pool.query(`UPDATE blofy_xtream_servers SET status='offline',last_error=$2,last_test_at=NOW(),updated_at=NOW() WHERE id=$1 AND enabled=TRUE AND deletion_requested_at IS NULL`, [id, message]).catch(() => {});
    throw error;
  }
}

async function flushCategoryBatch(serverId, mediaType, syncToken, batch) {
  if (!batch.length) return;
  if (cancelledSources.has(serverId)) throw Object.assign(new Error('xtream_sync_cancelled'), { status: 409 });
  const payload = distinctXtreamRecords(batch,'sourceCategoryId').map(item => ({
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
  if (cancelledSources.has(serverId)) throw Object.assign(new Error('xtream_sync_cancelled'), { status: 409 });
  const payload = distinctXtreamRecords(batch,'sourceId').map(item => ({
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
      category_id=EXCLUDED.category_id,name=EXCLUDED.name,
      container_extension=EXCLUDED.container_extension,
      icon_url=COALESCE(NULLIF(EXCLUDED.icon_url,''),blofy_xtream_items.icon_url),
      metadata=EXCLUDED.metadata ||
        jsonb_build_object('sourceDetails',
          COALESCE(blofy_xtream_items.metadata->'sourceDetails','{}'::jsonb)) ||
        jsonb_build_object('tmdbDetails',
          COALESCE(blofy_xtream_items.metadata->'tmdbDetails','{}'::jsonb)),
      sync_token=EXCLUDED.sync_token,updated_at=NOW()`,
    [serverId, mediaType, JSON.stringify(payload)]);
  const progress=syncProgress.get(serverId);
  if(progress){progress.imported+=payload.length;progress.updatedAt=Date.now();}
  batch.length = 0;
}

async function syncCategories(row, mediaType, creds, syncToken, getM3u) {
  const action=TYPE_ACTIONS[mediaType].categories;
  let response;
  try{
    response=await checkedFetch(xtreamApiUrl(row.base_url,creds.username,creds.password,action),{timeoutMs:60000,sourceId:row.id});
  }catch(error){
    if(error.message!=='xtream_http_404')throw error;
    if(mediaType==='series')return 0;
    const fallback=await getM3u();
    const batch=[];let total=0;
    for(const item of fallback.categories[mediaType]){
      batch.push({...item,syncToken});total++;
      if(batch.length>=500)await flushCategoryBatch(row.id,mediaType,syncToken,batch);
    }
    await flushCategoryBatch(row.id,mediaType,syncToken,batch);
    return total;
  }
  const batch=[];let accepted=0;
  await parseTopLevelJsonArray(response.body,async raw=>{
    const item=normalizeXtreamCategory(mediaType,raw,syncToken);
    if(!item)return;
    batch.push(item);accepted++;
    if(batch.length>=500)await flushCategoryBatch(row.id,mediaType,syncToken,batch);
  });
  await flushCategoryBatch(row.id,mediaType,syncToken,batch);
  return accepted;
}

async function syncItems(row, mediaType, creds, syncToken, getM3u) {
  const action=TYPE_ACTIONS[mediaType].items;
  let response;
  try{
    response=await checkedFetch(xtreamApiUrl(row.base_url,creds.username,creds.password,action),{timeoutMs:180000,sourceId:row.id});
  }catch(error){
    if(error.message!=='xtream_http_404')throw error;
    if(mediaType==='series')throw new Error('xtream_series_listing_api_unavailable');
    const fallback=await getM3u(),batch=[];let total=0;
    const categories=fallback.categories[mediaType].map(item=>({...item,syncToken}));
    for(let i=0;i<categories.length;i+=500){
      const page=categories.slice(i,i+500);
      await flushCategoryBatch(row.id,mediaType,syncToken,page);
    }
    for(const item of fallback.records[mediaType]){
      batch.push({...item,syncToken});total++;
      if(batch.length>=500)await flushItemBatch(row.id,mediaType,syncToken,batch);
    }
    await flushItemBatch(row.id,mediaType,syncToken,batch);
    if(!total)throw new Error('xtream_m3u_no_'+mediaType+'_items');
    return total;
  }
  const batch=[];let accepted=0;
  await parseTopLevelJsonArray(response.body,async raw=>{
    const item=normalizeXtreamItem(mediaType,raw,syncToken);
    if(!item)return;
    batch.push(item);accepted++;
    if(batch.length>=500)await flushItemBatch(row.id,mediaType,syncToken,batch);
  });
  await flushItemBatch(row.id,mediaType,syncToken,batch);
  return accepted;
}

async function finalizeTypeSync(serverId, mediaType, syncToken,{preserveCategories=false}={}) {
  // A 290k-row catalog must not be deleted in one transaction. That held
  // locks long enough to block source pause/delete, and then timed out.
  // Keep imported rows, prune stale ones in committed bounded batches.
  for(const table of preserveCategories?['blofy_xtream_items']:['blofy_xtream_items','blofy_xtream_categories']){
    for(;;){
      if(cancelledSources.has(serverId))throw Object.assign(new Error('xtream_sync_cancelled'),{status:409});
      const result=await pool.query(`DELETE FROM ${table}
        WHERE ctid IN (
          SELECT ctid FROM ${table}
          WHERE server_id=$1 AND media_type=$2
            AND sync_token IS DISTINCT FROM $3
          LIMIT 350
        )`,[serverId,mediaType,syncToken]);
      if(result.rowCount<350)break;
      await new Promise(resolve=>setTimeout(resolve,8));
    }
  }
  if(cancelledSources.has(serverId))throw Object.assign(new Error('xtream_sync_cancelled'),{status:409});
  // One indexed GROUP BY and a small category update instead of the
  // historical full-table NOT EXISTS update on every category.
  await pool.query(`UPDATE blofy_xtream_categories c SET item_count=counts.count,updated_at=NOW()
    FROM (
      SELECT c2.server_id,c2.media_type,c2.source_category_id,
        COALESCE(i.total,0)::int AS count
      FROM blofy_xtream_categories c2
      LEFT JOIN (
        SELECT server_id,media_type,category_id,COUNT(*) AS total
        FROM blofy_xtream_items WHERE server_id=$1 AND media_type=$2
        GROUP BY server_id,media_type,category_id
      ) i ON i.server_id=c2.server_id AND i.media_type=c2.media_type
        AND i.category_id=c2.source_category_id
      WHERE c2.server_id=$1 AND c2.media_type=$2
    ) counts
    WHERE c.server_id=counts.server_id AND c.media_type=counts.media_type
      AND c.source_category_id=counts.source_category_id
      AND c.item_count IS DISTINCT FROM counts.count`,[serverId,mediaType]);
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
  if (!row.enabled) throw Object.assign(new Error('xtream_source_paused'), { status: 409 });
  const types = [...new Set(requestedTypes.map(validType).filter(Boolean))];
  if (!types.length) throw Object.assign(new Error('xtream_sync_types_invalid'), { status: 400 });
  syncLocks.add(id);
  syncProgress.set(id,{mediaType:'starting',imported:0,startedAt:Date.now(),updatedAt:Date.now()});
  try {
    // A queued import can be cancelled while waiting or between its start
    // and its first database read. Never contact upstream after cancellation.
    if(cancelledSources.has(id))throw Object.assign(new Error('xtream_sync_cancelled'),{status:409});
    await pool.query(`UPDATE blofy_xtream_servers SET status='syncing',last_error=NULL,updated_at=NOW() WHERE id=$1 AND enabled=TRUE AND deletion_requested_at IS NULL`, [id]);
    const accountInfo = await fetchAccount(row);
    const creds = decryptCredentials(row);
    const details = {}, failures=[];
    let playlistPromise;
    const getM3u=()=>{
      if(!playlistPromise)playlistPromise=downloadXtreamM3uCatalog({
        baseUrl:row.base_url,username:creds.username,password:creds.password
      },{
        // The approved source-pinned STREAM relay can read large official
        // M3U responses that reset the portal's direct connection. Keep the
        // same get.php URL; never fall back on provider HTTP denials.
        independentImpl:shouldUseIndependentXtreamSource(id)?
          manifest=>fetchIndependentXtreamManifest(manifest.href):null
      });
      return playlistPromise;
    };
    for (const mediaType of types) {
      syncProgress.set(id,{mediaType,imported:0,startedAt:Date.now(),updatedAt:Date.now()});
      if (cancelledSources.has(id)) throw Object.assign(new Error('xtream_sync_cancelled'),{status:409});
      const syncToken = crypto.randomUUID();
      try{
        // Snapshot each media type before mutation. In particular, a provider
        // returning HTTP 200 with [] must never wipe a customer's old library.
        const before=(await pool.query(`SELECT
          (SELECT COUNT(*)::int FROM blofy_xtream_items WHERE server_id=$1 AND media_type=$2) AS items,
          (SELECT COUNT(*)::int FROM blofy_xtream_categories WHERE server_id=$1 AND media_type=$2) AS categories`,
          [id,mediaType])).rows[0];
        const categories = await syncCategories(row, mediaType, creds, syncToken, getM3u);
        await syncItems(row, mediaType, creds, syncToken, getM3u);
        if (cancelledSources.has(id)) throw Object.assign(new Error('xtream_sync_cancelled'),{status:409});
        // Count unique rows with this token, not raw feed entries (which may
        // contain duplicates), before any deletion of previously imported rows.
        const imported=(await pool.query(`SELECT
          (SELECT COUNT(*)::int FROM blofy_xtream_items WHERE server_id=$1 AND media_type=$2 AND sync_token=$3) AS items,
          (SELECT COUNT(*)::int FROM blofy_xtream_categories WHERE server_id=$1 AND media_type=$2 AND sync_token=$3) AS categories`,
          [id,mediaType,syncToken])).rows[0];
        const decision=assessXtreamSync({
          previousItems:Number(before.items),importedItems:Number(imported.items),
          previousCategories:Number(before.categories),importedCategories:Number(imported.categories)
        });
        if (cancelledSources.has(id)) throw Object.assign(new Error('xtream_sync_cancelled'),{status:409});
        await finalizeTypeSync(id, mediaType, syncToken,{preserveCategories:decision.preserveCategories});
        if(decision.preserveCategories)failures.push(mediaType+': xtream_categories_preserved');
        details[mediaType] = { categories:decision.preserveCategories?Number(before.categories):decision.categories,
          items:decision.items,preservedOldCategories:decision.preserveCategories };
      }catch(error){
        failures.push(mediaType+': '+redactXtreamError(error));
        console.warn('Xtream catalog type failed:',id,mediaType,redactXtreamError(error));
      }
    }
    if (cancelledSources.has(id)) throw Object.assign(new Error('xtream_sync_cancelled'), { status: 409 });
    if(!Object.keys(details).length)throw new Error('xtream_catalog_unavailable: '+failures.join('; ').slice(0,280));
    const counts = await calculateCounts(id);
    const partialWarning=failures.length?'بعض الأنواع لم تُستورد: '+failures.join('; ').slice(0,250):null;
    await pool.query(`UPDATE blofy_xtream_servers SET status='online',account_info=$2::jsonb,counts=$3::jsonb,last_error=$4,last_test_at=NOW(),last_sync_at=NOW(),updated_at=NOW() WHERE id=$1 AND enabled=TRUE AND deletion_requested_at IS NULL`,
      [id, JSON.stringify(accountInfo), JSON.stringify(counts),partialWarning]);
    return { id, counts, details, partialWarning };
  } catch (error) {
    const message = redactXtreamError(error);
    const cancelled=message==='xtream_sync_cancelled';
    await pool.query(`UPDATE blofy_xtream_servers SET status='${cancelled?'unknown':'error'}',last_error=$2,updated_at=NOW()
      WHERE id=$1 AND enabled=TRUE AND deletion_requested_at IS NULL`, [id, message]).catch(() => {});
    throw error;
  } finally {
    syncLocks.delete(id);
    syncProgress.delete(id);
    cancelledSources.delete(id);
  }
}

// Explicit one-time ingestion trial after authenticated API and live-category
// fetch both succeeded from the independent STREAM project. Only the single
// approved source and ONLY live type. Preserve existing snapshot guards and
// prevent overlapping imports through syncServer's existing lock.
if(process.env.BLOFY_XTREAM_INDEPENDENT_LIVE_SYNC_ON_BOOT==='1'){
  const singleSyncTimer=setTimeout(()=>{
    void(async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!validUuid(id)||!shouldUseIndependentXtreamSource(id))return;
      console.info('BLOFY_XTREAM_INDEPENDENT_LIVE_SYNC',JSON.stringify({
        sourceId:id,status:'started',mediaType:'live',customerCutover:false}));
      const result=await syncServer(id,['live']);
      console.info('BLOFY_XTREAM_INDEPENDENT_LIVE_SYNC',JSON.stringify({
        sourceId:id,status:'completed',mediaType:'live',
        items:result.details?.live?.items??null,
        categories:result.details?.live?.categories??null,
        partialWarning:Boolean(result.partialWarning),customerCutover:false}));
    })().catch(error=>{
      console.warn('BLOFY_XTREAM_INDEPENDENT_LIVE_SYNC',JSON.stringify({
        status:'failed',code:redactXtreamError(error),customerCutover:false}));
    });
  },24000);
  singleSyncTimer.unref?.();
}

// One-shot source-scoped replay of the exact admin live sample selection.
// Reports only status, redacted error enum and latency. Never changes the
// source account, catalog, subscriber routes or active client playback.
if(process.env.BLOFY_XTREAM_LIVE_LONG_PROOF_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
   if(!validUuid(id)||!shouldUseIndependentXtreamSource(id))return;
   const result=await probeXtreamPlayback(id,'live');
   const checks=Array.isArray(result.checks)?result.checks.slice(0,8):[];
   const safeErrors=new Set(['timeout','empty_media','relay_first_byte_timeout',
     'relay_provider_not_found','xtream_transport_connection_reset',
     'upstream_unreachable','upstream_non_media_response','redirect_invalid']);
   console.info('BLOFY_XTREAM_LIVE_LONG_PROOF',JSON.stringify({
    sourceId:id,ok:result.ok===true,
    checked:checks.length,successes:checks.filter(x=>x?.ok).length,
    statuses:checks.map(x=>Number.isInteger(x.httpStatus)?x.httpStatus:null),
    errors:checks.map(x=>safeErrors.has(x.error)?x.error:x.error?'other':null),
    formats:checks.map(x=>['ts','m3u8'].includes(x.outputFormat)?x.outputFormat:null),
    latencyMs:checks.map(x=>Number.isFinite(x.latencyMs)?Math.min(15000,Math.round(x.latencyMs)):null),
    sourceMutation:false,subscriberCutover:false,credentialsLogged:false,
    videoDecoded:false
   }));
  })().catch(()=>console.warn('BLOFY_XTREAM_LIVE_LONG_PROOF',
    JSON.stringify({ok:false,code:'live_probe_unavailable',
      sourceMutation:false,subscriberCutover:false,credentialsLogged:false})));
 },23000);
 timer.unref?.();
}

// Read-only, source-authorized real transport probe from the NEW STREAM
// project. Uses three indexed live channels and reads at most one initial
// media chunk from each; never changes activation, source or user rows.
// A valid TS signature is NOT proof that audio/video decodes on a TV.
if(process.env.BLOFY_XTREAM_INDEPENDENT_MEDIA_PROBE_ON_BOOT==='1'){
  const mediaProbeTimer=setTimeout(()=>{
    void(async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!validUuid(id)||!shouldUseIndependentXtreamSource(id))return;
      const row=await serverById(id);
      if(!row?.enabled)return;
      const creds=decryptCredentials(row);
      const items=(await pool.query(`SELECT source_id FROM blofy_xtream_items
        WHERE server_id=$1 AND media_type='live' AND enabled=TRUE ORDER BY random() LIMIT 3`,
        [id])).rows;
      const checks=[];
      for(const item of items){
        let status=null,format=null,verified=false,providerStatus=null,denialCode=null;
        try{
          const path=['live',encodeURIComponent(creds.username),encodeURIComponent(creds.password),
            encodeURIComponent(String(item.source_id))+'.ts'].join('/');
          const sourceUrl=new URL(path,normalizeXtreamBaseUrl(row.base_url)+'/');
          const destination=await issueStreamRelayGrant({sourceUrl:sourceUrl.href,kind:'live'});
          const response=await fetch(destination,{method:'GET',redirect:'error',
            headers:{accept:'video/mp2t,*/*'},signal:AbortSignal.timeout(12000)});
          status=response.status;
          if((response.ok||response.status===206)&&response.body){
            const reader=response.body.getReader();
            try{
              const first=await reader.read();
              if(!first.done&&first.value?.byteLength){
                const result=inspectXtreamMediaChunk(first.value,response.headers.get('content-type'));
                format=result.format;verified=result.valid&&result.format==='ts';
              }
            }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
          }else{
            // Only provider HTTP code and an allowlisted diagnostic identifier:
            // never return/log source URLs, media payload or account data.
            const buf=await response.text().catch(()=>'');
            if(buf.length<=350){
              try{
                const diag=JSON.parse(buf);
                if(['relay_provider_unavailable','relay_not_playable_media','relay_issue_invalid']
                    .includes(diag?.code))denialCode=diag.code;
                if(Number.isInteger(diag?.upstreamStatus)&&diag.upstreamStatus>=100&&
                    diag.upstreamStatus<=599)providerStatus=diag.upstreamStatus;
              }catch{}
            }
          }
        }catch{}
        checks.push({status,format,verified,providerStatus,denialCode});
        if(verified)break;
      }
      console.info('BLOFY_XTREAM_INDEPENDENT_MEDIA_PROOF',JSON.stringify({
        sourceId:id,checked:checks.length,
        mediaTransportVerified:checks.some(x=>x.verified),
        statuses:checks.map(x=>x.status),
        upstreamStatuses:checks.map(x=>x.providerStatus),
        denialCodes:checks.map(x=>x.denialCode),
        formats:checks.map(x=>x.format),
        // The provider's own Xtream metadata, not a legal grant.
        sourceAllowsRestream:row.account_info?.isRestreamer??null,
        allowedOutputFormats:Array.isArray(row.account_info?.allowedOutputFormats)
          ? row.account_info.allowedOutputFormats.filter(v=>['ts','m3u8','rtmp'].includes(v)) : [],
        audioVideoDecoded:false,customerCutover:false,credentialsLogged:false
      }));
    })().catch(()=>{
      console.warn('BLOFY_XTREAM_INDEPENDENT_MEDIA_PROOF',
        JSON.stringify({ok:false,code:'probe_unavailable',customerCutover:false}));
    });
  },26000);
  mediaProbeTimer.unref?.();
}

// One-time, source-pinned read-only evidence for the second provider's
// partially failing episode sample. The admin HTTP 200 is NOT media success.
// Never include titles, source episode IDs, usernames, URLs or passwords.
if(process.env.BLOFY_XTREAM_ADDITIONAL_EPISODE_PROBE_ON_BOOT==='1'){
 const timer=setTimeout(()=>{
  void(async()=>{
   const id=String(process.env.BLOFY_XTREAM_ADDITIONAL_EPISODE_SOURCE_ID||'').trim();
   if(!validUuid(id))return;
   const row=await serverById(id);
   if(!row?.enabled)return;
   const result=await probeXtreamPlayback(id,'episode');
   const checks=Array.isArray(result.checks)?result.checks.slice(0,8):[];
   const safeErrors=new Set([
    'relay_provider_not_found','relay_first_byte_timeout',
    'relay_transport_connection_reset','relay_transport_timeout',
    'xtream_transport_connection_reset','xtream_transport_timeout',
    'timeout','upstream_unreachable','empty_media','no_episode_info',
    'no_playable_episodes','upstream_non_media_response',
    'series_response_invalid','series_response_too_large'
   ]);
   console.info('BLOFY_XTREAM_ADDITIONAL_EPISODE_PROOF',JSON.stringify({
    sourceId:id,ok:result.ok===true,
    checked:checks.length,
    successful:checks.filter(x=>x?.ok).length,
    failures:checks.filter(x=>x&&!x.ok).length,
    statuses:checks.map(x=>Number.isInteger(x?.httpStatus)?x.httpStatus:null),
    errors:checks.map(x=>safeErrors.has(x?.error)?x.error:x?.error?'other':null),
    latenciesMs:checks.map(x=>Number.isFinite(x?.latencyMs)
      ?Math.max(0,Math.min(15000,Math.round(x.latencyMs))):null),
    sourceMutation:false,subscriberCutover:false,
    customerCredentialsLogged:false,videoDecoded:false
   }));
  })().catch(()=>console.warn('BLOFY_XTREAM_ADDITIONAL_EPISODE_PROOF',
    JSON.stringify({ok:false,code:'episode_probe_unavailable',
      sourceMutation:false,subscriberCutover:false,customerCredentialsLogged:false})));
 },24000);
 timer.unref?.();
}

// One-shot operator-only comparison of official M3U link destinations.
// Reads the existing approved source's encrypted secrets in memory. Exactly
// one protected STREAM service call, no DB changes and no customer redirect.
if(process.env.BLOFY_XTREAM_OFFICIAL_M3U_PROBE_ON_BOOT==='1'){
  const timer=setTimeout(()=>{
    void(async()=>{
      const sourceId=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!validUuid(sourceId)||!shouldUseIndependentXtreamSource(sourceId))return;
      const row=await serverById(sourceId);
      if(!row?.enabled)return;
      const creds=decryptCredentials(row);
      const url=xtreamM3uUrl(row.base_url,creds.username,creds.password,'ts');
      const result=await probeOfficialXtreamPlaylistRoute(url.href);
      console.info('BLOFY_XTREAM_OFFICIAL_M3U_PROOF',JSON.stringify({
        sourceId,...result,credentialsLogged:false
      }));
    })().catch(()=>{
      console.warn('BLOFY_XTREAM_OFFICIAL_M3U_PROOF',
        JSON.stringify({ok:false,code:'probe_unavailable',credentialsLogged:false}));
    });
  },21000);
  timer.unref?.();
}

// Operator-only one-shot assessment after the approved source was proved to
// return real TS bytes via STREAM. No catalog or client traffic changes.
if(process.env.BLOFY_XTREAM_INDEPENDENT_VOD_SERIES_PROBE_ON_BOOT==='1'){
  const timer=setTimeout(()=>{
    void(async()=>{
      const id=String(process.env.BLOFY_XTREAM_EGRESS_SOURCE_ID||'').trim();
      if(!validUuid(id)||!shouldUseIndependentXtreamSource(id))return;
      for(const mediaType of ['movie','series','episode']){
        let outcome;
        try{
          const report=await probeXtreamPlayback(id,mediaType);
          const samples=Array.isArray(report.checks)?report.checks.slice(0,8):[];
          const good=samples.filter(x=>x?.ok).length;
          const bad=samples.filter(x=>x&&!x.ok).length;
          // HTTP 502 is the relay envelope for a verified provider 404.
          // Expose fixed categories and complete counters, never provider
          // stream IDs, URLs, raw bodies, or player credentials.
          const upstreamMissing=samples.filter(x=>
            x?.httpStatus===404||x?.error==='relay_provider_not_found').length;
          outcome={
            ok:good>0&&bad===0,partial:good>0&&bad>0,
            cleanSamples:good,failedSamples:bad,
            upstreamMissingSamples:upstreamMissing,
            // Helps distinguish a missing /movie or /series route from
            // a provider-authorized CDN/direct_source route, without leaking it.
            failedWithAdvertisedDirectSource:samples.filter(x=>!x.ok&&
              x.directSourceAdvertised===true).length,
            itemsChecked:samples.length,
            statuses:samples.map(x=>x.httpStatus??x.seriesHttpStatus??null),
            reasons:samples.map(x=>{
              const key=String(x.error||'');
              return ['relay_provider_not_found','relay_first_byte_timeout',
                'xtream_transport_connection_reset','timeout','upstream_unreachable',
                'no_episode_info','series_response_invalid','empty_media',
                'upstream_non_media_response','no_playable_episodes',
                'series_response_too_large'].includes(key)?key:key?'other':null;
            })
          };
        }catch{outcome={ok:false,error:'probe_unavailable'};}
        console.info('BLOFY_XTREAM_INDEPENDENT_VOD_SERIES_PROOF',
          JSON.stringify({sourceId:id,mediaType,...outcome,
            mediaBytesNotDecoded:true,customerCutover:false,credentialsLogged:false}));
      }
    })().catch(()=>{console.warn('BLOFY_XTREAM_INDEPENDENT_VOD_SERIES_PROOF',
      JSON.stringify({ok:false,code:'probe_unavailable',customerCutover:false}));});
  },22000);
  timer.unref?.();
}

async function cancelSourceSync(id) {
  const row=await serverById(id);
  if(!row)throw Object.assign(new Error('xtream_server_not_found'),{status:404});
  const wasRunning=syncLocks.has(id)||(syncQueue.has(id)&&!syncQueue.isQueued(id));
  const wasQueued=syncQueue.cancel(id);
  if(wasRunning)cancelledSources.add(id);
  const clearStale=!wasRunning&&row.status==='syncing';
  if(clearStale){
    await sourceMutation(`UPDATE blofy_xtream_servers
      SET status='unknown',last_error='xtream_sync_not_running',updated_at=NOW()
      WHERE id=$1 AND deletion_requested_at IS NULL`,[id]);
  }
  return {cancelRequested:wasRunning||wasQueued,queuedCancelled:wasQueued,
    staleStateCleared:clearStale};
}

function startSync(id, types) {
  if (syncQueue.has(id)||syncLocks.has(id))
    throw Object.assign(new Error('xtream_sync_in_progress'), { status: 409 });
  try{
    return syncQueue.enqueue(id,()=>syncServer(id,types));
  }catch(error){
    if(error.message==='xtream_sync_queue_full')
      throw Object.assign(new Error('xtream_sync_queue_full'),{status:429});
    if(error.message==='xtream_sync_in_progress')
      throw Object.assign(new Error('xtream_sync_in_progress'),{status:409});
    throw error;
  }
}
const studioPro=createStudioPro({pool,ensureXtreamReady:ensureReady,startSync});
const studioTimer=setInterval(()=>{
  void studioPro.tick().catch(error=>console.warn('BLOFY Studio schedule check failed:',String(error?.code||'unavailable').slice(0,30)));
},300000);
studioTimer.unref?.();
const studioStartupTimer=setTimeout(()=>{
  void studioPro.tick().catch(error=>console.warn('BLOFY Studio startup schedule check:',String(error?.code||'unavailable').slice(0,30)));
},30000);
studioStartupTimer.unref?.();


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
  if (body.enabled !== undefined) {
    const enabled=Boolean(body.enabled);
    set('enabled',enabled);
    if (!enabled) {
      if (syncLocks.has(id)||(syncQueue.has(id)&&!syncQueue.isQueued(id)))
        cancelledSources.add(id);
      syncQueue.cancel(id);
      set('status','offline');
    } else if (!current.enabled) {
      // Re-activated sources are awaiting a fresh connection check.
      set('status','unknown');
    }
  }
  if (body.publishCatalog !== undefined) set('publish_catalog', Boolean(body.publishCatalog));
  // Source, credentials or playback policy changes invalidate previous probes.
  if(body.baseUrl!==undefined||String(body.username||'').trim()||String(body.password||'').trim())
    updates.push("media_probe_state='{}'::jsonb");
  if (body.priority !== undefined) {
    const priority = Number(body.priority);
    if (!Number.isFinite(priority) || priority < 0 || priority > 10000) throw Object.assign(new Error('xtream_priority_invalid'), { status: 400 });
    set('priority', Math.round(priority));
  }
  if (!updates.length) throw Object.assign(new Error('nothing_to_update'), { status: 400 });
  values.push(id);
  const result = await sourceMutation(`UPDATE blofy_xtream_servers SET ${updates.join(',')},updated_at=NOW() WHERE id=$${values.length} AND deletion_requested_at IS NULL RETURNING *`, values);
  if(!result.rows[0])throw Object.assign(new Error('xtream_server_not_found'),{status:404});
  return adminServer(result.rows[0]);
}

async function listCategories(serverId, mediaType) {
  await ensureReady();
  const where = [];
  const values = [];
  if (serverId) { if (!validUuid(serverId)) throw Object.assign(new Error('xtream_server_id_invalid'), { status: 400 }); values.push(serverId); where.push(`server_id=$${values.length}`); }
  if (mediaType) { const type = validType(mediaType); if (!type) throw Object.assign(new Error('xtream_type_invalid'), { status: 400 }); values.push(type); where.push(`media_type=$${values.length}`); }
  const sql = `SELECT server_id,media_type,source_category_id,name,parent_id,enabled,sort_order,item_count,updated_at FROM blofy_xtream_categories ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY media_type,sort_order,name LIMIT 5000`;
  return (await pool.query(sql, values)).rows.map(row => ({
    serverId: row.server_id,
    mediaType: row.media_type,
    id: row.source_category_id,
    name: row.name,
    parentId: row.parent_id,
    enabled: Boolean(row.enabled),
    sortOrder: Number(row.sort_order||100000),
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
  if (query.q) { values.push(`%${String(query.q).slice(0,120).replace(/[%_]/g, '\\$&')}%`); where.push(`(COALESCE(NULLIF(i.custom_name,''),i.name) ILIKE $${values.length} ESCAPE '\\' OR translate(COALESCE(NULLIF(i.custom_name,''),i.name),'أإآٱىة','اااايه') ILIKE translate($${values.length},'أإآٱىة','اااايه') ESCAPE '\\' OR COALESCE(c.name,'') ILIKE $${values.length} ESCAPE '\\' OR COALESCE(i.metadata->>'genre','') ILIKE $${values.length} ESCAPE '\\')`); }
  // Smart browsing filters media using its real metadata; neither filter
  // rewrites upstream categories or touches any customer-facing item IDs.
  if (query.year || query.language) {
    if(mediaType==='live')throw Object.assign(new Error('xtream_year_filter_video_only'),{status:400});
    if(!query.serverId)throw Object.assign(new Error('xtream_smart_filter_source_required'),{status:400});
  }
  if(query.year){
    const year=Number(query.year);
    if(!Number.isInteger(year)||year<1950||year>2099)
      throw Object.assign(new Error('xtream_year_invalid'),{status:400});
    values.push(String(year));
    // Prefer the actual source year, then release date, then a year written
    // inside the title. Undated content remains unclassified.
    where.push(`COALESCE(
      NULLIF(NULLIF(i.metadata->>'year',''),'0'),
      substring(i.metadata->>'releaseDate' from '(19[5-9][0-9]|20[0-9]{2})'),
      substring(i.name from '(19[5-9][0-9]|20[0-9]{2})')
    )=$${values.length}`);
  }
  if(query.language){
    const patterns={
      arabic:'عرب|arabic',
      foreign:'أجنبي|اجنبي|انجليزي|إنجليزي|english|foreign|hollywood|american|أمريكي',
      turkish:'تركي|turkish|turkey',
      indian:'هندي|indian|bollywood|hindi',
      korean:'كوري|korean',
      anime:'انمي|أنمي|anime',
      kids:'اطفال|أطفال|kids|children|cartoon|كرتون',
      documentary:'وثائقي|documentary'
    };
    const pattern=patterns[String(query.language)];
    if(!pattern)throw Object.assign(new Error('xtream_language_filter_invalid'),{status:400});
    values.push(pattern);
    where.push(`c.name ~* $${values.length}`);
  }
  values.push(limit, offset);
  const rows = (await pool.query(`SELECT i.server_id,i.media_type,i.source_id,i.category_id,
      COALESCE(NULLIF(i.custom_name,''),i.name) AS name,COALESCE(NULLIF(i.custom_icon_url,''),i.icon_url) AS icon_url,
      i.name AS original_name,i.icon_url AS original_icon_url,i.custom_name,i.custom_icon_url,i.featured,i.channel_number,
      i.container_extension,i.enabled,i.metadata,i.updated_at,
      s.name AS server_name,s.priority,c.name AS category_name,c.enabled AS category_enabled
    FROM blofy_xtream_items i
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
    WHERE ${where.join(' AND ')}
    ORDER BY (CASE WHEN i.media_type='live' AND i.featured THEN 0 ELSE 1 END),
      CASE WHEN i.media_type='live' THEN COALESCE(i.channel_number,999999) ELSE 999999 END,
      s.priority ASC,COALESCE(NULLIF(i.custom_name,''),i.name) ASC,i.source_id ASC
    LIMIT $${values.length-1} OFFSET $${values.length}`, values)).rows;
  return rows.map(row => ({
    serverId: row.server_id,
    serverName: row.server_name,
    type: row.media_type,
    id: row.source_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    name: row.name,
    iconUrl: row.icon_url,
    originalName:row.original_name,
    originalIconUrl:row.original_icon_url,
    customName:row.custom_name,
    customIconUrl:row.custom_icon_url,
    featured:Boolean(row.featured),
    channelNumber:row.channel_number==null?null:Number(row.channel_number),
    containerExtension: row.container_extension,
    enabled: Boolean(row.enabled),
    categoryEnabled: row.category_enabled == null ? true : Boolean(row.category_enabled),
    metadata: mergedXtreamMetadata(row.metadata),
    updatedAt: new Date(row.updated_at).getTime()
  }));
}

// Operator-only read-only preview. Keep the sample bounded so a 250k-row
// IPTV catalog cannot stall the primary playback database. All candidate
// matching remains advisory: no silent remapping or rights assumptions.
async function previewAdminChannelEpg(serverId,sourceId){
  if(!validUuid(serverId)||!/^[A-Za-z0-9._-]{1,128}$/.test(String(sourceId||'')))
    throw Object.assign(new Error('studio_epg_selection_invalid'),{status:400});
  const row=await serverById(serverId);
  if(!row||!row.enabled)throw Object.assign(new Error('studio_epg_source_unavailable'),{status:409});
  const found=(await pool.query("SELECT source_id FROM blofy_xtream_items WHERE server_id=$1 AND media_type='live' AND source_id=$2",
    [serverId,sourceId])).rows[0];
  if(!found)throw Object.assign(new Error('studio_epg_channel_not_found'),{status:404});
  const creds=decryptCredentials(row);
  const upstream=await checkedFetch(xtreamApiUrl(row.base_url,creds.username,creds.password,'get_short_epg',
    {stream_id:sourceId,limit:'12'}),{timeoutMs:12000});
  let total=0,parts=[];
  try{
    if(!upstream.body)throw new Error('studio_epg_empty');
    for await(const part of upstream.body){
      total+=part.byteLength;
      if(total>300000)throw new Error('studio_epg_too_large');
      parts.push(Buffer.from(part));
    }
  }finally{try{await upstream.body?.cancel()}catch{}}
  let payload;
  try{payload=JSON.parse(Buffer.concat(parts).toString('utf8'))}
  catch{throw Object.assign(new Error('studio_epg_invalid_data'),{status:409})}
  return {serverId,sourceId,...normalizeXtreamEpg(payload,12)};
}

async function previewCatalogInsights(serverId,mediaType){
  if(!validUuid(serverId)||!['movie','series','live'].includes(mediaType))
    throw Object.assign(new Error('xtream_insights_selection_invalid'),{status:400});
  await ensureReady();
  const existing=await serverById(serverId);
  if(!existing)throw Object.assign(new Error('xtream_server_not_found'),{status:404});
  const [primary,alternates]=await Promise.all([
    pool.query(`SELECT server_id::text,source_id,name,icon_url,metadata,enabled
      FROM blofy_xtream_items WHERE server_id=$1 AND media_type=$2
      ORDER BY source_id LIMIT 1200`,[serverId,mediaType]),
    pool.query(`SELECT i.server_id::text,i.source_id,i.name,i.icon_url,i.metadata,
        i.enabled,s.name AS server_name
      FROM blofy_xtream_items i JOIN blofy_xtream_servers s ON s.id=i.server_id
      WHERE i.media_type=$1 AND i.server_id<>$2 AND i.enabled=TRUE
        AND s.enabled=TRUE AND s.publish_catalog=TRUE
      LIMIT 1800`,[mediaType,serverId])
  ]);
  return {sourceName:existing.name,mediaType,
    ...auditXtreamCatalogSample(primary.rows,alternates.rows)};
}

async function patchCategory(serverId, mediaType, categoryId, enabled) {
  if (!validUuid(serverId) || !validType(mediaType)) throw Object.assign(new Error('xtream_category_invalid'), { status: 400 });
  const result = await pool.query(`UPDATE blofy_xtream_categories SET enabled=$4,updated_at=NOW() WHERE server_id=$1 AND media_type=$2 AND source_category_id=$3 RETURNING *`,
    [serverId, mediaType, categoryId, Boolean(enabled)]);
  if (!result.rows[0]) throw Object.assign(new Error('xtream_category_not_found'), { status: 404 });
  return result.rows[0];
}

// Operator-triggered, transactional reordering only. No catalog rows,
// visibility, subscriber entitlements or upstream credentials are touched.
async function autoSortCategories(serverId,mediaType,mode){
  if(!validUuid(serverId)||!validType(mediaType)||!['popular','alphabetical','smart'].includes(mode))
    throw Object.assign(new Error('xtream_category_sort_invalid'),{status:400});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='1300ms'");
    await client.query("SET LOCAL statement_timeout='12000ms'");
    const records=await client.query(`SELECT source_category_id,name,item_count
      FROM blofy_xtream_categories
      WHERE server_id=$1 AND media_type=$2
      ORDER BY sort_order,name,source_category_id
      LIMIT 1001 FOR UPDATE`,[serverId,mediaType]);
    if(records.rows.length>1000)
      throw Object.assign(new Error('xtream_category_sort_too_many'),{status:409});
    if(!records.rows.length){
      await client.query('COMMIT');
      return{updated:0,mode,unchanged:true};
    }
    const current=records.rows.map(row=>String(row.source_category_id));
    const ordered=sortXtreamCategories(records.rows,mode);
    const unchanged=current.every((id,index)=>id===ordered[index]);
    if(!unchanged){
      await client.query(`UPDATE blofy_xtream_categories c
        SET sort_order=rank.pos::int,updated_at=NOW()
        FROM unnest($3::text[]) WITH ORDINALITY AS rank(category_id,pos)
        WHERE c.server_id=$1 AND c.media_type=$2 AND c.source_category_id=rank.category_id`,
        [serverId,mediaType,ordered]);
    }
    await client.query('COMMIT');
    return{updated:ordered.length,mode,unchanged};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    if(['55P03','57014'].includes(String(error?.code||'')))
      throw Object.assign(new Error('xtream_category_busy_retry'),{status:409});
    throw error;
  }finally{client.release();}
}

async function moveCategory(serverId, mediaType, categoryId, direction) {
  if (!validUuid(serverId) || !validType(mediaType) || !['up','down','top'].includes(direction))
    throw Object.assign(new Error('xtream_category_move_invalid'), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const response=await client.query(`SELECT source_category_id FROM blofy_xtream_categories
      WHERE server_id=$1 AND media_type=$2 ORDER BY sort_order,name,source_category_id FOR UPDATE`,[serverId,mediaType]);
    const ids=response.rows.map(row=>row.source_category_id);
    const at=ids.indexOf(String(categoryId));
    if(at===-1)throw Object.assign(new Error('xtream_category_not_found'),{status:404});
    const next=direction==='top'?0:at+(direction==='up'?-1:1);
    if(next<0||next>=ids.length||next===at){await client.query('COMMIT');return {moved:false};}
    ids.splice(next,0,...ids.splice(at,1));
    await client.query(`UPDATE blofy_xtream_categories c
      SET sort_order=rank.pos::int,updated_at=NOW()
      FROM unnest($3::text[]) WITH ORDINALITY AS rank(category_id,pos)
      WHERE c.server_id=$1 AND c.media_type=$2 AND c.source_category_id=rank.category_id`,
      [serverId,mediaType,ids]);
    await client.query('COMMIT');
    return {moved:true};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}

// Manually enrich one existing VOD or series entry from its own configured
// provider. Deliberately does NOT fetch or activate any media, remap gateway
// stream IDs, or change content visibility / subscriber entitlements.
async function enrichOneXtreamItem(serverId,mediaType,sourceId){
  if(!validUuid(serverId)||!['movie','series'].includes(mediaType)||
     !/^[A-Za-z0-9._-]{1,128}$/.test(String(sourceId||'')))
    throw Object.assign(new Error('xtream_details_selection_invalid'),{status:400});
  const source=await serverById(serverId);
  if(!source||!source.enabled)
    throw Object.assign(new Error('xtream_details_source_unavailable'),{status:409});
  const exists=(await pool.query(`SELECT source_id FROM blofy_xtream_items
    WHERE server_id=$1 AND media_type=$2 AND source_id=$3`,[serverId,mediaType,sourceId])).rows[0];
  if(!exists)throw Object.assign(new Error('xtream_details_item_not_found'),{status:404});
  const creds=decryptCredentials(source);
  let response;
  try{
    response=await checkedFetch(xtreamApiUrl(source.base_url,creds.username,creds.password,
      mediaType==='movie'?'get_vod_info':'get_series_info',
      mediaType==='movie'?{vod_id:sourceId}:{series_id:sourceId}),{timeoutMs:15000});
  }catch(error){
    if(String(error?.message||'')==='xtream_http_404')
      throw Object.assign(new Error('xtream_details_provider_not_supported'),{status:409});
    throw Object.assign(new Error('xtream_details_fetch_failed'),{status:503});
  }
  let bytes=0;const chunks=[];
  try{
    if(!response.body)throw new Error('xtream_details_unavailable');
    for await(const chunk of response.body){
      bytes+=chunk.byteLength;
      if(bytes>2_000_000)throw new Error('xtream_details_too_large');
      chunks.push(Buffer.from(chunk));
    }
  }catch(error){
    const name=['xtream_details_unavailable','xtream_details_too_large'].includes(error?.message)
      ?error.message:'xtream_details_read_failed';
    throw Object.assign(new Error(name),{status:409});
  }finally{try{await response.body?.cancel()}catch{}}
  let raw;
  try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
  catch{throw Object.assign(new Error('xtream_details_invalid_json'),{status:409})}
  let details;
  try{details=normalizeXtreamDetails(mediaType,raw)}
  catch{throw Object.assign(new Error('xtream_details_unavailable'),{status:409})}
  const query=await sourceMutation(`UPDATE blofy_xtream_items AS item
    SET metadata=COALESCE(item.metadata,'{}'::jsonb) ||
      jsonb_build_object('sourceDetails',$4::jsonb),
      icon_url=COALESCE(NULLIF(item.icon_url,''),$5),
      updated_at=NOW()
    WHERE item.server_id=$1 AND item.media_type=$2 AND item.source_id=$3
      AND EXISTS(SELECT 1 FROM blofy_xtream_servers s
        WHERE s.id=$1 AND s.enabled=TRUE AND s.deletion_requested_at IS NULL)
    RETURNING item.source_id`,
    [serverId,mediaType,sourceId,JSON.stringify(details.metadata),details.artworkUrl]);
  if(!query.rowCount)throw Object.assign(new Error('xtream_details_item_not_found'),{status:404});
  return{updated:true,fieldsFound:details.fieldsFound,posterAdded:Boolean(details.artworkUrl)};
}

// Commercial TMDB usage remains OFF until both the user-provided bearer token
// and documented commercial-license confirmation exist in Railway. Only an
// exact numeric TMDB ID already supplied by the linked Xtream source is used.
async function enrichOneTmdbItem(serverId,mediaType,sourceId){
  if(!tmdbConfigured())
    throw Object.assign(new Error('tmdb_commercial_license_or_token_required'),{status:409});
  if(!validUuid(serverId)||!['movie','series'].includes(mediaType)||
     !/^[A-Za-z0-9._-]{1,128}$/.test(String(sourceId||'')))
    throw Object.assign(new Error('tmdb_selection_invalid'),{status:400});
  const row=(await pool.query(`SELECT i.metadata FROM blofy_xtream_items i
      JOIN blofy_xtream_servers s ON s.id=i.server_id
      WHERE i.server_id=$1 AND i.media_type=$2 AND i.source_id=$3
        AND s.enabled=TRUE AND s.deletion_requested_at IS NULL`,
        [serverId,mediaType,sourceId])).rows[0];
  if(!row)throw Object.assign(new Error('tmdb_item_not_found'),{status:404});
  const id=validatedTmdbId(mergedXtreamMetadata(row.metadata).tmdb);
  if(!id)throw Object.assign(new Error('tmdb_id_not_supplied_by_source'),{status:409});
  let details;
  try{
    details=await fetchTmdbDetails(mediaType,id,{
      token:String(process.env.BLOFY_TMDB_READ_ACCESS_TOKEN||'').trim()
    });
  }catch(error){
    const allowed=new Set(['tmdb_title_not_found','tmdb_rate_limited',
      'tmdb_response_too_large','tmdb_invalid_json','tmdb_id_mismatch']);
    throw Object.assign(new Error(allowed.has(error?.message)?error.message:'tmdb_upstream_unavailable'),{status:409});
  }
  const result=await sourceMutation(`UPDATE blofy_xtream_items i
    SET metadata=COALESCE(i.metadata,'{}'::jsonb) ||
      jsonb_build_object('tmdbDetails',$4::jsonb),
      icon_url=COALESCE(NULLIF(i.icon_url,''),$5),updated_at=NOW()
    WHERE i.server_id=$1 AND i.media_type=$2 AND i.source_id=$3
      AND EXISTS(SELECT 1 FROM blofy_xtream_servers s WHERE s.id=$1
        AND s.enabled=TRUE AND s.deletion_requested_at IS NULL)
    RETURNING i.source_id`,
    [serverId,mediaType,sourceId,JSON.stringify(details.metadata),details.artworkUrl]);
  if(!result.rowCount)throw Object.assign(new Error('tmdb_item_not_found'),{status:404});
  return{updated:true,source:'TMDB',fieldsFound:Object.keys(details.metadata).length};
}

async function patchItem(serverId, mediaType, sourceId, enabled) {
  if (!validUuid(serverId) || !validType(mediaType)) throw Object.assign(new Error('xtream_item_invalid'), { status: 400 });
  const result = await pool.query(`UPDATE blofy_xtream_items SET enabled=$4,updated_at=NOW() WHERE server_id=$1 AND media_type=$2 AND source_id=$3 RETURNING server_id,media_type,source_id,enabled`,
    [serverId, mediaType, sourceId, Boolean(enabled)]);
  if (!result.rows[0]) throw Object.assign(new Error('xtream_item_not_found'), { status: 404 });
  return result.rows[0];
}

async function updateStudioItem(serverId,mediaType,sourceId,body,reset=false){
  if(!validUuid(serverId)||!validType(mediaType)||!sourceId||sourceId.length>128)
    throw Object.assign(new Error('studio_item_invalid'),{status:400});
  const changes=reset?
    {customName:null,customIconUrl:null,featured:false,channelNumber:null}:
    normalizeStudioItemEdit(body,mediaType);
  const cols={customName:'custom_name',customIconUrl:'custom_icon_url',
    featured:'featured',channelNumber:'channel_number'};
  const assignments=[],values=[serverId,mediaType,sourceId];
  for(const [key,val] of Object.entries(changes)){
    values.push(val);
    assignments.push(cols[key]+'=$'+values.length);
  }
  const result=await pool.query(`UPDATE blofy_xtream_items SET ${assignments.join(',')},updated_at=NOW()
    WHERE server_id=$1 AND media_type=$2 AND source_id=$3 RETURNING source_id`,values);
  if(!result.rowCount)throw Object.assign(new Error('xtream_item_not_found'),{status:404});
  return {updated:true};
}

export async function getXtreamStudioBranding(){
  await ensureReady();
  const row=(await pool.query('SELECT display_name,logo_mime,updated_at FROM blofy_xtream_studio_branding WHERE id=1')).rows[0];
  return {name:row?.display_name||'BLOFY STREAM',
    logoUrl:row?.logo_mime?'/xtream/studio-logo?v='+new Date(row.updated_at).getTime():null,
    updatedAt:row?.updated_at?new Date(row.updated_at).getTime():null};
}

async function setStudioName(value){
  const name=normalizeStudioName(value);
  await pool.query('UPDATE blofy_xtream_studio_branding SET display_name=$1,updated_at=NOW() WHERE id=1',[name]);
  return getXtreamStudioBranding();
}
async function storeStudioLogo(req){
  const {image,mime}=await readStudioLogoRequest(req);
  await pool.query('UPDATE blofy_xtream_studio_branding SET logo_mime=$1,logo_bytes=$2,updated_at=NOW() WHERE id=1',[mime,image]);
  return getXtreamStudioBranding();
}
async function removeStudioLogo(){
  await pool.query('UPDATE blofy_xtream_studio_branding SET logo_mime=NULL,logo_bytes=NULL,updated_at=NOW() WHERE id=1');
  return getXtreamStudioBranding();
}
async function serveStudioLogo(res){
  await ensureReady();
  const row=(await pool.query('SELECT logo_mime,logo_bytes FROM blofy_xtream_studio_branding WHERE id=1')).rows[0];
  if(!row?.logo_bytes)return json(res,404,{error:'studio_logo_not_found'});
  res.writeHead(200,{'content-type':row.logo_mime,'content-length':row.logo_bytes.length,
    'x-content-type-options':'nosniff','cache-control':'public, max-age=300'});
  return res.end(row.logo_bytes);
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

function sendControlHtml(res,content){
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'private, no-store',
    'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer'});
  res.end(content);
}
function controlRedirect(res,kind,value){
  const target=CONTROL_PATH+'?'+(kind==='error'?'error':'ok')+'='+encodeURIComponent(String(value||''));
  res.writeHead(303,{'location':target,'cache-control':'no-store'});
  res.end();
}
async function handleControlAction(req,res,id,action) {
  const available=['toggle-enabled','toggle-publish','test','smart-connection','probe-live','probe-movie','probe-series','probe-episode','sync-all','sync-live','sync-movie','sync-series','cancel-sync','save','delete'];
  if(id==='new'&&action==='add'){
    const fields=await readControlForm(req);
    if(fields.rightsConfirmed!=='yes')throw Object.assign(new Error('rights_confirmation_required'),{status:400});
    const item=await createServer({name:fields.name,baseUrl:fields.baseUrl,username:fields.username,
      password:fields.password,priority:fields.priority,enabled:true,publishCatalog:false});
    startSync(item.id,['live','movie','series']);
    return controlRedirect(res,'ok','added');
  }
  if(!validUuid(id)||!available.includes(action))
    throw Object.assign(new Error('xtream_control_action_invalid'),{status:400});
  const current=await serverById(id);
  if(!current)throw Object.assign(new Error('xtream_server_not_found'),{status:404});
  if(action==='toggle-enabled'){
    const next=!current.enabled;
    await patchServer(id,{enabled:next});
    return controlRedirect(res,'ok',next?'enabled':'paused');
  }
  if(action==='toggle-publish'){
    const next=!current.publish_catalog;
    await patchServer(id,{publishCatalog:next});
    return controlRedirect(res,'ok',next?'published':'hidden');
  }
  if(action==='delete'){
    const fields=await readControlForm(req);
    if(fields.confirmId!==id||fields.ack!=='yes')
      throw Object.assign(new Error('xtream_delete_confirmation_required'),{status:400});
    if(!await requestDeleteSource(id))
      throw Object.assign(new Error('xtream_server_not_found'),{status:404});
    return controlRedirect(res,'ok','deleted');
  }
  if(action==='save'){
    const fields=await readControlForm(req);
    const body={name:fields.name,baseUrl:fields.baseUrl,priority:fields.priority};
    if(fields.username?.trim())body.username=fields.username;
    if(fields.password?.trim())body.password=fields.password;
    await patchServer(id,body);
    return controlRedirect(res,'ok','saved');
  }
  if(action==='cancel-sync'){
    await cancelSourceSync(id);
    return controlRedirect(res,'ok','cancelled');
  }
  if(['probe-live','probe-movie','probe-series','probe-episode'].includes(action)){
    const mediaType=action.slice('probe-'.length);
    const result=await probeXtreamPlayback(id,mediaType);
    await persistSourceMediaProbe(id,mediaType,result);
    // Safe logging for later debugging: no source URLs, usernames, passwords,
    // episode IDs or movie titles. Logs help distinguish failed API from media.
    console.info('xtream source probe result',{
      sourceId:id,mediaType,ok:Boolean(result.ok),
      checks:(result.checks||[]).map(check=>({httpStatus:check.httpStatus,
        error:check.error||null,ok:Boolean(check.ok),episodeCount:check.episodeCount||0}))
    });
    return controlRedirect(res,result.ok?'ok':'error','probe:'+xtreamProbeMessage(result,mediaType));
  }
  if(action==='smart-connection'){
    const diagnosis=await runSmartConnection(id);
    smartConnectionResults.set(id,{...diagnosis,recordedAt:Date.now()});
    // Status-only redirect, never encode provider details in URL or logs.
    return controlRedirect(res,'ok','smart_checked');
  }
  if(action==='test'){
    // Never block a 15s proxy request on an upstream test that may take 20s.
    void testServer(id).catch(error=>console.warn('xtream direct check failed:',id,redactXtreamError(error)));
    return controlRedirect(res,'ok','testing');
  }
  if(!current.enabled)throw Object.assign(new Error('xtream_source_paused'),{status:409});
  const types=action==='sync-all'?['live','movie','series']:[action.slice('sync-'.length)];
  startSync(id,types);
  return controlRedirect(res,'ok','syncing');
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
      if (req.method === 'GET' && url.pathname === '/xtream/studio-logo') return serveStudioLogo(res);
      if (req.method === 'GET' && url.pathname === '/sources/xtream/summary') return publicJson(res, await publicSummary());
      if (req.method === 'GET' && url.pathname === '/sources/xtream/catalog') {
        return publicJson(res, { items: await listCatalog(Object.fromEntries(url.searchParams), true) });
      }
      // `/api/v1/admin/xtream-gateway/*` belongs to the dedicated BLOFY gateway
      // handler. Do not let this broader `/api/v1/admin/xtream` router swallow it.
      if (url.pathname.startsWith('/api/v1/admin/xtream-gateway')) return listener(req, res);
      if (!url.pathname.startsWith('/api/v1/admin/xtream')) return listener(req, res);
      if (!requireAdmin(req, res)) return;
      await ensureReady();

      // All Studio Pro calls inherit the existing admin authentication and
      // rate limit. Saved presentations do not expose upstream secrets.
      if(url.pathname.startsWith('/api/v1/admin/xtream/pro/')){
        const suffix=url.pathname.slice('/api/v1/admin/xtream/pro/'.length);
        if(suffix==='epg'&&req.method==='GET')
          return json(res,200,await previewAdminChannelEpg(url.searchParams.get('serverId'),url.searchParams.get('sourceId')));
        if(suffix==='overview'&&req.method==='GET')
          return json(res,200,await studioPro.overview(url.searchParams.get('serverId')));
        if(suffix==='bulk'&&req.method==='POST')
          return json(res,200,await studioPro.bulk(await readJson(req)));
        if(suffix==='snapshots'&&req.method==='GET')
          return json(res,200,{items:await studioPro.listSnapshots(url.searchParams.get('serverId'))});
        if(suffix==='snapshots'&&req.method==='POST'){
          const body=await readJson(req);
          return json(res,201,await studioPro.snapshot(body.serverId,body.label));
        }
        const restore=suffix.match(/^snapshots\/([0-9a-f-]+)\/restore$/i);
        if(restore&&req.method==='POST'){
          const body=await readJson(req);
          return json(res,200,await studioPro.restore(body.serverId,restore[1]));
        }
        if(suffix==='collections'&&req.method==='GET')
          return json(res,200,{items:await studioPro.collections(url.searchParams.get('serverId'))});
        if(suffix==='collections'&&req.method==='POST')
          return json(res,201,await studioPro.addCollection(await readJson(req)));
        const collection=suffix.match(/^collections\/([0-9a-f-]+)$/i);
        if(collection&&req.method==='DELETE')
          return json(res,200,await studioPro.deleteCollection(url.searchParams.get('serverId'),collection[1]));
        const schedule=suffix.match(/^schedule\/([0-9a-f-]+)$/i);
        if(schedule&&req.method==='GET')
          return json(res,200,await studioPro.schedule(schedule[1]));
        if(schedule&&req.method==='PUT')
          return json(res,200,await studioPro.setSchedule(schedule[1],await readJson(req)));
        return json(res,404,{error:'studio_pro_route_not_found'});
      }

      // Fully server-rendered, session-protected control plane. It works
      // when browser-side JavaScript/extensions block source button events.
      if(req.method==='GET' && url.pathname===CONTROL_PATH){
        const items=(await serverRows()).map(adminServer);
        return sendControlHtml(res,controlPage({
          items,success:url.searchParams.get('ok')||'',error:url.searchParams.get('error')||'',
          diagnostics:Object.fromEntries(items.map(item=>{
            const result=smartConnectionResults.get(item.id);
            return [item.id,result&&Date.now()-result.recordedAt<600_000?result:null];
          }).filter(([,result])=>result)),
          csrfToken:nativeXtreamCsrfToken(req,ADMIN_SESSION_KEY)
        }));
      }
      const nativeConfirm=url.pathname.match(/^\/api\/v1\/admin\/xtream\/controls\/([0-9a-f-]+)\/confirm-delete$/i);
      if(nativeConfirm&&req.method==='GET'){
        const source=await serverById(nativeConfirm[1]);
        if(!source)return json(res,404,{error:'xtream_server_not_found'});
        return sendControlHtml(res,deleteConfirmationPage(source,nativeXtreamCsrfToken(req,ADMIN_SESSION_KEY)));
      }
      const nativeAction=url.pathname.match(/^\/api\/v1\/admin\/xtream\/controls\/([a-z0-9-]+)\/(toggle-enabled|toggle-publish|test|smart-connection|probe-live|probe-movie|probe-series|probe-episode|sync-all|sync-live|sync-movie|sync-series|cancel-sync|save|delete|add)$/i);
      if(nativeAction&&req.method==='POST'){
        try{return await handleControlAction(req,res,nativeAction[1],nativeAction[2]);}
        catch(error){
          console.warn('xtream control failed:',redactXtreamError(error));
          return controlRedirect(res,'error',redactXtreamError(error));
        }
      }

      if(url.pathname==='/api/v1/admin/xtream/studio'){
        if(req.method==='GET')return json(res,200,await getXtreamStudioBranding());
        if(req.method==='PATCH'){
          const body=await readJson(req);
          return json(res,200,await setStudioName(body.name));
        }
      }
      if(url.pathname==='/api/v1/admin/xtream/studio/logo'){
        if(req.method==='PUT')return json(res,200,await storeStudioLogo(req));
        if(req.method==='DELETE')return json(res,200,await removeStudioLogo());
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream/servers') {
        const items = (await serverRows()).map(adminServer);
        const totals = items.reduce((acc, item) => {
          acc.servers++;
          acc.live += Number(item.counts.live || 0);
          acc.movie += Number(item.counts.movie || 0);
          acc.series += Number(item.counts.series || 0);
          if (item.status === 'online') acc.online++;
          if (item.syncing) acc.syncing++;
          if(item.status==='syncing'&&!item.syncing)acc.interrupted++;
          if(item.queued)acc.queued++;
          return acc;
        }, { servers: 0, online: 0, syncing: 0, queued: 0, interrupted: 0, live: 0, movie: 0, series: 0 });
        totals.total = totals.live + totals.movie + totals.series;
        return json(res, 200, { items, totals,csrfToken:nativeXtreamCsrfToken(req,ADMIN_SESSION_KEY) });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream/servers') {
        const item = await createServer(await readJson(req));
        return json(res, 201, { item });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream/categories/auto-sort') {
        const body=await readJson(req);
        return json(res,200,await autoSortCategories(body.serverId,body.mediaType,body.mode));
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream/categories') {
        return json(res, 200, { items: await listCategories(url.searchParams.get('serverId'), url.searchParams.get('type')) });
      }
      if(req.method==='GET'&&url.pathname==='/api/v1/admin/xtream/tmdb/status'){
        return json(res,200,{enabled:tmdbConfigured(),requiresCommercialLicense:true});
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/admin/xtream/catalog/insights') {
        return json(res,200,await previewCatalogInsights(
          url.searchParams.get('serverId'),url.searchParams.get('type')));
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
        const queued=[];
        const skipped=[];
        for (const row of rows.filter(item => item.enabled)) {
          if (syncQueue.has(row.id)||syncLocks.has(row.id)) continue;
          try{
            const job=startSync(row.id,['live','movie','series']);
            started.push(row.id);
            if(job.queued)queued.push(row.id);
          }catch(error){
            if(error.message==='xtream_sync_queue_full'){
              skipped.push(row.id);
              continue;
            }
            throw error;
          }
        }
        return json(res, 202, { started,queued,skipped });
      }

      const serverMatch = url.pathname.match(/^\/api\/v1\/admin\/xtream\/servers\/([0-9a-f-]+)(?:\/(test|smart-connection|sync|cancel-sync|probe-playback))?$/i);
      if (serverMatch) {
        const id = serverMatch[1];
        const action = serverMatch[2];
        if (!validUuid(id)) return json(res, 400, { error: 'xtream_server_id_invalid' });
        if (!action && req.method === 'PATCH') return json(res, 200, { item: await patchServer(id, await readJson(req)) });
        if (!action && req.method === 'DELETE') {
          const accepted = await requestDeleteSource(id);
          return json(res, accepted ? 202 : 404, accepted
            ? { deletionQueued: true, deletedFromCatalog: true }
            : { error: 'xtream_server_not_found' });
        }
        if (action === 'test' && req.method === 'POST') return json(res, 200, { item: await testServer(id) });
        if (action === 'smart-connection' && req.method === 'POST')
          return json(res,200,{diagnosis:await runSmartConnection(id)});
        if (action === 'probe-playback' && req.method === 'POST') {
          const body=await readJson(req);
          const mediaType=String(body.mediaType||'live');
          const result=await probeXtreamPlayback(id,mediaType);
          await persistSourceMediaProbe(id,mediaType,result);
          return json(res,200,result);
        }
        if (action === 'cancel-sync' && req.method === 'POST') {
          return json(res,200,await cancelSourceSync(id));
        }
        if (action === 'sync' && req.method === 'POST') {
          const body = await readJson(req);
          const types = Array.isArray(body.types) ? body.types : ['live','movie','series'];
          const selected=types.map(validType).filter(Boolean);
          const source=await serverById(id);
          if(!source)return json(res,404,{error:'xtream_server_not_found'});
          if(!source.enabled)return json(res,409,{error:'xtream_source_paused'});
          if(!selected.length)return json(res,400,{error:'xtream_sync_types_invalid'});
          const job=startSync(id,selected);
          return json(res, 202, { started: true, queued:job.queued,queuePosition:job.position,id,types:selected });
        }
      }

      const categoryMatch = url.pathname.match(/^\/api\/v1\/admin\/xtream\/categories\/([0-9a-f-]+)\/(live|movie|series)\/([^/]+)$/i);
      if (categoryMatch && req.method === 'PATCH') {
        const body = await readJson(req);
        if(body.direction!==undefined) {
          const result=await moveCategory(categoryMatch[1],categoryMatch[2].toLowerCase(),
            decodeURIComponent(categoryMatch[3]),body.direction);
          return json(res,200,{updated:true,...result});
        }
        if (body.enabled === undefined) return json(res, 400, { error: 'nothing_to_update' });
        await patchCategory(categoryMatch[1], categoryMatch[2].toLowerCase(), decodeURIComponent(categoryMatch[3]), body.enabled);
        return json(res, 200, { updated: true });
      }

      const tmdbMatch=url.pathname.match(/^\/api\/v1\/admin\/xtream\/items\/([0-9a-f-]+)\/(movie|series)\/([^/]+)\/tmdb-enrich$/i);
      if(tmdbMatch&&req.method==='POST'){
        return json(res,200,await enrichOneTmdbItem(tmdbMatch[1],
          tmdbMatch[2].toLowerCase(),decodeURIComponent(tmdbMatch[3])));
      }

      const enrichMatch=url.pathname.match(/^\/api\/v1\/admin\/xtream\/items\/([0-9a-f-]+)\/(movie|series)\/([^/]+)\/enrich$/i);
      if(enrichMatch&&req.method==='POST'){
        return json(res,200,await enrichOneXtreamItem(enrichMatch[1],
          enrichMatch[2].toLowerCase(),decodeURIComponent(enrichMatch[3])));
      }

      const studioItemMatch=url.pathname.match(/^\/api\/v1\/admin\/xtream\/items\/([0-9a-f-]+)\/(live|movie|series)\/([^/]+)\/studio$/i);
      if(studioItemMatch&&(req.method==='PATCH'||req.method==='DELETE')){
        return json(res,200,await updateStudioItem(studioItemMatch[1],
          studioItemMatch[2].toLowerCase(),decodeURIComponent(studioItemMatch[3]),
          req.method==='PATCH'?await readJson(req):null,req.method==='DELETE'));
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

export { ensureReady as ensureXtreamAdminReady };

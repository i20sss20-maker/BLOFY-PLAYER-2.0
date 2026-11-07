import { databaseOptions } from './database-options.mjs';
import { safeErrorSummary } from './diagnostics-sanitizer.mjs';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
import {ensureXtreamAdminReady,getXtreamStudioBranding} from './xtream-admin-hook.mjs';
import {
  assertPublicXtreamUrl,
  decryptXtreamSecret,
  normalizeXtreamBaseUrl,
  redactXtreamError,
  sanitizeXtreamAccount,
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
import { gatewayItemsPageQuery } from './xtream-gateway-query.mjs';
import { mergeXtreamPlayerRequest } from './xtream-player-post.mjs';
import { inspectXtreamMediaChunk } from './xtream-media-inspector.mjs';
import { readXtreamProviderDenialHint } from './xtream-provider-denial.mjs';
import { normalizeXtreamEpg } from './xtream-epg.mjs';
import { acceptsXtreamGzip } from './xtream-catalog-compression.mjs';
import { shouldRetryXtreamWithoutRange,firstByteXtreamRange } from './xtream-media-range.mjs';
import { recordXtreamPlayback,xtreamPlaybackSnapshot } from './xtream-playback-metrics.mjs';
import { XtreamDenialCooldown } from './xtream-denial-cooldown.mjs';
import { episodeOrdinal, verifiedEpisodeRecovery, sameEpisodeContainerCandidates } from './xtream-episode-repair.mjs';
import { authoritativeXtreamMediaCandidates, providerHasExactXtreamMediaItem } from './xtream-authoritative-media.mjs';
import { parseHybridM3uMediaUrl, verifiedHybridRow } from './xtream-hybrid-m3u.mjs';
import {canQuarantineXtreamMedia,MEDIA_QUARANTINE_HOURS,MEDIA_QUARANTINE_REASON,quarantineMediaWarning} from './xtream-media-quarantine.mjs';
import { xtreamEpisodePlaybackCandidates } from './xtream-series-probe.mjs';
import { MAX_ISSUANCE_SOURCES, PREFLIGHT_TTL_MS, issuanceErrorReason, summarizeIssuancePreflight, shouldRetryIssuanceMedia } from './xtream-issuance-preflight.mjs';

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
const episodeRepairCooldown = new Map();
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
      await client.query('ALTER TABLE blofy_xtream_gateway_accounts ADD COLUMN IF NOT EXISTS source_id UUID');
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
      // Keep original gateway IDs stable while recording provider-declared
      // season/episode identity and an optional verified replacement media ID.
      await client.query('ALTER TABLE blofy_xtream_gateway_episode_map ADD COLUMN IF NOT EXISTS season_number TEXT');
      await client.query('ALTER TABLE blofy_xtream_gateway_episode_map ADD COLUMN IF NOT EXISTS episode_number TEXT');
      await client.query('ALTER TABLE blofy_xtream_gateway_episode_map ADD COLUMN IF NOT EXISTS resolved_source_episode_id TEXT');
      // A validated playable extension must survive provider metadata refreshes
      // that still advertise a stale, non-playable filename suffix.
      await client.query('ALTER TABLE blofy_xtream_gateway_episode_map ADD COLUMN IF NOT EXISTS verified_container_extension TEXT');
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_gateway_accounts_user ON blofy_xtream_gateway_accounts(username,enabled)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_gateway_item_lookup ON blofy_xtream_gateway_item_map(server_id,media_type,source_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_blofy_xtream_gateway_episode_lookup ON blofy_xtream_gateway_episode_map(server_id,source_episode_id)');
      await client.query(`CREATE TABLE IF NOT EXISTS blofy_xtream_media_quarantine (
        server_id UUID NOT NULL REFERENCES blofy_xtream_servers(id) ON DELETE CASCADE,
        media_type TEXT NOT NULL CHECK (media_type IN ('movie','series')),
        source_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY(server_id,media_type,source_id)
      )`);
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

// Real, server-side pre-issuance checks, shared by preview AND both account
// creation routes. Never issue an account based on the UI's "online" badge.
const issuancePreflightCache=new Map();
const issuancePreflightRunning=new Map();

async function probeIssuanceMedia(row,kind,id,extension,deadline){
  if(Date.now()>=deadline-1000)return {kind,ok:false,reason:'preflight_time_budget'};
  const url=mediaUpstreamUrl(row,kind,id,extension);
  const signal=AbortSignal.timeout(Math.min(6500,Math.max(1000,deadline-Date.now())));
  let response,reader;
  const m3uEvidence={status:'not_checked'};
  const headers={
    'user-agent':'BLOFY-Issuance-Check/1.0',
    ...(kind==='live'?{}:{range:'bytes=0-2047'})
  };
  try{
    response=await checkedFetch(url,{method:'GET',headers,signal});
    if(shouldRetryXtreamWithoutRange({status:response.status,range:headers.range})){
      await response.body?.cancel().catch(()=>{});
      response=null;
      delete headers.range;
      response=await checkedFetch(url,{method:'GET',headers,signal});
    }
    if(response.status===404&&kind!=='live'&&Date.now()+3000<deadline){
      const fromM3u=await verifiedHybridM3uFallback(row,kind,id,{deadline,diagnostic:m3uEvidence});
      const verified=fromM3u?.verified?fromM3u:
        await verifiedOfficialMediaAlternative(row,kind,id,extension,{
          seriesSourceId:kind==='series'?row.series_source_id:null,
          providerPayload:kind==='series'?row.series_payload:null,
          deadline
        });
      if(verified?.verified){
        // Reuse actual verified bytes; do not issue a second expiring
        // preflight request and misreport a successful media URL as failed.
        return {kind,ok:true,reason:null,format:'provider_verified',
          repaired:true,recoveryMode:verified.mode};
      }
    }
    if(!response.ok || !response.body){
      return {kind,ok:false,reason:response.status===404?'upstream_http_404':
        response.status===403?'upstream_http_403':
        response.status===456?'upstream_http_456':'upstream_http_other',
        httpStatus:response.status,
        ...(response.status===404&&kind!=='live'?{m3uRecoveryStatus:m3uEvidence.status}:{})};
    }
    reader=response.body.getReader();
    const samples=[];
    let total=0;
    for(let n=0;n<6&&total<512;n++){
      const chunk=await reader.read();
      if(chunk.done)break;
      const bytes=Buffer.from(chunk.value||[]);
      if(!bytes.length)continue;
      const part=bytes.subarray(0,4096-total);
      samples.push(part);
      total+=part.length;
    }
    const evidence=inspectXtreamMediaChunk(Buffer.concat(samples,total),response.headers.get('content-type'));
    // Be conservative: unknown bytes cannot certify customer readiness.
    const ok=evidence.valid && evidence.format!=='unknown';
    return {kind,ok,reason:ok?null:(evidence.reason||'media_unverified'),
      format:ok?evidence.format:null};
  }catch(error){
    return {kind,ok:false,reason:signal.aborted?'timeout':issuanceErrorReason(error?.message)};
  }finally{
    try{await reader?.cancel()}catch{}
    try{reader?.releaseLock()}catch{}
    if(!reader)try{await response?.body?.cancel()}catch{}
  }
}


// One additional, bounded check for a temporary network error. 403/404/456
// remain hard failures; repeated failure never marks the source ready.
async function probeIssuanceWithTransientRetry(row,kind,id,extension,deadline){
  const first=await probeIssuanceMedia(row,kind,id,extension,deadline);
  if(first.ok||!shouldRetryIssuanceMedia(first,deadline-Date.now()))return first;
  await new Promise(resolve=>setTimeout(resolve,180));
  const second=await probeIssuanceMedia(row,kind,id,extension,deadline);
  return {...second,retried:true,firstFailureReason:first.reason};
}

// The authoritative Xtream API may provide a media URL for the exact requested
// VOD/episode even when the conventional /movie/... or /series/... path is 404.
// Never try unrelated titles, IDs, hosts, accounts or extension guesses.
// Check the media bytes *before* selecting any provider-declared alternative.
async function confirmProviderMediaUrl(url,{deadline=Date.now()+8500,diagnostic=null}={}){
  const timeLeft=deadline-Date.now();
  if(timeLeft<=1000){
    if(diagnostic)diagnostic.status='time_budget';
    return false;
  }
  const signal=AbortSignal.timeout(Math.min(8500,timeLeft));
  let response,reader;
  try{
    const headers={'user-agent':'BLOFY-Media-Verify/1.0',range:'bytes=0-2047'};
    response=await checkedFetch(url,{method:'GET',headers,signal});
    if(shouldRetryXtreamWithoutRange({status:response.status,range:headers.range})){
      await response.body?.cancel().catch(()=>{});
      response=null;
      delete headers.range;
      response=await checkedFetch(url,{method:'GET',headers,signal});
    }
    if(diagnostic)diagnostic.httpStatus=Number(response.status);
    if(!response.ok||!response.body){
      if(diagnostic)diagnostic.status=response.status===404?'provider_404':
        [401,403,456].includes(response.status)?'provider_denied':
        response.status===429?'provider_rate_limited':'provider_http_error';
      return false;
    }
    reader=response.body.getReader();
    const parts=[];
    let total=0;
    for(let i=0;i<6&&total<512;i++){
      const read=await reader.read();
      if(read.done)break;
      const part=Buffer.from(read.value||[]).subarray(0,512-total);
      if(part.length){parts.push(part);total+=part.length;}
    }
    if(!total){
      if(diagnostic)diagnostic.status='empty_media';
      return false;
    }
    const inspection=inspectXtreamMediaChunk(Buffer.concat(parts,total),
      response.headers.get('content-type'));
    const valid=inspection.valid&&inspection.format!=='unknown';
    if(diagnostic)diagnostic.status=valid?'verified':'non_video_bytes';
    return valid;
  }catch{
    if(diagnostic)diagnostic.status=signal.aborted?'provider_timeout':'provider_unreachable';
    return false;
  }finally{
    if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
    else try{await response?.body?.cancel()}catch{}
  }
}

// M3U Hybrid: the operator first indexes the linked same-account playlist.
// On a genuine 404, use only a non-ambiguous EXACT original provider ID,
// from this source's current index generation. Verify real video bytes
// through the same SSRF-checked client before changing a subscriber stream.
async function verifiedHybridM3uFallback(row,kind,sourceId,{deadline=Date.now()+8000,diagnostic=null}={}){
  const status=value=>{if(diagnostic)diagnostic.status=value;};
  if(!row?.m3u_index_generation){status('index_not_ready');return null;}
  if(!['movie','series'].includes(kind)){status('unsupported_type');return null;}
  if(Date.now()+1000>=deadline){status('time_budget');return null;}
  try{
    const match=(await pool.query(`SELECT generation,stream_url_secret,ambiguous
      FROM blofy_xtream_m3u_media_links
      WHERE server_id=$1 AND generation=$2 AND media_type=$3 AND source_id=$4
      LIMIT 1`,[row.server_id,row.m3u_index_generation,kind,String(sourceId)])).rows[0];
    if(!match){status('id_not_in_m3u');return null;}
    if(match.ambiguous){status('multiple_conflicting_m3u_links');return null;}
    if(!verifiedHybridRow(match,row.m3u_index_generation)){
      status('stale_index_entry');return null;
    }
    const creds=decryptServerCredentials(row);
    const textUrl=decryptXtreamSecret(match.stream_url_secret,KEY_HEX,
      `m3u-media:${row.server_id}:${row.m3u_index_generation}:${kind}:${sourceId}`);
    const parsed=parseHybridM3uMediaUrl(textUrl,{
      baseUrl:row.base_url,username:creds.username,password:creds.password
    });
    if(!parsed||parsed.kind!==kind||parsed.sourceId!==String(sourceId)){
      status('m3u_link_identity_invalid');return null;
    }
    const url=new URL(parsed.url);
    const probe={};
    if(!await confirmProviderMediaUrl(url,{deadline,diagnostic:probe})){
      status(probe.status||'m3u_media_unverified');
      return null;
    }
    status('verified');
    console.info('xtream verified same-source M3U media',{kind,mode:'m3u'});
    return {url,mode:'m3u',verified:true};
  }catch{
    // No provider URL, token, credentials, or source playlist is logged.
    status('m3u_check_unavailable');
    return null;
  }
}

async function verifiedOfficialMediaAlternative(row,kind,sourceId,currentExtension,
  {seriesSourceId=null,providerPayload=null,deadline=Date.now()+11000}={}){
  if(!['movie','series'].includes(kind)||Date.now()+1000>=deadline)return null;
  let payload=providerPayload;
  try{
    if(!payload){
      if(kind==='series'&&!seriesSourceId)return null;
      payload=await fetchUpstreamApi(row,
        kind==='movie'?'get_vod_info':'get_series_info',
        kind==='movie'?{vod_id:String(sourceId)}:{series_id:String(seriesSourceId)},
        {timeoutMs:Math.min(5500,Math.max(1000,deadline-Date.now())),maxBytes:3_000_000});
    }
    // Never probe guessed IDs or substitute content: the provider must still
    // list precisely this movie or episode under the requesting account.
    if(!providerHasExactXtreamMediaItem(payload,{kind,itemId:String(sourceId)}))
      return null;
    const candidates=authoritativeXtreamMediaCandidates(payload,{
      kind,itemId:String(sourceId),baseUrl:row.base_url,currentExtension
    });
    // Some providers keep advertising .mp4 although the exact original ID
    // is stored as .mkv or TS. Earlier this fallback existed only in the
    // player-side series repair, not in movie relay or pre-issue QA, yielding
    // false 404s. Try at most two other containers for the SAME provider ID.
    const tested=new Set(candidates
      .filter(item=>item.kind==='provider_extension')
      .map(item=>item.extension));
    for(const candidate of sameEpisodeContainerCandidates(currentExtension)){
      if(!tested.has(candidate)){
        candidates.push({kind:'same_id_container',extension:candidate});
        tested.add(candidate);
      }
    }
    for(const item of candidates){
      if(Date.now()+1000>=deadline)break;
      const url=item.kind==='provider_direct'?new URL(item.url):
        mediaUpstreamUrl(row,kind,sourceId,item.extension);
      if(await confirmProviderMediaUrl(url,{deadline})){
        console.info('xtream verified provider media fallback',{kind,mode:item.kind});
        return {url,mode:item.kind,verified:true};
      }
    }
  }catch(error){
    // Never log metadata payloads, upstream URLs, accounts or media tokens.
    console.warn('xtream provider media fallback unavailable',{
      kind,reason:issuanceErrorReason(error?.message)
    });
  }
  return null;
}

// The only identifiers revealed in an authenticated operator's failed probe
// are sanitized catalog IDs. Never return source host, media URL or credentials.
function diagnosticXtreamItemId(id){
  const value=String(id??'');
  return /^[A-Za-z0-9._-]{1,128}$/.test(value)?value:null;
}

// Quarantine one CONFIRMED missing asset for six hours; does not mutate
// the imported catalog. A source denial or missing index is never enough.
async function quarantineConfirmedMissingMedia(row,kind,id,probe){
  if(!canQuarantineXtreamMedia({kind,sourceId:id,probe}))return false;
  const result=await pool.query(`INSERT INTO blofy_xtream_media_quarantine
    (server_id,media_type,source_id,reason,confirmed_at,expires_at)
    VALUES($1,$2,$3,$4,NOW(),NOW()+($5::integer*INTERVAL '1 hour'))
    ON CONFLICT(server_id,media_type,source_id) DO UPDATE
    SET reason=EXCLUDED.reason,confirmed_at=NOW(),expires_at=EXCLUDED.expires_at
    RETURNING source_id`,
    [row.server_id,kind,String(id),MEDIA_QUARANTINE_REASON,MEDIA_QUARANTINE_HOURS]);
  return result.rowCount>0;
}

async function preflightSource(row,deadline){
  const checks=[];
  const result={sourceId:row.id,name:String(row.name||'Xtream').slice(0,90),checks,warnings:[]};
  try{
    const timeoutMs=Math.min(6000,Math.max(1000,deadline-Date.now()));
    if(timeoutMs<=1000){checks.push({kind:'account',ok:false,reason:'preflight_time_budget'});return result;}
    const account=await fetchUpstreamApi(row,null,{},{
      timeoutMs,maxBytes:200_000
    });
    if(!sanitizeXtreamAccount(account).authenticated){
      checks.push({kind:'account',ok:false,reason:'source_auth_denied'});
      return result;
    }
    checks.push({kind:'account',ok:true});
  }catch(error){
    checks.push({kind:'account',ok:false,reason:issuanceErrorReason(error?.message)});
    return result;
  }
  let found=0;
  for(const kind of ['live','movie','series']){
    if(Date.now()>deadline-1000){
      checks.push({kind:'preflight',ok:false,reason:'preflight_time_budget'});
      return result;
    }
    // Do not judge a 330k-title catalog from its first two lexicographic
    // IDs. Sample BOTH ends of the current imported index, preserving strict
    // fail-closed readiness. These are ID bands, not publication dates.
    let rows;
    try{
      const pick=direction=>pool.query(`SELECT source_id,container_extension
        FROM blofy_xtream_items
        WHERE server_id=$1 AND media_type=$2 AND enabled=TRUE
          AND ($2<>'movie' OR NOT EXISTS (SELECT 1
            FROM blofy_xtream_media_quarantine q
            WHERE q.server_id=blofy_xtream_items.server_id
              AND q.media_type='movie' AND q.source_id=blofy_xtream_items.source_id
              AND q.expires_at>NOW()))
        ORDER BY source_id ${direction} LIMIT 1`,[row.id,kind]);
      const [first,last]=await Promise.all([pick('ASC'),pick('DESC')]);
      rows=[
        ...first.rows.map(item=>({...item,sampleBand:'low_id'})),
        ...last.rows.filter(item=>!first.rows.some(firstItem=>
          firstItem.source_id===item.source_id)).map(item=>({...item,sampleBand:'high_id'}))
      ];
    }catch{
      checks.push({kind,ok:false,reason:'catalog_unavailable'});
      continue;
    }
    if(!rows.length)continue;
    found++;
    if(kind==='series'){
      // Never hammer a slow provider by walking 12 adjacent (often broken)
      // series IDs. Sample distinct seasons/positions within each series first,
      // omit exact episodes already quarantined, then use a small mix of low-
      // and high-ID series. A new account still requires two ACTUAL verified
      // episode streams (no 404 or skipped item counts as a success).
      const needed=rows.length;
      let sampled=0,loadedSubstitutes=false,inspectedSeries=0,metadataFailures=0;
      const inspected=new Set(),maxSeriesToInspect=8;
      const loadSubstitutes=async()=>{
        if(loadedSubstitutes)return;
        loadedSubstitutes=true;
        try{
          const directions=['ASC','DESC'];
          const [low,high]=await Promise.all(directions.map(direction=>
            pool.query(`SELECT source_id,container_extension
              FROM blofy_xtream_items
              WHERE server_id=$1 AND media_type='series' AND enabled=TRUE
              ORDER BY source_id ${direction} LIMIT 5`,[row.id])));
          // Interleave instead of repeatedly picking neighboring high IDs:
          // 9959/9958/9957 can all be from the same broken provider batch.
          for(let i=0;i<5;i++){
            for(const candidate of [low.rows[i],high.rows[i]]){
              if(candidate&&!rows.some(x=>x.source_id===candidate.source_id))
                rows.push({...candidate,sampleBand:'replacement'});
            }
          }
        }catch{
          // Do not assume the library is healthy when a replacement query fails.
        }
      };
      seriesLoop:for(const seriesRow of rows){
        if(sampled>=needed||inspectedSeries>=maxSeriesToInspect)break;
        const seriesId=String(seriesRow.source_id);
        if(inspected.has(seriesId))continue;
        inspected.add(seriesId);
        inspectedSeries++;
        if(Date.now()>deadline-3500)break;
        let payload,samples;
        try{
          payload=await fetchUpstreamApi(row,'get_series_info',
            {series_id:seriesId},{
              timeoutMs:Math.min(seriesRow.sampleBand==='replacement'?3500:5500,
                Math.max(1000,deadline-Date.now()-1200)),
              maxBytes:3_000_000
            });
          samples=xtreamEpisodePlaybackCandidates(payload,3);
        }catch(error){
          const reason=issuanceErrorReason(error?.message);
          if(seriesRow.sampleBand==='replacement'){
            metadataFailures++;
            // A single slow upstream must not produce a dozen identically
            // worded red errors. Preserve a fail-closed summary below.
            result.warnings.push({reason:'series_replacement_unavailable',
              seriesSourceId:diagnosticXtreamItemId(seriesId)});
            if(metadataFailures>=2)break;
            continue;
          }
          checks.push({kind,ok:false,reason,
            sampleBand:seriesRow.sampleBand,
            seriesSourceId:diagnosticXtreamItemId(seriesId)});
          await loadSubstitutes();
          continue;
        }
        if(!samples.length){
          result.warnings.push({reason:'series_has_no_episodes',
            seriesSourceId:diagnosticXtreamItemId(seriesId)});
          await loadSubstitutes();
          continue;
        }
        const ids=samples.map(sample=>String(sample.id));
        let quarantined=new Set();
        try{
          const blocked=(await pool.query(`SELECT source_id
            FROM blofy_xtream_media_quarantine
            WHERE server_id=$1 AND media_type='series' AND expires_at>NOW()
              AND source_id=ANY($2::text[])`,[row.id,ids])).rows;
          quarantined=new Set(blocked.map(x=>String(x.source_id)));
        }catch{
          // If isolation state is unreadable, require verified playback rather
          // than trusting a potentially stale untested quarantine mark.
        }
        let seriesPassed=false;
        for(const sample of samples){
          if(Date.now()>deadline-1800)break;
          if(quarantined.has(String(sample.id))){
            if(result.warnings.length<12)result.warnings.push(
              quarantineMediaWarning('series',sample.id,{seriesId}));
            continue;
          }
          const probe=await probeIssuanceWithTransientRetry({
            ...row,series_source_id:seriesId,series_payload:payload
          },'series',sample.id,sample.extension,deadline);
          if(await quarantineConfirmedMissingMedia(row,'series',sample.id,probe)){
            if(result.warnings.length<12)result.warnings.push(
              quarantineMediaWarning('series',sample.id,{seriesId}));
            continue;
          }
          if(probe.ok){
            sampled++;
            checks.push({...probe,sampleBand:seriesRow.sampleBand});
            seriesPassed=true;
            break;
          }
          // Permission failures must always block issuance, even if a later
          // unrelated episode works; do not probe more IDs around 403/456.
          if([401,403,456].includes(Number(probe.httpStatus))){
            checks.push({...probe,sampleBand:seriesRow.sampleBand,
              seriesSourceId:diagnosticXtreamItemId(seriesId),
              episodeSourceId:diagnosticXtreamItemId(sample.id)});
            break seriesLoop;
          }
          if(seriesRow.sampleBand!=='replacement'){
            checks.push({...probe,sampleBand:seriesRow.sampleBand,
              seriesSourceId:diagnosticXtreamItemId(seriesId),
              episodeSourceId:diagnosticXtreamItemId(sample.id)});
          }
          // Try another episode (same series), never a guessed media ID.
        }
        if(!seriesPassed)await loadSubstitutes();
      }
      // Initial explicit failing video checks are already hard failures.
      // Add one summary only when quarantined/empty/replacement samples have
      // left us short of the required number of verified episodes.
      if(sampled<needed&&!checks.some(check=>check.kind==='series'&&check.ok===false))
        checks.push({kind:'series',ok:false,
          reason:Date.now()>deadline-1800?'preflight_time_budget':'series_sample_unavailable'});
    }else if(kind==='live'){
      const results=await Promise.all(rows.map(async sample=>{
        const probe=await probeIssuanceWithTransientRetry(row,kind,
          sample.source_id,'ts',deadline);
        return {...probe,sampleBand:sample.sampleBand,
          ...(probe.ok?{}:{itemSourceId:diagnosticXtreamItemId(sample.source_id)})};
      }));
      checks.push(...results);
    }else{
      // A movie missing from both Xtream and its exact M3U link is isolated,
      // not counted as a successfully played film. Require new VERIFIED
      // movies to replace quarantined samples before issuing any account.
      const required=rows.length;
      let tested=0,loadedSubstitutes=false;
      const seen=new Set();
      for(const sample of rows){
        if(tested>=required)break;
        if(seen.has(String(sample.source_id)))continue;
        seen.add(String(sample.source_id));
        if(Date.now()>deadline-1000)break;
        const ext=safeGatewayExtension(sample.container_extension,'mp4');
        const probe=await probeIssuanceWithTransientRetry(row,kind,
          sample.source_id,ext,deadline);
        if(await quarantineConfirmedMissingMedia(row,'movie',sample.source_id,probe)){
          result.warnings.push(quarantineMediaWarning('movie',sample.source_id));
          if(!loadedSubstitutes){
            loadedSubstitutes=true;
            try{
              const more=(await pool.query(`SELECT source_id,container_extension
                FROM blofy_xtream_items
                WHERE server_id=$1 AND media_type='movie' AND enabled=TRUE
                  AND NOT EXISTS (SELECT 1 FROM blofy_xtream_media_quarantine q
                    WHERE q.server_id=blofy_xtream_items.server_id
                      AND q.media_type='movie'
                      AND q.source_id=blofy_xtream_items.source_id
                      AND q.expires_at>NOW())
                ORDER BY source_id DESC LIMIT 12`,[row.id])).rows;
              for(const candidate of more){
                if(!rows.some(x=>x.source_id===candidate.source_id))
                  rows.push({...candidate,sampleBand:'replacement'});
              }
            }catch{
              // A failed catalog read can never turn a 404 into readiness.
            }
          }
          continue;
        }
        tested++;
        checks.push({...probe,sampleBand:sample.sampleBand,
          ...(probe.ok?{}:{itemSourceId:diagnosticXtreamItemId(sample.source_id)})});
      }
      if(tested<required)checks.push({kind:'movie',ok:false,
        reason:'media_sample_unavailable'});
    }
  }
  if(!found)checks.push({kind:'catalog',ok:false,reason:'source_catalog_empty'});
  return result;
}

async function runIssuancePreflight(sourceId){
  await ensureReady();
  const started=Date.now(),deadline=started+40_000;
  const rows=(await pool.query(`SELECT id,id AS server_id,name,base_url,username_secret,password_secret,m3u_index_generation
    FROM blofy_xtream_servers
    WHERE enabled=TRUE AND publish_catalog=TRUE AND deletion_requested_at IS NULL
      AND ($1::uuid IS NULL OR id=$1::uuid)
    ORDER BY priority,id LIMIT $2`,
    [sourceId,MAX_ISSUANCE_SOURCES+1])).rows;
  if(!rows.length)return {ready:false,passed:0,failed:1,
    sourceCount:0,mediaSampleCount:0,reason:'no_published_sources',sources:[]};
  if(rows.length>MAX_ISSUANCE_SOURCES)return {ready:false,passed:0,failed:1,
    sourceCount:rows.length,mediaSampleCount:0,reason:'too_many_sources_select_one',sources:[]};
  const sources=[];
  // At most two sources concurrently. Never flood a provider with unlimited
  // media checks, especially for all-sources subscriptions.
  for(let i=0;i<rows.length;i+=2){
    const batch=await Promise.all(rows.slice(i,i+2).map(row=>preflightSource(row,deadline)));
    sources.push(...batch);
  }
  const summary=summarizeIssuancePreflight(sources);
  return {...summary,ready:summary.ready&&Date.now()<=deadline,
    sources,checkedAt:new Date().toISOString(),elapsedMs:Date.now()-started,
    note:'First media bytes were sampled; no test can guarantee every title or future availability.'};
}

async function issuancePreflight(sourceId,{refresh=false}={}){
  const key=String(sourceId||'*');
  const cached=issuancePreflightCache.get(key);
  if(cached && Date.now()-cached.checkedAt<(refresh?15_000:PREFLIGHT_TTL_MS))
    return cached.result;
  if(issuancePreflightRunning.has(key))return issuancePreflightRunning.get(key);
  const task=runIssuancePreflight(sourceId).then(result=>{
    issuancePreflightCache.set(key,{checkedAt:Date.now(),result});
    while(issuancePreflightCache.size>25)
      issuancePreflightCache.delete(issuancePreflightCache.keys().next().value);
    return result;
  }).finally(()=>issuancePreflightRunning.delete(key));
  issuancePreflightRunning.set(key,task);
  return task;
}

async function assertIssuanceReady(sourceId){
  const verdict=await issuancePreflight(sourceId);
  if(!verdict.ready)
    throw Object.assign(new Error('xtream_gateway_issuance_preflight_failed'),{status:409});
  return verdict;
}

async function createAccount(body, req) {
  await ensureReady();
  const label = cleanLabel(body.label, 'BLOFY Player');
  const sourceId=await checkedAccountSourceId(body.sourceId);
  await assertIssuanceReady(sourceId);
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
      const row = (await pool.query(`INSERT INTO blofy_xtream_gateway_accounts(id,label,username,password_proof,enabled,max_connections,expires_at,source_id)
        VALUES($1,$2,$3,$4,TRUE,$5,$6,$7) RETURNING *`, [id,label,username,proof,maxConnections,expiresAt,sourceId])).rows[0];
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
  await assertIssuanceReady(sourceId);
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
      const accountLabel=count===1?label:`${label} ${String(i+1).padStart(2,'0')}`;
      const row=(await connection.query(`INSERT INTO blofy_xtream_gateway_accounts(id,label,username,password_proof,enabled,max_connections,expires_at,source_id)
        VALUES($1,$2,$3,$4,TRUE,$5,$6,$7) RETURNING *`,[
        id,accountLabel,username,proof,maxConnections,expiresAt,sourceId
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
  let lastId = 0;
  for (;;) {
    const page=gatewayItemsPageQuery(mediaType,lastId,{filter,sourceId});
    const rows=(await pool.query(page)).rows;
    if (!rows.length) break;
    for (const row of rows) await onRow(row);
    lastId = Number(rows[rows.length - 1].gateway_id);
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
      cm.gateway_id AS category_gateway_id,s.base_url,s.username_secret,s.password_secret,
      s.m3u_index_generation,s.enabled AS server_enabled
    FROM blofy_xtream_gateway_item_map m
    JOIN blofy_xtream_items i ON i.server_id=m.server_id AND i.media_type=m.media_type AND i.source_id=m.source_id
    JOIN blofy_xtream_servers s ON s.id=i.server_id
    LEFT JOIN blofy_xtream_categories c ON c.server_id=i.server_id AND c.media_type=i.media_type AND c.source_category_id=i.category_id
    LEFT JOIN blofy_xtream_gateway_category_map cm ON cm.server_id=i.server_id AND cm.media_type=i.media_type AND cm.source_category_id=i.category_id
    WHERE m.gateway_id=$1 AND m.media_type=$2 AND i.enabled=TRUE AND s.enabled=TRUE AND s.publish_catalog=TRUE AND (c.enabled IS NULL OR c.enabled=TRUE)
      AND ($3::uuid IS NULL OR i.server_id=$3::uuid)
      AND ($2 <> 'movie' OR NOT EXISTS (
        SELECT 1 FROM blofy_xtream_media_quarantine q
        WHERE q.server_id=i.server_id AND q.media_type='movie'
          AND q.source_id=i.source_id AND q.expires_at>NOW()
      ))`, [id,mediaType,sourceId])).rows[0] || null;
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

async function fetchUpstreamApi(row, action, extra = {}, {timeoutMs=45000,maxBytes=12_000_000}={}) {
  const creds = decryptServerCredentials(row);
  const response = await checkedFetch(xtreamApiUrl(row.base_url, creds.username, creds.password, action, extra), {
    timeoutMs,
    headers: { accept: 'application/json', 'user-agent': 'BLOFY-Xtream-Gateway/1.0' }
  });
  if (!response.ok) throw new Error(`xtream_gateway_upstream_${response.status}`);
  const chunks=[];let count=0;
  try{
    if(!response.body)throw new Error('xtream_gateway_upstream_json_invalid');
    for await(const piece of response.body){
      count+=piece.byteLength;
      if(count>maxBytes)throw new Error('xtream_gateway_info_too_large');
      chunks.push(Buffer.from(piece));
    }
    return JSON.parse(Buffer.concat(chunks,count).toString('utf8'));
  }catch(error){
    if(error?.message==='xtream_gateway_info_too_large')throw error;
    throw new Error('xtream_gateway_upstream_json_invalid');
  }finally{
    await response.body?.cancel().catch(()=>{});
  }
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
  await pool.query(`INSERT INTO blofy_xtream_gateway_episode_map
    (server_id,series_source_id,source_episode_id,container_extension,season_number,episode_number)
    SELECT $1::uuid,$2::text,x.source_id,x.container_extension,x.season_number,x.episode_number
    FROM jsonb_to_recordset($3::jsonb) AS x(
      source_id text,container_extension text,season_number text,episode_number text)
    ON CONFLICT(server_id,series_source_id,source_episode_id) DO UPDATE
      SET verified_container_extension=CASE
            WHEN blofy_xtream_gateway_episode_map.container_extension IS DISTINCT FROM EXCLUDED.container_extension
            THEN NULL ELSE blofy_xtream_gateway_episode_map.verified_container_extension END,
          container_extension=EXCLUDED.container_extension,
          season_number=COALESCE(EXCLUDED.season_number,blofy_xtream_gateway_episode_map.season_number),
          episode_number=COALESCE(EXCLUDED.episode_number,blofy_xtream_gateway_episode_map.episode_number)`,
    [serverId, String(seriesSourceId), JSON.stringify(unique.map(item => ({
      source_id:item.sourceId,container_extension:item.extension,
      season_number:item.seasonNumber,episode_number:item.episodeNumber
    })))]);
  const ids = unique.map(item => item.sourceId);
  const rows = (await pool.query(`SELECT gateway_id,source_episode_id,
      COALESCE(verified_container_extension,container_extension) AS container_extension
    FROM blofy_xtream_gateway_episode_map
    WHERE server_id=$1 AND series_source_id=$2 AND source_episode_id=ANY($3::text[])`, [serverId,String(seriesSourceId),ids])).rows;
  return new Map(rows.map(row => [String(row.source_episode_id), { id: Number(row.gateway_id), extension: safeGatewayExtension(row.container_extension, 'mp4') }]));
}

async function seriesInfo(gatewayId, sourceId=null) {
  const row = await gatewayItemById('series', gatewayId, sourceId);
  if (!row || !row.server_enabled) return null;
  const raw = await fetchUpstreamApi(row, 'get_series_info', { series_id: row.source_id });
  const payload = stripUpstreamSecrets(raw);
  const sourceEpisodes = [];
  if (raw?.episodes && typeof raw.episodes === 'object') {
    for (const [seasonLabel,list] of Object.entries(raw.episodes)) {
      if (!Array.isArray(list)) continue;
      const seasonNumber=episodeOrdinal(seasonLabel,{allowZero:true});
      for (const episode of list) {
        if (!episode || episode.id == null) continue;
        sourceEpisodes.push({
          sourceId:String(episode.id),
          extension:safeGatewayExtension(episode.container_extension,'mp4'),
          seasonNumber,episodeNumber:episodeOrdinal(episode.episode_num)
        });
      }
    }
  }
  const mapped = await ensureEpisodeMaps(row.server_id, row.source_id, sourceEpisodes);
  const hiddenEpisodeIds=new Set();
  if(sourceEpisodes.length){
    const ids=[...new Set(sourceEpisodes.map(item=>item.sourceId))];
    const active=(await pool.query(`SELECT source_id
      FROM blofy_xtream_media_quarantine
      WHERE server_id=$1 AND media_type='series' AND expires_at>NOW()
        AND source_id=ANY($2::text[])`,[row.server_id,ids])).rows;
    for(const unavailable of active)hiddenEpisodeIds.add(String(unavailable.source_id));
  }
  const episodes = {};
  if (raw?.episodes && typeof raw.episodes === 'object') {
    for (const [season, list] of Object.entries(raw.episodes)) {
      if (!Array.isArray(list)) continue;
      episodes[season] = list.filter(episode=>!hiddenEpisodeIds.has(String(episode?.id)))
        .map(episode => {
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

async function episodeByGatewayId(gatewayId,sourceId=null) {
  const id = Number(gatewayId);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return (await pool.query(`SELECT e.gateway_id,e.server_id,e.series_source_id,e.source_episode_id,e.resolved_source_episode_id,
      e.season_number,e.episode_number,COALESCE(e.verified_container_extension,e.container_extension) AS container_extension,
      s.base_url,s.username_secret,s.password_secret,s.m3u_index_generation,
      s.enabled AS server_enabled
    FROM blofy_xtream_gateway_episode_map e JOIN blofy_xtream_servers s ON s.id=e.server_id
    WHERE e.gateway_id=$1 AND s.enabled=TRUE AND s.publish_catalog=TRUE
      AND ($2::uuid IS NULL OR e.server_id=$2::uuid)
      AND NOT EXISTS (SELECT 1 FROM blofy_xtream_media_quarantine q
        WHERE q.server_id=e.server_id AND q.media_type='series'
          AND q.source_id=COALESCE(e.resolved_source_episode_id,e.source_episode_id)
          AND q.expires_at>NOW())`, [id,sourceId])).rows[0] || null;
}

// Refresh a stale episode extension only after a real provider 404, using
// this same series' official get_series_info. Bounded to one repair per item
// per 90 seconds to avoid repeated expensive calls and traffic spikes.
// Check actual video bytes before accepting a changed provider episode ID.
// This is never a blind redirect, host switch, or unauthorised fallback.
async function confirmEpisodeReplacement(row,providerId,extension){
  const url=mediaUpstreamUrl(row,'series',providerId,extension);
  const signal=AbortSignal.timeout(8500);
  let response,reader;
  try{
    let headers={'user-agent':'BLOFY-Media-Diagnostics/1.0',range:'bytes=0-2047'};
    response=await checkedFetch(url,{method:'GET',headers,signal});
    if(shouldRetryXtreamWithoutRange({status:response.status,range:headers.range})){
      await response.body?.cancel().catch(()=>{});
      response=null;
      headers={'user-agent':'BLOFY-Media-Diagnostics/1.0'};
      response=await checkedFetch(url,{method:'GET',headers,signal});
    }
    if(!response.ok||!response.body)return false;
    reader=response.body.getReader();
    const parts=[];
    let total=0;
    for(let n=0;n<6 && total<512;n++){
      const chunk=await reader.read();
      if(chunk.done)break;
      if(!chunk.value?.byteLength)continue;
      const sample=Buffer.from(chunk.value).subarray(0,4096-total);
      parts.push(sample);
      total+=sample.byteLength;
    }
    if(!total)return false;
    const inspection=inspectXtreamMediaChunk(Buffer.concat(parts,total),response.headers.get('content-type'));
    // Recovery must never persist a blank response, HTML or unrecognized
    // binary as a verified replacement for a stable subscriber video ID.
    return inspection.valid && inspection.format!=='unknown';
  }catch{return false;}
  finally{
    if(reader){try{await reader.cancel()}catch{}try{reader.releaseLock()}catch{}}
    else{try{await response?.body?.cancel()}catch{}}
  }
}

// Repair only against current, authoritative get_series_info metadata.
// Previously unknown episode identities are never guessed or replaced.
async function repairEpisodeOn404(row){
  if(!row?.series_source_id||!row?.source_episode_id)return {status:'unavailable'};
  const key=String(row.server_id)+':'+String(row.gateway_id);
  const now=Date.now();
  if((episodeRepairCooldown.get(key)||0)>now)return {status:'cooldown'};
  episodeRepairCooldown.delete(key);
  episodeRepairCooldown.set(key,now+90000);
  while(episodeRepairCooldown.size>600)
    episodeRepairCooldown.delete(episodeRepairCooldown.keys().next().value);
  try{
    const series=await fetchUpstreamApi(row,'get_series_info',{
      series_id:row.series_source_id
    },{timeoutMs:7000,maxBytes:3_000_000});
    const currentId=row.resolved_source_episode_id||row.source_episode_id;
    // Provider-provided direct_source and exact episode container metadata
    // are checked first; an upstream 404 is not proof that all valid provider
    // media paths have disappeared.
    const official=await verifiedOfficialMediaAlternative(row,'series',currentId,
      safeGatewayExtension(row.container_extension,'mp4'),{
        providerPayload:series,seriesSourceId:row.series_source_id,
        deadline:Date.now()+9000
      });
    if(official)return {status:'provider_verified',url:official.url};
    const decision=verifiedEpisodeRecovery(series,currentId,
      safeGatewayExtension(row.container_extension,'mp4'),
      row.season_number,row.episode_number);
    if(decision.status==='missing'&&
       (episodeOrdinal(row.season_number,{allowZero:true})===null||
        episodeOrdinal(row.episode_number)===null)){
      return {status:'position_unknown'};
    }
    if(decision.status==='unchanged'){
      const currentExtension=safeGatewayExtension(row.container_extension,'mp4');
      const currentId=row.resolved_source_episode_id||row.source_episode_id;
      // A provider can keep advertising mp4 but serve this exact episode as
      // mkv (or ts). Try only two bounded same-ID formats after a real 404.
      for(const candidate of sameEpisodeContainerCandidates(currentExtension)){
        if(!await confirmEpisodeReplacement(row,currentId,candidate))continue;
        const verified=await pool.query(`UPDATE blofy_xtream_gateway_episode_map
          SET verified_container_extension=$4
          WHERE gateway_id=$1 AND server_id=$2 AND source_episode_id=$3
          RETURNING gateway_id`,
          [row.gateway_id,row.server_id,row.source_episode_id,candidate]);
        if(verified.rowCount){
          return {status:'alternate_extension',extension:candidate};
        }
      }
      return {status:'catalog_media_mismatch'};
    }
    if(decision.status!=='changed'&&decision.status!=='relocated')return decision;
    if(decision.status==='relocated' &&
       !await confirmEpisodeReplacement(row,decision.sourceId,decision.extension))
      return {status:'replacement_unplayable'};
    const changed=await pool.query(`UPDATE blofy_xtream_gateway_episode_map
      SET container_extension=CASE WHEN $5::text IS NULL THEN $4 ELSE container_extension END,
          verified_container_extension=CASE WHEN $5::text IS NULL THEN NULL ELSE $4 END,
          resolved_source_episode_id=COALESCE($5::text,resolved_source_episode_id)
      WHERE gateway_id=$1 AND server_id=$2 AND source_episode_id=$3
      RETURNING gateway_id`,
      [row.gateway_id,row.server_id,row.source_episode_id,decision.extension,
        decision.status==='relocated'?decision.sourceId:null]);
    if(!changed.rowCount)return {status:'unavailable'};
    return decision;
  }catch(error){
    const hint=String(error?.message||'');
    const match=hint.match(/^xtream_gateway_upstream_(401|403|404|429|456|500|502|503|504)$/);
    return {status:match?'metadata_upstream_'+match[1]:'metadata_unavailable'};
  }
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
    sourceId = row.resolved_source_episode_id || row.source_episode_id;
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
  // A rejected individual channel cannot block another channel or source.
  // This is an in-memory guard against repeat viewer requests, not a way
  // around the provider's permissions. Only verified 403/456 trigger it.
  const cooldownKey=String(row.server_id)+':'+kind+':'+String(gatewayId);
  const observe=(phase,details={})=>{
    if(req.method!=='HEAD')recordXtreamPlayback({kind,itemId:gatewayId,phase,...details});
  };
  if(req.method!=='HEAD'){
    const rejection=mediaDenialCooldown.active(cooldownKey);
    if(rejection){
      observe('failed',{upstreamStatus:rejection.status,reason:'upstream_denial_cooldown'});
      return text(res,502,'Upstream playback temporarily unavailable','text/plain; charset=utf-8',
        {'retry-after':String(rejection.retryAfterSeconds)});
    }
  }
  // Keep each viewer's stream independent. Only retry failures before video bytes reach them.
  const client = new AbortController();
  const abort = () => { if (!client.signal.aborted) client.abort(); };
  const onClose = () => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort);
  res.once('close', onClose);
  let upstream = mediaUpstreamUrl(row, kind, sourceId, mediaExtension);
  const headers = { 'user-agent': String(req.headers['user-agent'] || 'BLOFY-Xtream-Gateway/1.0') };
  if (req.headers.range) headers.range = String(req.headers.range);
  // A provider returning 404/416 only for "Range: bytes=0-..." can be
  // rechecked once with plain GET. Never discard a nonzero seek request.
  const initialRange=firstByteXtreamRange(headers.range)&&req.method==='GET';
  const maxAttempts = req.method === 'HEAD' ? 1 : (initialRange?4:3);
  let noRangeRetried=false, transientRetried=false, episodeRepairTried=false, movieRepairTried=false;
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
          response = await checkedFetch(upstream, {
            method: req.method === 'HEAD' ? 'HEAD' : 'GET',
            timeoutMs: 12000, headers, signal: controller.signal
          });
        } finally { clearTimeout(timer); }
        if (!(response.ok || response.status === 206)) {
          const retryable = [408,500,502,503,504].includes(response.status);
          const retryWithoutRange = shouldRetryXtreamWithoutRange({
            status:response.status,range:headers.range,method:req.method,
            alreadyRetried:noRangeRetried
          }) && attempt < maxAttempts;
          console.warn('xtream media upstream status', {kind, itemId:gatewayId, status:response.status, attempt,
            retryWithoutRange});
          // Never expose upstream bodies; store only a fixed, allowlisted hint
          // if the provider itself explained a denied request.
          const providerHint=retryWithoutRange?null:await readXtreamProviderDenialHint(response);
          // Respect provider refusals, and cool down this channel only.
          if(req.method!=='HEAD')mediaDenialCooldown.denied(cooldownKey,response.status);
          await response.body?.cancel().catch(()=>{});
          if(retryWithoutRange){
            noRangeRetried=true;
            delete headers.range;
            continue;
          }
          // A provider may change an episode from .mp4 to .mkv (or other
          // declared container) while the BLOFY stable ID remains the same.
          // Reconfirm from this *same series* once; never guess another ID.
          if(kind==='series' && response.status===404 &&
             !episodeRepairTried && req.method==='GET'){
            episodeRepairTried=true;
            const m3uEvidence={};
            const hybridFirst=attempt<maxAttempts?
              await verifiedHybridM3uFallback(row,'series',sourceId,{
                deadline:Date.now()+8500,diagnostic:m3uEvidence
              }):null;
            if(!hybridFirst?.verified){
              console.info('xtream episode M3U 404 fallback evidence',{
                itemId:gatewayId,status:m3uEvidence.status||'not_checked'
              });
            }
            if(hybridFirst?.verified){
              upstream=hybridFirst.url;
              console.info('xtream episode 404 recovered from indexed M3U',{itemId:gatewayId});
              continue;
            }
            const repaired=await repairEpisodeOn404(row);
            console.warn('xtream episode 404 diagnosis',{
              itemId:gatewayId,status:repaired.status,
              hasEpisodePosition:episodeOrdinal(row.season_number,{allowZero:true})!==null&&
                episodeOrdinal(row.episode_number)!==null
            });
            if(['changed','relocated','alternate_extension','provider_verified'].includes(repaired.status) && attempt<maxAttempts){
              sourceId=repaired.sourceId||sourceId;
              upstream=repaired.url||mediaUpstreamUrl(row,kind,sourceId,repaired.extension);
              console.info('xtream episode metadata verified and refreshed',{
                kind,itemId:gatewayId,repair:repaired.status
              });
              continue;
            }
            // A subscriber has now independently confirmed a missing file
            // through both the original provider path and its linked M3U.
            // Quarantine that ONE episode temporarily; do not hide its series.
            if(m3uEvidence.status==='provider_404'){
              try{
                await quarantineConfirmedMissingMedia(row,'series',sourceId,{
                  ok:false,httpStatus:404,m3uRecoveryStatus:m3uEvidence.status
                });
              }catch{console.warn('xtream episode quarantine persistence failed');}
            }
            if(repaired.status==='missing'){
              observe('failed',{upstreamStatus:404,reason:'episode_missing_from_source',attempts:attempt});
              return text(res,502,'Episode no longer listed by source');
            }
            if(repaired.status==='position_unknown'){
              observe('failed',{upstreamStatus:404,reason:'episode_position_unknown',attempts:attempt});
              return text(res,502,'Episode needs a fresh series catalog');
            }
            if(repaired.status==='catalog_media_mismatch'){
              observe('failed',{upstreamStatus:404,reason:'episode_media_404_at_source',attempts:attempt});
              return text(res,502,'Episode is listed but its source media returns 404');
            }
          }
          // Source-specific movie 404: verify the current VOD ID against its
          // official get_vod_info, then use only a declared, playable URL or
          // updated container for that SAME movie. No guess or host swap.
          if(kind==='movie'&&response.status===404&&
             !movieRepairTried&&req.method==='GET'&&attempt<maxAttempts){
            movieRepairTried=true;
            const m3uEvidence={};
            const fromM3u=await verifiedHybridM3uFallback(row,'movie',sourceId,{
              deadline:Date.now()+8500,diagnostic:m3uEvidence
            });
            if(!fromM3u?.verified){
              console.info('xtream movie M3U 404 fallback evidence',{
                itemId:gatewayId,status:m3uEvidence.status||'not_checked'
              });
            }
            const hybrid=fromM3u||await verifiedOfficialMediaAlternative(row,'movie',
              sourceId,safeGatewayExtension(mediaExtension,'mp4'),{
                deadline:Date.now()+10000
              });
            if(hybrid?.verified){
              upstream=hybrid.url;
              console.info('xtream movie 404 recovered',{itemId:gatewayId,mode:hybrid.mode});
              continue;
            }
            if(m3uEvidence.status==='provider_404'){
              try{
                await quarantineConfirmedMissingMedia(row,'movie',sourceId,{
                  ok:false,httpStatus:404,m3uRecoveryStatus:m3uEvidence.status
                });
              }catch{console.warn('xtream movie quarantine persistence failed');}
            }
          }
          if (retryable && !transientRetried && attempt < maxAttempts) {
            transientRetried=true;
            await new Promise(resolve=>setTimeout(resolve, 200*attempt));
            continue;
          }
          observe('failed',{
            upstreamStatus:response.status,
            reason:['403','404','408','429','456','500','502','503','504'].includes(String(response.status))
              ?'upstream_http_'+response.status:'upstream_http_other',
            providerHint,attempts:attempt
          });
          return text(res, 502, 'Upstream unavailable');
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
        // Only announce a successful response once the provider really sent media bytes.
        mediaDenialCooldown.clear(cooldownKey);
        observe('started',{upstreamStatus:response.status,startupMs:Date.now()-startedAt,attempts:attempt});
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
        return;
      } catch (error) {
        if (client.signal.aborted) return;
        const reason = controller.signal.reason?.message || error?.message || 'media_error';
        const safeReason = ['headers_timeout','media_read_timeout','upstream_empty_media','upstream_non_media_response'].includes(reason) ? reason : 'upstream_unreachable';
        console.warn('xtream media relay error', {kind,itemId:gatewayId,reason:safeReason,attempt});
        if (!res.headersSent && !transientRetried && attempt < maxAttempts && safeReason!=='upstream_non_media_response') {
          transientRetried=true;
          await new Promise(resolve=>setTimeout(resolve,200*attempt));
          continue;
        }
        observe(res.headersSent?'interrupted':'failed',{reason:safeReason,attempts:attempt});
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
  const timeout=setTimeout(()=>controller.abort(),20000);
  try{
    const row=kind==='series'
      ?await episodeByGatewayId(itemId)
      :await gatewayItemById(kind==='live'?'live':'movie',itemId);
    if(!row||!row.server_enabled)return{ok:false,kind,itemId,reason:'catalog_item_not_found',httpStatus:null};
    const ext=safeGatewayExtension(row.container_extension,kind==='live'?'ts':'mp4');
    let sourceId=kind==='series'?(row.resolved_source_episode_id||row.source_episode_id):row.source_id;
    let url=mediaUpstreamUrl(row,kind,sourceId,ext);
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
    // The operator's manual episode probe also verifies changed extensions,
    // rather than repeatedly reporting 404 for an obsolete cached suffix.
    let repairedExtension=false,episodeRepairStatus=null;
    if(kind==='movie' && response.status===404){
      const alternate=await verifiedOfficialMediaAlternative(row,'movie',sourceId,ext,{
        deadline:Date.now()+11000
      });
      if(alternate){
        await response.body?.cancel().catch(()=>{});
        response=null;
        url=alternate.url;
        response=await checkedFetch(url,{method:'GET',headers:probeHeaders,signal:controller.signal});
        repairedExtension=true;
      }
    }
    if(kind==='series' && response.status===404){
      const fix=await repairEpisodeOn404(row);
      episodeRepairStatus=fix.status;
      console.warn('xtream episode operator probe diagnosis',{itemId,status:fix.status});
      if(['changed','relocated','alternate_extension','provider_verified'].includes(fix.status)){
        await response.body?.cancel().catch(()=>{});
        response=null;
        sourceId=fix.sourceId||sourceId;
        url=fix.url||mediaUpstreamUrl(row,kind,sourceId,fix.extension);
        response=await checkedFetch(url,{method:'GET',headers:probeHeaders,signal:controller.signal});
        repairedExtension=true;
      }else if(['missing','position_unknown','catalog_media_mismatch'].includes(fix.status)){
        const reason=fix.status==='missing'?'episode_missing_from_source':
          fix.status==='position_unknown'?'episode_position_unknown':'episode_media_404_at_source';
        return{ok:false,kind,itemId,httpStatus:404,reason,episodeRepairStatus,
          elapsedMs:Date.now()-started};
      }
    }
    const status=response.status;
    if(!(response.ok||status===206)){
      const providerHint=await readXtreamProviderDenialHint(response);
      return{ok:false,kind,itemId,httpStatus:status,reason:'upstream_http_'+status,
        episodeRepairStatus,repairedExtension,
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
    return{ok:true,kind,itemId,httpStatus:status,format:inspection.format,rangeFallbackUsed,repairedExtension,elapsedMs:Date.now()-started,
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
  const account = await authenticate(username, password, { touch: true });
  if (!account) return json(res, 200, { user_info: { auth: 0, status: 'Disabled' }, server_info: playerServerInfo(req) });
  const action = String(url.searchParams.get('action') || '');
  if (!action) {
    const studio=await getXtreamStudioBranding();
    const user=accountInfo(account,username,password);
    user.message=studio.name;
    return json(res,200,{user_info:user,server_info:{
      ...playerServerInfo(req),server_name:studio.name,
      server_logo:studio.logoUrl?origin(req)+studio.logoUrl:''
    }});
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
      const item = formatGatewayItem(mediaType, row);
      const group = escapeM3uAttribute(row.metadata?.genre || (mediaType === 'live' ? 'Live' : 'Movies'));
      const name = escapeM3uAttribute(row.name);
      const logo = escapeM3uAttribute(row.icon_url || '');
      const ext = mediaType === 'live' ? 'ts' : safeGatewayExtension(row.container_extension, 'mp4');
      const kind = mediaType === 'live' ? 'live' : 'movie';
      await writeStreamChunk(res,`#EXTINF:-1 tvg-name="${name}" tvg-logo="${logo}" group-title="${group}",${name}\n`);
      await writeStreamChunk(res,`${base}/${kind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${row.gateway_id}.${ext}\n`);
    }, account.source_id||null);
  }
  res.end();
}

async function gatewayHealth() {
  await ensureReady();
  const accounts = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM blofy_xtream_gateway_accounts WHERE enabled=TRUE AND (expires_at IS NULL OR expires_at>NOW())`)).rows[0]?.count || 0);
  const rows = (await pool.query(`SELECT media_type,COUNT(*)::int AS count FROM blofy_xtream_items i JOIN blofy_xtream_servers s ON s.id=i.server_id
    WHERE s.enabled=TRUE AND s.publish_catalog=TRUE AND i.enabled=TRUE GROUP BY media_type`)).rows;
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
      if (req.method === 'POST' && url.pathname === '/api/v1/admin/xtream-gateway/issuance-preflight') {
        const body=await readJson(req);
        const sourceId=await checkedAccountSourceId(body.sourceId);
        return json(res,200,await issuancePreflight(sourceId,{refresh:true}));
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

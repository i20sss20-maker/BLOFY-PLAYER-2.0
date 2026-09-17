import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const SECRET_CONTEXT = Buffer.from('blofy-xtream-secret:v1', 'utf8');

function keyBuffer(keyHex) {
  const value = String(keyHex || '').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('xtream_encryption_key_invalid');
  return Buffer.from(value, 'hex');
}

export function encryptXtreamSecret(value, keyHex, label = 'secret') {
  const text = String(value ?? '');
  if (!text) throw new Error('xtream_secret_required');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  const aad = Buffer.concat([SECRET_CONTEXT, Buffer.from(':' + String(label), 'utf8')]);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptXtreamSecret(value, keyHex, label = 'secret') {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('xtream_secret_invalid');
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error('bad_secret_size');
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
    const aad = Buffer.concat([SECRET_CONTEXT, Buffer.from(':' + String(label), 'utf8')]);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error?.message === 'xtream_encryption_key_invalid') throw error;
    throw new Error('xtream_secret_decryption_failed');
  }
}

export function normalizeXtreamBaseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('xtream_base_url_required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('xtream_base_url_invalid'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('xtream_protocol_invalid');
  if (url.username || url.password || url.search || url.hash) throw new Error('xtream_base_url_invalid');
  url.pathname = url.pathname.replace(/\/+$|^$/g, '') || '';
  return url.toString().replace(/\/$/, '');
}

function ipv4Number(address) {
  const parts = String(address).split('.').map(Number);
  if (parts.length !== 4 || parts.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inV4(address, start, bits) {
  const n = ipv4Number(address);
  const s = ipv4Number(start);
  if (n == null || s == null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (s & mask);
}

export function isBlockedNetworkAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  const version = net.isIP(value);
  if (version === 4) {
    return inV4(value, '0.0.0.0', 8) ||
      inV4(value, '10.0.0.0', 8) ||
      inV4(value, '100.64.0.0', 10) ||
      inV4(value, '127.0.0.0', 8) ||
      inV4(value, '169.254.0.0', 16) ||
      inV4(value, '172.16.0.0', 12) ||
      inV4(value, '192.0.0.0', 24) ||
      inV4(value, '192.0.2.0', 24) ||
      inV4(value, '192.168.0.0', 16) ||
      inV4(value, '198.18.0.0', 15) ||
      inV4(value, '198.51.100.0', 24) ||
      inV4(value, '203.0.113.0', 24) ||
      inV4(value, '224.0.0.0', 4) ||
      inV4(value, '240.0.0.0', 4);
  }
  if (version === 6) {
    if (value === '::' || value === '::1') return true;
    if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedNetworkAddress(mapped[1]);
    return false;
  }
  return true;
}

export async function assertPublicXtreamUrl(input, lookup = dns.lookup) {
  const normalized = normalizeXtreamBaseUrl(input);
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('xtream_private_host_blocked');
  if (net.isIP(host)) {
    if (isBlockedNetworkAddress(host)) throw new Error('xtream_private_host_blocked');
    return normalized;
  }
  const records = await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(records) || !records.length) throw new Error('xtream_host_unresolved');
  if (records.some(record => isBlockedNetworkAddress(record.address))) throw new Error('xtream_private_host_blocked');
  return normalized;
}

export function xtreamApiUrl(baseUrl, username, password, action = null, extra = {}) {
  const url = new URL(normalizeXtreamBaseUrl(baseUrl) + '/player_api.php');
  url.searchParams.set('username', String(username || ''));
  url.searchParams.set('password', String(password || ''));
  if (action) url.searchParams.set('action', String(action));
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

export function sanitizeXtreamAccount(payload) {
  const user = payload && typeof payload === 'object' ? payload.user_info || {} : {};
  const server = payload && typeof payload === 'object' ? payload.server_info || {} : {};
  const toInt = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  };
  return {
    authenticated: String(user.auth ?? '') === '1' || user.auth === 1 || user.auth === true,
    status: user.status ? String(user.status).slice(0, 40) : null,
    expiresAt: toInt(user.exp_date),
    createdAt: toInt(user.created_at),
    isTrial: String(user.is_trial ?? '') === '1',
    activeConnections: toInt(user.active_cons),
    maxConnections: toInt(user.max_connections),
    allowedOutputFormats: Array.isArray(user.allowed_output_formats) ? user.allowed_output_formats.map(v => String(v).slice(0, 20)).slice(0, 20) : [],
    serverTimeZone: server.timezone ? String(server.timezone).slice(0, 80) : null,
    serverTimestamp: toInt(server.timestamp_now),
    transportSecurity: String(server.https_port || '').trim() ? 'https-capable' : null
  };
}

function cleanText(value, max = 1000) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function boolish(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

export function normalizeXtreamCategory(mediaType, raw, syncToken) {
  if (!raw || typeof raw !== 'object') return null;
  const id = cleanText(raw.category_id ?? raw.id, 128);
  const name = cleanText(raw.category_name ?? raw.name, 300);
  if (!id || !name) return null;
  return {
    mediaType,
    sourceCategoryId: id,
    name,
    parentId: cleanText(raw.parent_id, 128),
    syncToken
  };
}

export function normalizeXtreamItem(mediaType, raw, syncToken) {
  if (!raw || typeof raw !== 'object') return null;
  const isSeries = mediaType === 'series';
  const sourceId = cleanText(isSeries ? raw.series_id : raw.stream_id, 128);
  const name = cleanText(raw.name ?? raw.title, 500);
  if (!sourceId || !name) return null;
  const icon = cleanText(isSeries ? (raw.cover || raw.stream_icon) : raw.stream_icon, 2048);
  const categoryId = cleanText(raw.category_id, 128);
  const extension = cleanText(raw.container_extension, 20);
  const metadata = {
    num: raw.num ?? null,
    added: raw.added ?? null,
    rating: raw.rating ?? null,
    rating5: raw.rating_5based ?? null,
    tmdb: raw.tmdb ?? null,
    imdb: raw.imdb_id ?? raw.imdb ?? null,
    plot: cleanText(raw.plot, 4000),
    cast: cleanText(raw.cast, 2000),
    director: cleanText(raw.director, 1000),
    genre: cleanText(raw.genre, 1000),
    releaseDate: cleanText(raw.releaseDate ?? raw.release_date, 80),
    year: raw.year ?? null,
    youtubeTrailer: cleanText(raw.youtube_trailer, 512),
    episodeRunTime: raw.episode_run_time ?? null,
    backdropPath: Array.isArray(raw.backdrop_path) ? raw.backdrop_path.map(v => cleanText(v, 2048)).filter(Boolean).slice(0, 8) : [],
    epgChannelId: cleanText(raw.epg_channel_id, 256),
    archive: boolish(raw.tv_archive),
    archiveDuration: Number(raw.tv_archive_duration) || 0,
    isAdult: boolish(raw.is_adult),
    customSid: cleanText(raw.custom_sid, 128),
    directSourcePresent: Boolean(cleanText(raw.direct_source, 2048))
  };
  return {
    mediaType,
    sourceId,
    categoryId,
    name,
    iconUrl: icon,
    containerExtension: extension,
    metadata,
    syncToken
  };
}

export async function parseTopLevelJsonArray(body, onItem, { maxItemBytes = 2_000_000 } = {}) {
  if (!body || typeof body[Symbol.asyncIterator] !== 'function') throw new Error('xtream_stream_unavailable');
  const decoder = new TextDecoder();
  let started = false;
  let finished = false;
  let collecting = false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let current = '';
  let count = 0;

  const emit = async () => {
    const raw = current.trim();
    current = '';
    collecting = false;
    depth = 0;
    inString = false;
    escape = false;
    if (!raw) return;
    if (Buffer.byteLength(raw) > maxItemBytes) throw new Error('xtream_item_too_large');
    const parsed = JSON.parse(raw);
    await onItem(parsed, count++);
  };

  const consume = async text => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (finished) {
        if (!/\s/.test(ch)) throw new Error('xtream_array_trailing_data');
        continue;
      }
      if (!started) {
        if (/\s/.test(ch)) continue;
        if (ch !== '[') throw new Error('xtream_array_expected');
        started = true;
        continue;
      }
      if (!collecting) {
        if (/\s/.test(ch) || ch === ',') continue;
        if (ch === ']') { finished = true; continue; }
        if (ch !== '{') throw new Error('xtream_object_expected');
        collecting = true;
        current = ch;
        depth = 1;
        continue;
      }

      current += ch;
      if (Buffer.byteLength(current) > maxItemBytes) throw new Error('xtream_item_too_large');
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') depth--;
      if (depth === 0) await emit();
      if (depth < 0) throw new Error('xtream_array_invalid');
    }
  };

  for await (const chunk of body) await consume(decoder.decode(chunk, { stream: true }));
  await consume(decoder.decode());
  if (!started || !finished || collecting) throw new Error('xtream_array_incomplete');
  return count;
}

export function redactXtreamError(error) {
  const message = String(error?.message || error || 'xtream_error');
  return message.replace(/([?&](?:username|password)=)[^&\s]+/gi, '$1***').slice(0, 400);
}

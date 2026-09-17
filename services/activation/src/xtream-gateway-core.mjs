import crypto from 'node:crypto';

function keyBuffer(keyHex) {
  const value = String(keyHex || '').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('xtream_gateway_key_invalid');
  return Buffer.from(value, 'hex');
}

export function normalizeGatewayUsername(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_]{4,32}$/.test(text)) throw new Error('xtream_gateway_username_invalid');
  return text;
}

export function normalizeGatewayPassword(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(text)) throw new Error('xtream_gateway_password_invalid');
  return text;
}

export function gatewayCredentialProof(username, password, keyHex) {
  const user = normalizeGatewayUsername(username);
  const pass = normalizeGatewayPassword(password);
  return crypto.createHmac('sha256', keyBuffer(keyHex))
    .update('blofy-xtream-gateway:v1\0', 'utf8')
    .update(user, 'utf8')
    .update('\0', 'utf8')
    .update(pass, 'utf8')
    .digest('hex');
}

export function verifyGatewayCredential(storedProof, username, password, keyHex) {
  let candidate;
  try { candidate = gatewayCredentialProof(username, password, keyHex); }
  catch { return false; }
  const left = Buffer.from(String(storedProof || ''), 'hex');
  const right = Buffer.from(candidate, 'hex');
  return left.length === 32 && right.length === 32 && crypto.timingSafeEqual(left, right);
}

export function generateGatewayUsername(randomBytes = crypto.randomBytes) {
  return `blofy${randomBytes(5).toString('hex')}`;
}

export function generateGatewayPassword(randomBytes = crypto.randomBytes) {
  return randomBytes(18).toString('base64url');
}

export function safeGatewayExtension(value, fallback = 'ts') {
  const ext = String(value || '').trim().replace(/^\./, '').toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : fallback;
}

export function stripUpstreamSecrets(value) {
  if (Array.isArray(value)) return value.map(stripUpstreamSecrets);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (['username','password','direct_source','directsource','server_url','serverurl','host'].includes(lower)) continue;
    out[key] = stripUpstreamSecrets(raw);
  }
  return out;
}

export function formatGatewayCategory(row) {
  return {
    category_id: String(row.gateway_id),
    category_name: String(row.name || ''),
    parent_id: 0
  };
}

export function formatGatewayItem(mediaType, row) {
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const categoryId = row.category_gateway_id == null ? '0' : String(row.category_gateway_id);
  const base = {
    name: String(row.name || ''),
    stream_icon: row.icon_url || '',
    category_id: categoryId,
    added: meta.added == null ? '' : String(meta.added)
  };
  if (mediaType === 'live') {
    return {
      num: meta.num ?? null,
      ...base,
      stream_type: 'live',
      stream_id: Number(row.gateway_id),
      epg_channel_id: meta.epgChannelId || '',
      custom_sid: meta.customSid || '',
      tv_archive: meta.archive ? 1 : 0,
      direct_source: '',
      tv_archive_duration: Number(meta.archiveDuration || 0)
    };
  }
  if (mediaType === 'movie') {
    return {
      num: meta.num ?? null,
      ...base,
      stream_type: 'movie',
      stream_id: Number(row.gateway_id),
      rating: meta.rating ?? '',
      rating_5based: meta.rating5 ?? '',
      container_extension: safeGatewayExtension(row.container_extension, 'mp4'),
      custom_sid: meta.customSid || '',
      direct_source: ''
    };
  }
  return {
    num: meta.num ?? null,
    series_id: Number(row.gateway_id),
    name: String(row.name || ''),
    cover: row.icon_url || '',
    plot: meta.plot || '',
    cast: meta.cast || '',
    director: meta.director || '',
    genre: meta.genre || '',
    releaseDate: meta.releaseDate || '',
    last_modified: meta.added == null ? '' : String(meta.added),
    rating: meta.rating ?? '',
    rating_5based: meta.rating5 ?? '',
    backdrop_path: Array.isArray(meta.backdropPath) ? meta.backdropPath : [],
    youtube_trailer: meta.youtubeTrailer || '',
    episode_run_time: meta.episodeRunTime ?? '',
    category_id: categoryId
  };
}

export function escapeM3uAttribute(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'").slice(0, 1000);
}

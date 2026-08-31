import crypto from 'node:crypto';

const REDACTED_URL = '<redacted-url>';
const REDACTED_VALUE = '***';
const REDACTED_HOST = 'redacted.invalid';
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'rtmp:', 'rtsp:']);
const PATH_KINDS = new Set(['live', 'movie', 'series', 'stream', 'play', 'hls', 'timeshift', 'catchup']);
const SAFE_EXTENSIONS = new Set(['ts', 'm3u8', 'm3u', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'mpd', 'php']);

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
const EMBEDDED_URL = /\b(?:https?|rtmp|rtsp):\/\/\S+/gi;
const SCHEMELESS_URL = /\b(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?\/[^\s<>"']+/gi;
const RELATIVE_STREAM_PATH = /(^|[\s("'=])(\/(?:live|movie|series|stream|play|hls|timeshift|catchup)\/[^\s<>"']+)/gi;
const BARE_HOST = /(?:\[[0-9a-f:]+\](?::\d{1,5})?|\b(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|(?:\d{1,3}\.){3}\d{1,3})(?::\d{1,5})?\b)/gi;
const AUTHORIZATION_CREDENTIAL = /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]+/gi;
const AUTHORITY_CREDENTIALS = /\b[^\s/@:]+:[^\s/@]+@\S+/gi;
const SENSITIVE_KEY_VALUE = /(\b(?:user(?:name)?|password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|authorization|auth|secret|url|uri|endpoint)\b\s*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;
const PROVIDER_PSEUDONYM = /^provider-[a-f0-9]{16}$/;
const CONTENT_KINDS = new Set(['live', 'movie', 'series', 'episode', 'catchup', 'unknown']);

function outputLimit(value, maxLength) {
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 0;
  return value.slice(0, limit);
}

/**
 * Reduces a stream URL to non-sensitive diagnostics metadata. Arbitrary path, query,
 * fragment and URL user-info values are never retained because providers commonly put
 * usernames, passwords and access tokens in those locations.
 */
export function sanitizeDiagnosticUrl(value, maxLength = 1024) {
  const clean = String(value ?? '').replace(CONTROL_CHARACTERS, ' ').trim().slice(0, 8192);
  if (!clean) return outputLimit(REDACTED_URL, maxLength);

  let url;
  try {
    url = new URL(clean);
  } catch {
    return outputLimit(REDACTED_URL, maxLength);
  }
  if (!ALLOWED_SCHEMES.has(url.protocol) || !url.hostname) return outputLimit(REDACTED_URL, maxLength);

  const segments = url.pathname.split('/').filter(Boolean);
  const kindCandidate = String(segments[0] || '').toLowerCase();
  const kind = PATH_KINDS.has(kindCandidate) ? kindCandidate : null;
  const extensionMatch = url.pathname.match(/\.([a-z0-9]{1,8})$/i);
  const extensionCandidate = String(extensionMatch?.[1] || '').toLowerCase();
  const extension = SAFE_EXTENSIONS.has(extensionCandidate) ? `.${extensionCandidate}` : '';
  const pathHint = kind ? `/${kind}/${REDACTED_VALUE}${extension}` : `/${REDACTED_VALUE}${extension}`;

  return outputLimit(`${url.protocol}//${REDACTED_HOST}${pathHint}`, maxLength);
}

/** Removes credentials from error strings before persistence or admin display. */
export function sanitizeDiagnosticMessage(value, maxLength = 512) {
  if (value == null || String(value).trim() === '') return null;

  let clean = String(value).replace(CONTROL_CHARACTERS, ' ');
  clean = clean.replace(EMBEDDED_URL, REDACTED_URL);
  clean = clean.replace(SCHEMELESS_URL, REDACTED_URL);
  clean = clean.replace(RELATIVE_STREAM_PATH, `$1${REDACTED_URL}`);
  clean = clean.replace(AUTHORITY_CREDENTIALS, REDACTED_URL);
  clean = clean.replace(BARE_HOST, '<redacted-host>');
  clean = clean.replace(AUTHORIZATION_CREDENTIAL, REDACTED_VALUE);
  clean = clean.replace(SENSITIVE_KEY_VALUE, `$1${REDACTED_VALUE}`);
  clean = outputLimit(clean.trim(), maxLength);
  return clean || null;
}

/** Stable correlation key that cannot expose a playlist ID, URL or credential. */
export function pseudonymizeDiagnosticProviderKey(value) {
  const clean = String(value ?? '').replace(CONTROL_CHARACTERS, ' ').trim().slice(0, 2048);
  if (!clean) return 'provider-unknown';
  if (PROVIDER_PSEUDONYM.test(clean)) return clean;
  return `provider-${crypto.createHash('sha256').update(clean, 'utf8').digest('hex').slice(0, 16)}`;
}

export function sanitizeDiagnosticContentKind(value) {
  const clean = String(value ?? '').trim().toLowerCase();
  return CONTENT_KINDS.has(clean) ? clean : 'unknown';
}

export function sanitizeDiagnosticErrorCode(value) {
  const clean = String(value ?? '').trim();
  return /^ERROR_CODE_[A-Z0-9_]{1,117}$/.test(clean) ? clean : null;
}

export function sanitizeDiagnosticAppVersion(value) {
  const clean = String(value ?? '').trim();
  if (clean === 'ci') return clean;
  return /^\d{1,4}(?:\.\d{1,4}){1,3}(?:[-+][A-Za-z0-9.-]{1,32})?$/.test(clean) ? clean : null;
}

/**
 * Produces log-safe error metadata without ever serializing message, stack, cause,
 * request bodies, connection strings or driver-specific objects.
 */
export function safeErrorSummary(error) {
  const rawName = String(error?.name || 'Error');
  const name = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName) ? rawName : 'Error';
  const rawCode = String(error?.code || '');
  const code = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(rawCode) ? rawCode : '';
  return code ? `${name} (${code})` : name;
}

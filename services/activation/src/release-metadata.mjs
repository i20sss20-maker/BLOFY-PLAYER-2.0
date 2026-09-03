export const ACTIVATION_SERVICE_VERSION = '1.1.0';

const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const VERSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

export function sanitizeCommitSha(value) {
  const candidate = String(value || '').trim();
  return COMMIT_SHA_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function sanitizeVersionCode(value) {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 && candidate <= MAX_ANDROID_VERSION_CODE
    ? candidate
    : null;
}

export function sanitizeVersionName(value) {
  const candidate = String(value || '').trim();
  return VERSION_NAME_PATTERN.test(candidate) ? candidate : null;
}

export function sanitizeHttpsUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizeReleaseNotes(value) {
  const candidate = String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (!candidate) return null;
  return candidate.slice(0, 600);
}

export function appReleaseMetadata(env = process.env) {
  const versionCode = sanitizeVersionCode(env.BLOFY_APP_VERSION_CODE);
  const versionName = sanitizeVersionName(env.BLOFY_APP_VERSION_NAME);
  if (versionCode == null || versionName == null) return null;

  const configuredMinimum = sanitizeVersionCode(env.BLOFY_APP_MIN_SUPPORTED_VERSION_CODE) || 1;
  return {
    versionCode,
    versionName,
    minSupportedVersionCode: Math.min(configuredMinimum, versionCode),
    downloadUrl: sanitizeHttpsUrl(env.BLOFY_APP_DOWNLOAD_URL),
    releaseNotes: sanitizeReleaseNotes(env.BLOFY_APP_RELEASE_NOTES)
  };
}

export function activationReleaseMetadata(env = process.env) {
  const vercelCommitSha = sanitizeCommitSha(env.VERCEL_GIT_COMMIT_SHA);
  const fallbackCommitSha = sanitizeCommitSha(env.BLOFY_RELEASE_COMMIT_SHA);
  return {
    service: 'blofy-activation',
    version: ACTIVATION_SERVICE_VERSION,
    platform: env.VERCEL === '1' || vercelCommitSha ? 'vercel' : 'self-hosted',
    commitSha: vercelCommitSha || fallbackCommitSha,
    app: appReleaseMetadata(env)
  };
}

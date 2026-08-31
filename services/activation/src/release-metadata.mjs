export const ACTIVATION_SERVICE_VERSION = '1.0.0';

const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function sanitizeCommitSha(value) {
  const candidate = String(value || '').trim();
  return COMMIT_SHA_PATTERN.test(candidate) ? candidate.toLowerCase() : null;
}

export function activationReleaseMetadata(env = process.env) {
  const vercelCommitSha = sanitizeCommitSha(env.VERCEL_GIT_COMMIT_SHA);
  const fallbackCommitSha = sanitizeCommitSha(env.BLOFY_RELEASE_COMMIT_SHA);
  return {
    service: 'blofy-activation',
    version: ACTIVATION_SERVICE_VERSION,
    platform: env.VERCEL === '1' || vercelCommitSha ? 'vercel' : 'self-hosted',
    commitSha: vercelCommitSha || fallbackCommitSha
  };
}

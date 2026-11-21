import { createPublicKey, verify } from 'node:crypto';

// A single owner-signed STREAM APK is admitted by GitHub Actions OIDC, not by
// a password or a broadly scoped download-admin credential.
export const STREAM_55836_APK = 'BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_55836_SHA256 = '2f5abba6d367d41fd9bab71cb8355f234678a8d715c4bebff899760642bf474e';
export const STREAM_55836_BYTES = 135775044;
export const STREAM_55836_AUDIENCE = 'blofy-stream-55-8-36-website-upload';
export const STREAM_56_APK = 'BLOFY-STREAM-56.0-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_56_SHA256 = 'bba9e340d50c95ab8ab9e1c42f96bef8f2d676dee888e975d7a161f2027d8064';
export const STREAM_56_BYTES = 135783643;
export const STREAM_56_AUDIENCE = 'blofy-stream-56-website-upload';
export const STREAM_5601_APK = 'BLOFY-STREAM-56.0.1-LIVE-RECONNECT-FIX-OWNER-SIGNED.apk';
export const STREAM_5601_SHA256 = '02d40e3748f0d75905f734ad429ef16994d87a7068280e567d8da9339932e89a';
export const STREAM_5601_BYTES = 135785176;
export const STREAM_5601_AUDIENCE = 'blofy-stream-56-0-1-qa-website-upload';
export const STREAM_5602_APK = 'BLOFY-STREAM-56.0.2-AUTO-CATALOG-FIX-OWNER-SIGNED.apk';
export const STREAM_5602_SHA256 = '9a3037936b374b3e62e2bc06f4f9fe8b5a3a64441c249c8cf00d78944c58876a';
export const STREAM_5602_BYTES = 135787039;
export const STREAM_5602_AUDIENCE = 'blofy-stream-56-0-2-owner-signed-website-upload';
export const STREAM_5603_APK = 'BLOFY-STREAM-56.0.3-REFRESH-STALL-FIX-OWNER-SIGNED.apk';
export const STREAM_5603_SHA256 = 'a43c8041becaac1f6c3de91f68b436c0ff844c9b6c74e571a6484bc3ab2537c9';
export const STREAM_5603_BYTES = 135792516;
export const STREAM_5603_AUDIENCE = 'blofy-stream-56-0-3-owner-signed-website-upload';

// Each authorized GitHub OIDC workflow can upload ONLY its immutable pinned
// artifact. This registry neither widens the legacy admin bearer nor changes
// the customer's current STREAM download or updater before promotion.
const APPROVED = Object.freeze({
  [STREAM_55836_APK]: Object.freeze({
    sha256: STREAM_55836_SHA256, bytes: STREAM_55836_BYTES,
    audience: STREAM_55836_AUDIENCE,
    workflowRef: 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-55-8-36.yml@refs/heads/main'
  }),
  [STREAM_56_APK]: Object.freeze({
    sha256: STREAM_56_SHA256, bytes: STREAM_56_BYTES,
    audience: STREAM_56_AUDIENCE,
    workflowRef: 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-56.yml@refs/heads/main'
  }),
  [STREAM_5601_APK]: Object.freeze({
    sha256: STREAM_5601_SHA256, bytes: STREAM_5601_BYTES,
    audience: STREAM_5601_AUDIENCE,
    workflowRef: 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-56-0-1-qa.yml@refs/heads/main'
  }),
  [STREAM_5602_APK]: Object.freeze({
    sha256: STREAM_5602_SHA256, bytes: STREAM_5602_BYTES,
    audience: STREAM_5602_AUDIENCE,
    workflowRef: 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-56-0-2-site.yml@refs/heads/main'
  }),
  [STREAM_5603_APK]: Object.freeze({
    sha256: STREAM_5603_SHA256, bytes: STREAM_5603_BYTES,
    audience: STREAM_5603_AUDIENCE,
    workflowRef: 'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-56-0-3-site.yml@refs/heads/main'
  })
});

export function approvedStreamUpload(filename) {
  return Object.hasOwn(APPROVED, filename) ? APPROVED[filename] : null;
}

export function isTrustedStreamUploadClaims(claims, now = Math.floor(Date.now() / 1000), filename = STREAM_55836_APK) {
  const approved = approvedStreamUpload(filename);
  return Boolean(approved && claims && claims.iss === 'https://token.actions.githubusercontent.com' &&
    claims.aud === approved.audience &&
    claims.sub === 'repo:i20sss20-maker@317876372/BLOFY-PLAYER-2.0@1351236912:ref:refs/heads/main' &&
    claims.repository === 'i20sss20-maker/BLOFY-PLAYER-2.0' &&
    String(claims.repository_id) === '1351236912' &&
    claims.ref === 'refs/heads/main' &&
    claims.event_name === 'push' &&
    claims.workflow_ref === approved.workflowRef &&
    Number.isSafeInteger(Number(claims.exp)) && Number(claims.exp) > now &&
    Number(claims.exp) <= now + 600 &&
    Number.isSafeInteger(Number(claims.iat)) && Number(claims.iat) >= now - 600 &&
    Number(claims.iat) <= now + 30);
}

export async function verifySignedStreamUploadOidc(authorization, filename = STREAM_55836_APK) {
  const text = String(authorization || '');
  if (!text.startsWith('Bearer ') || text.length > 16_384) return false;
  const token = text.slice(7);
  if (!/^[A-Za-z0-9._-]+$/.test(token)) return false;
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some(x => x.length < 4)) return false;
  try {
    const header = JSON.parse(Buffer.from(segments[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString());
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
        header.kid.length > 200 || !isTrustedStreamUploadClaims(claims, Math.floor(Date.now() / 1000), filename)) return false;
    const response = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks', {
      signal: AbortSignal.timeout(6000),
      headers: { accept: 'application/json' }
    });
    if (!response.ok) return false;
    const keys = (await response.json()).keys;
    const jwk = Array.isArray(keys) ? keys.find(k =>
      k.kid === header.kid && k.kty === 'RSA' && k.use === 'sig') : null;
    if (!jwk) return false;
    return verify('RSA-SHA256',
      Buffer.from(segments[0] + '.' + segments[1]),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(segments[2], 'base64url'));
  } catch {
    return false;
  }
}

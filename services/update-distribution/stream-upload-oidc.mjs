import { createPublicKey, verify } from 'node:crypto';

// A single owner-signed STREAM APK is admitted by GitHub Actions OIDC, not by
// a password or a broadly scoped download-admin credential.
export const STREAM_55836_APK = 'BLOFY-STREAM-55.8.36-CATALOG-TV-CONTROLS-FIX-OWNER-SIGNED.apk';
export const STREAM_55836_SHA256 = '2f5abba6d367d41fd9bab71cb8355f234678a8d715c4bebff899760642bf474e';
export const STREAM_55836_BYTES = 135775044;
export const STREAM_55836_AUDIENCE = 'blofy-stream-55-8-36-website-upload';

export function isTrustedStreamUploadClaims(claims, now = Math.floor(Date.now() / 1000)) {
  return Boolean(claims && claims.iss === 'https://token.actions.githubusercontent.com' &&
    claims.aud === STREAM_55836_AUDIENCE &&
    claims.sub === 'repo:i20sss20-maker@317876372/BLOFY-PLAYER-2.0@1351236912:ref:refs/heads/main' &&
    claims.repository === 'i20sss20-maker/BLOFY-PLAYER-2.0' &&
    String(claims.repository_id) === '1351236912' &&
    claims.ref === 'refs/heads/main' &&
    claims.event_name === 'push' &&
    claims.workflow_ref ===
      'i20sss20-maker/BLOFY-PLAYER-2.0/.github/workflows/publish-blofy-stream-55-8-36.yml@refs/heads/main' &&
    Number.isSafeInteger(Number(claims.exp)) && Number(claims.exp) > now &&
    Number(claims.exp) <= now + 600 &&
    Number.isSafeInteger(Number(claims.iat)) && Number(claims.iat) >= now - 600 &&
    Number(claims.iat) <= now + 30);
}

export async function verifySignedStreamUploadOidc(authorization) {
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
        header.kid.length > 200 || !isTrustedStreamUploadClaims(claims)) return false;
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

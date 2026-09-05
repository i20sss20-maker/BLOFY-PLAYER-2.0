import crypto from 'node:crypto';

export function openSealedText(value, keyHex) {
  if (!value) return '';
  if (!/^[a-f0-9]{64}$/i.test(keyHex || '')) throw new Error('playlist_encryption_key_missing');
  const bytes = Buffer.from(String(value), 'base64url');
  if (bytes.length < 29) throw new Error('invalid_sealed_value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

export function decodePlaylistRow(row, keyHex) {
  return { ...row, providerType: row.provider_type,
    baseUrl: openSealedText(row.base_url_enc, keyHex),
    username: openSealedText(row.username_enc, keyHex), password: openSealedText(row.password_enc, keyHex) };
}

function normalizedUrl(value, type) {
  const url = new URL(String(value));
  url.hash = '';
  if (type === 'xtream') url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

/** Account identity is independent of display names and random encrypted session IVs.
 * Old/expired tokens are authenticated ONLY to identify saved rows, not to authorize playback.
 * A token belonging to a different device or with an invalid GCM tag cannot identify an account.
 */
export function playlistIdentity(item, deviceId, keyHex) {
  const type = item.providerType;
  const baseUrl = normalizedUrl(item.baseUrl, type);
  let username = String(item.username || '');
  let password = String(item.password || '');
  let scope = 'exact-credentials';
  if (type === 'xtream' && new URL(baseUrl).pathname.replace(/\/+$/, '') === '/api/v1/subscribers/xtream') {
    try {
      const payload = JSON.parse(openSealedText(username, keyHex));
      if (payload.d === deviceId && typeof payload.u === 'string' && payload.u && typeof payload.p === 'string') {
        username = payload.u;
        password = '';
        scope = 'verified-subscriber';
      }
    } catch { /* Keep opaque sessions separate if identity cannot be verified. */ }
  }
  return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(JSON.stringify(['blofy-playlist-v1', deviceId, type, baseUrl, scope, username, password])).digest('hex');
}

export function playlistUuid(identity) {
  const chars = identity.slice(0, 32).split('');
  chars[12] = '5'; chars[16] = ((parseInt(chars[16], 16) & 3) | 8).toString(16);
  const h = chars.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function groupPlaylists(rows, deviceId, keyHex) {
  const groups = new Map();
  for (const row of rows) {
    const item = decodePlaylistRow(row, keyHex);
    const identity = playlistIdentity(item, deviceId, keyHex);
    const group = groups.get(identity) || [];
    group.push(item); groups.set(identity, group);
  }
  return Array.from(groups, ([identity, items]) => {
    items.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || new Date(b.updated_at) - new Date(a.updated_at) || String(a.id).localeCompare(String(b.id)));
    return { identity, primary: items[0], aliases: items.slice(1).map(item => item.id) };
  });
}

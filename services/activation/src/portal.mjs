import crypto from 'node:crypto';
import { recordAudit } from './audit.mjs';
import { groupPlaylists, playlistIdentity, playlistUuid } from './playlist-identity.mjs';

function keyFromEnv() {
  const raw = String(process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) return null;
  return Buffer.from(raw, 'hex');
}

function seal(value) {
  if (value == null || value === '') return null;
  const key = keyFromEnv();
  if (!key) throw new Error('playlist_encryption_key_missing');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64url');
}

function open(value) {
  if (!value) return '';
  const key = keyFromEnv();
  if (!key) throw new Error('playlist_encryption_key_missing');
  const payload = Buffer.from(value, 'base64url');
  if (payload.length < 29) throw new Error('invalid_sealed_value');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function cleanText(value, max = 256) { return String(value || '').trim().slice(0, max); }
function validType(value) { return value === 'xtream' || value === 'm3u'; }

function safePlaylistGroups(rows, deviceId, encryptionKey, warnRejected) {
  const validRows = [];
  const corruptIds = [];
  for (const row of rows) {
    try {
      // Validate each encrypted row independently before grouping. One damaged legacy
      // row must never make list/edit/delete fail for every other playlist on the device.
      groupPlaylists([row], deviceId, encryptionKey);
      validRows.push(row);
    } catch (error) {
      corruptIds.push(row.id);
      warnRejected('corrupt_playlist_row');
    }
  }
  return { groups: groupPlaylists(validRows, deviceId, encryptionKey), corruptIds };
}

function hasAuthorityUserInfo(candidate, parsed) {
  if (parsed.username || parsed.password) return true;
  const authorityStart = candidate.indexOf('://');
  if (authorityStart < 0) return false;
  const start = authorityStart + 3;
  const boundary = ['/', '?', '#']
    .map((marker) => candidate.indexOf(marker, start))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? candidate.length;
  return candidate.slice(start, boundary).includes('@');
}

function parseIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  return numbers.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? numbers : null;
}

function isUnsafeIpv4(parts) {
  const [a, b] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && b >= 18 && b <= 19) ||
    a >= 224;
}

function parseIpv6(host) {
  let value = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (!value || value.includes('%') || value.indexOf('::') !== value.lastIndexOf('::')) return null;

  const ipv4Start = value.lastIndexOf(':') + 1;
  const ipv4 = parseIpv4(value.slice(ipv4Start));
  if (ipv4) {
    const high = ((ipv4[0] << 8) | ipv4[1]).toString(16);
    const low = ((ipv4[2] << 8) | ipv4[3]).toString(16);
    value = `${value.slice(0, ipv4Start)}${high}:${low}`;
  }

  const compressedAt = value.indexOf('::');
  const left = (compressedAt >= 0 ? value.slice(0, compressedAt) : value)
    .split(':').filter(Boolean);
  const right = compressedAt >= 0 ? value.slice(compressedAt + 2).split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if ((compressedAt >= 0 && missing < 1) || (compressedAt < 0 && left.length !== 8)) return null;
  const groups = compressedAt >= 0 ? [...left, ...Array(missing).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;

  return groups.flatMap((group) => {
    const number = Number.parseInt(group, 16);
    return [number >> 8, number & 0xff];
  });
}

function isUnsafeIpv6(host) {
  const bytes = parseIpv6(host);
  if (!bytes) return true;

  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatibleIpv4 = bytes.slice(0, 12).every((byte) => byte === 0) && !bytes.slice(12).every((byte) => byte === 0);
  if (mappedIpv4 || compatibleIpv4) return isUnsafeIpv4(bytes.slice(12));

  const allZero = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const uniqueLocal = (bytes[0] & 0xfe) === 0xfc;
  const linkLocal = bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80;
  const multicast = bytes[0] === 0xff;
  const documentation = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  return allZero || loopback || uniqueLocal || linkLocal || multicast || documentation;
}

function isUnsafeHost(host) {
  const normalized = String(host || '')
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/, '')
    .toLowerCase();
  if (!normalized) return true;
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home') ||
    normalized.endsWith('.home.arpa')
  ) return true;

  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isUnsafeIpv4(ipv4);
  if (normalized.includes(':')) return isUnsafeIpv6(normalized);

  return !normalized.includes('.');
}

export function playlistUrlValidation(value) {
  const candidate = String(value || '').trim();
  if (!candidate || /[\s\u0000-\u001f\u007f]/u.test(candidate)) return 'invalid_playlist_url';
  if (!/^https?:\/\//i.test(candidate)) return 'invalid_playlist_url';

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_) {
    return 'invalid_playlist_url';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return 'invalid_playlist_url';
  if (!parsed.hostname) return 'invalid_playlist_url';
  if (hasAuthorityUserInfo(candidate, parsed)) return 'playlist_userinfo_not_allowed';
  if (parsed.port === '0' || isUnsafeHost(parsed.hostname)) return 'unsafe_playlist_host';
  return null;
}

export function createPortalHandlers({
  pool,
  json,
  readJson,
  authorizedDevice,
  warnRejected = (error) => console.warn('[portal/playlists] rejected', { error })
}) {
  function rejectPlaylist(res, error) {
    warnRejected(error);
    return json(res, 400, { error });
  }

  async function authenticate(req, body) {
    const deviceId = cleanText(body.deviceId, 64);
    const activationCode = cleanText(body.activationCode, 16);
    const device = await authorizedDevice(deviceId, activationCode, req);
    return device ? { deviceId, activationCode } : null;
  }

  async function list(req, res) {
    const body = await readJson(req);
    const auth = await authenticate(req, body);
    if (!auth) return json(res, 403, { error: 'unauthorized_device' });
    const result = await pool.query(
      `SELECT id,name,provider_type,base_url_enc,username_enc,password_enc,active,revision,updated_at
       FROM device_playlists WHERE device_id=$1 ORDER BY active DESC, updated_at DESC`, [auth.deviceId]
    );
    const safe = safePlaylistGroups(result.rows, auth.deviceId, process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY, warnRejected);
    return json(res, 200, {
      items: safe.groups.map(({ primary: row, aliases }) => ({
        id: row.id,
        aliasIds: aliases,
        name: row.name,
        providerType: row.provider_type,
        baseUrl: open(row.base_url_enc),
        username: open(row.username_enc),
        password: open(row.password_enc),
        active: row.active,
        revision: Number(row.revision),
        updatedAt: new Date(row.updated_at).getTime()
      })),
      skippedCorrupt: safe.corruptIds.length
    });
  }

  async function upsert(req, res) {
    const body = await readJson(req);
    const auth = await authenticate(req, body);
    if (!auth) return json(res, 403, { error: 'unauthorized_device' });
    let id = cleanText(body.id, 64) || crypto.randomUUID();
    const name = cleanText(body.name, 128) || 'BLOFY Playlist';
    const providerType = cleanText(body.providerType, 16).toLowerCase();
    const baseUrl = cleanText(body.baseUrl, 2048);
    const subscriber = /\/api\/v1\/subscribers\/xtream\/?$/.test(baseUrl);
    const username = cleanText(body.username, subscriber ? 4096 : 256);
    const password = cleanText(body.password, 256);
    const active = body.active !== false;
    if (!validType(providerType)) return rejectPlaylist(res, 'invalid_playlist');
    const urlError = playlistUrlValidation(baseUrl);
    if (urlError) return rejectPlaylist(res, urlError);
    if (providerType === 'xtream' && (!username || !password)) return rejectPlaylist(res, 'xtream_credentials_required');
    if (subscriber && String(body.username || '').trim().length > 4096) return rejectPlaylist(res, 'invalid_playlist');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE', [auth.deviceId]);
      const saved = await client.query('SELECT * FROM device_playlists WHERE device_id=$1', [auth.deviceId]);
      const identity = playlistIdentity({ providerType, baseUrl, username, password }, auth.deviceId, process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY);
      const safe = safePlaylistGroups(saved.rows, auth.deviceId, process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY, warnRejected);
      const match = safe.groups.find(group => group.identity === identity);
      if (match) id = match.primary.id;
      else if (!body.id) id = playlistUuid(identity);
      if (active) await client.query('UPDATE device_playlists SET active=FALSE,updated_at=NOW() WHERE device_id=$1', [auth.deviceId]);
      const result = await client.query(
        `INSERT INTO device_playlists(id,device_id,name,provider_type,base_url_enc,username_enc,password_enc,active,revision)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)
         ON CONFLICT(id) DO UPDATE SET
           name=EXCLUDED.name,provider_type=EXCLUDED.provider_type,base_url_enc=EXCLUDED.base_url_enc,
           username_enc=EXCLUDED.username_enc,password_enc=EXCLUDED.password_enc,active=EXCLUDED.active,
           revision=device_playlists.revision+1,updated_at=NOW()
         WHERE device_playlists.device_id=EXCLUDED.device_id
         RETURNING id,active,revision,updated_at`,
        [id, auth.deviceId, name, providerType, seal(baseUrl), seal(username), seal(password), active]
      );
      if (!result.rows[0]) { await client.query('ROLLBACK'); return json(res, 404, { error: 'playlist_not_found' }); }
      await recordAudit(client,auth.deviceId,'playlist_saved',{playlistId:id},'device');
      await client.query('COMMIT');
      const row = result.rows[0];
      return json(res, 200, { id: row.id, active: row.active, revision: Number(row.revision), updatedAt: new Date(row.updated_at).getTime() });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async function remove(req, res, id) {
    const body = await readJson(req);
    const auth = await authenticate(req, body);
    if (!auth) return json(res, 403, { error: 'unauthorized_device' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT device_id FROM devices WHERE device_id=$1 FOR UPDATE', [auth.deviceId]);
      const existing = await client.query('SELECT * FROM device_playlists WHERE device_id=$1', [auth.deviceId]);
      const safe = safePlaylistGroups(existing.rows, auth.deviceId, process.env.BLOFY_PLAYLIST_ENCRYPTION_KEY, warnRejected);
      const group = safe.groups.find(item => item.primary.id === id || item.aliases.includes(id));
      if (!group) {
        // A row with damaged encrypted fields cannot be rendered, but if the client still
        // knows its exact UUID from an earlier session allow deleting that exact row safely.
        const corruptMatch = safe.corruptIds.includes(id);
        if (!corruptMatch) { await client.query('ROLLBACK'); return json(res, 404, { error: 'playlist_not_found' }); }
        await client.query('DELETE FROM device_playlists WHERE device_id=$1 AND id=$2', [auth.deviceId, id]);
        await recordAudit(client,auth.deviceId,'playlist_removed',{playlistId:id,corrupt:true},'device');
        await client.query('COMMIT');
        return json(res, 200, { deleted: true, deletedIds: [id] });
      }
      const ids = [group.primary.id, ...group.aliases];
      await client.query('DELETE FROM device_playlists WHERE device_id=$1 AND id=ANY($2::uuid[])', [auth.deviceId, ids]);
      if (group.primary.active) {
        await client.query(`UPDATE device_playlists SET active=TRUE,updated_at=NOW() WHERE id=(SELECT id FROM device_playlists WHERE device_id=$1 ORDER BY updated_at DESC LIMIT 1)`, [auth.deviceId]);
      }
      await recordAudit(client,auth.deviceId,'playlist_removed',{playlistId:group.primary.id},'device');
      await client.query('COMMIT');
      return json(res, 200, { deleted: true, deletedIds: ids });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  return { list, upsert, remove };
}

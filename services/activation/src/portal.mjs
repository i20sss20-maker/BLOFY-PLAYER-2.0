import crypto from 'node:crypto';

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
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function cleanText(value, max = 256) { return String(value || '').trim().slice(0, max); }
function validType(value) { return value === 'xtream' || value === 'm3u'; }

export function createPortalHandlers({ pool, json, readJson, authorizedDevice }) {
  async function authenticate(body) {
    const deviceId = cleanText(body.deviceId, 64);
    const activationCode = cleanText(body.activationCode, 16);
    const device = await authorizedDevice(deviceId, activationCode);
    return device ? { deviceId, activationCode } : null;
  }

  async function list(req, res) {
    const body = await readJson(req);
    const auth = await authenticate(body);
    if (!auth) return json(res, 403, { error: 'unauthorized_device' });
    const result = await pool.query(
      `SELECT id,name,provider_type,base_url_enc,username_enc,password_enc,active,revision,updated_at
       FROM device_playlists WHERE device_id=$1 ORDER BY active DESC, updated_at DESC`, [auth.deviceId]
    );
    return json(res, 200, { items: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      providerType: row.provider_type,
      baseUrl: open(row.base_url_enc),
      username: open(row.username_enc),
      password: open(row.password_enc),
      active: row.active,
      revision: Number(row.revision),
      updatedAt: new Date(row.updated_at).getTime()
    })) });
  }

  async function upsert(req, res) {
    const body = await readJson(req);
    const auth = await authenticate(body);
    if (!auth) return json(res, 403, { error: 'unauthorized_device' });
    const id = cleanText(body.id, 64) || crypto.randomUUID();
    const name = cleanText(body.name, 128) || 'BLOFY Playlist';
    const providerType = cleanText(body.providerType, 16).toLowerCase();
    const baseUrl = cleanText(body.baseUrl, 2048);
    const username = cleanText(body.username, 256);
    const password = cleanText(body.password, 256);
    const active = body.active !== false;
    if (!validType(providerType) || !/^https?:\/\//i.test(baseUrl)) return json(res, 400, { error: 'invalid_playlist' });
    if (providerType === 'xtream' && (!username || !password)) return json(res, 400, { error: 'xtream_credentials_required' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
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
    const auth = await authenticate(body);
    if (!auth) return json(res, 403, { error: 'unauthorized_device' });
    const result = await pool.query('DELETE FROM device_playlists WHERE id=$1 AND device_id=$2 RETURNING id,active', [id, auth.deviceId]);
    const deleted = result.rows[0];
    if (!deleted) return json(res, 404, { error: 'playlist_not_found' });
    if (deleted.active) {
      await pool.query(`UPDATE device_playlists SET active=TRUE,updated_at=NOW() WHERE id=(SELECT id FROM device_playlists WHERE device_id=$1 ORDER BY updated_at DESC LIMIT 1)`, [auth.deviceId]);
    }
    return json(res, 200, { deleted: true });
  }

  return { list, upsert, remove };
}

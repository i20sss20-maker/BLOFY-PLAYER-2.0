import crypto from 'node:crypto';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';
import { selectedCodeSource, checkCodeAccount } from './code-account-status.mjs';

const CODE_HOST = 'http://annkel.com:80'; // Dedicated new source; NOT the STROING 8K host.
const CODE_PATTERN = /^[A-Z0-9-]{8,32}$/;
const loginLimit = createFixedWindowLimiter({ limit: 12, windowMs: 60_000 });

export function normalizedBlofyCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return CODE_PATTERN.test(code) ? code : null;
}

export function createBlofyCodeCrypto(secretHex) {
  if (!/^[0-9a-fA-F]{64}$/.test(String(secretHex))) throw Error('missing_code_crypto_secret');
  const sourceKey = Buffer.from(secretHex, 'hex');
  const key = crypto.createHmac('sha256', sourceKey).update('blofy-code-encryption-v1').digest();
  const proofKey = crypto.createHmac('sha256', sourceKey).update('blofy-code-proof-v1').digest();
  function proof(code) {
    const safe = normalizedBlofyCode(code);
    if (!safe) return null;
    return crypto.createHmac('sha256', proofKey).update(safe).digest('hex');
  }
  function seal(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }
  function open(value) {
    const packed = Buffer.from(String(value), 'base64url');
    if (packed.length < 29) throw Error('invalid_ciphertext');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
    decipher.setAuthTag(packed.subarray(12, 28));
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
  }
  return { proof, seal, open };
}

export function createBlofyCodeHandlers({ pool, secretHex, json, readJson, requireAdmin, authorizedDevice, checkAccount = checkCodeAccount, strongHost }) {
  const codec = createBlofyCodeCrypto(secretHex);

  // Numeric 8-digit codes: short for TV remotes yet 100 million possibilities.
  // The HMAC proof keeps the code secret in the database; collisions retry safely.
  async function issue(req, res) {
    if (!requireAdmin(req, res)) return;
    const input = await readJson(req);
    let selection;
    try {
      selection = selectedCodeSource(input, { strongHost });
      if (input.source == null && input.host && input.host !== selection.host)
        throw new Error('invalid_code_host');
    } catch {
      return json(res, 400, { error: 'invalid_code_host' });
    }
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    if (!username || !password || username.length > 256 || password.length > 512 ||
        /[\u0000-\u001f\u007f]/.test(username + password)) {
      return json(res, 400, { error: 'invalid_code_account' });
    }
    let account;
    try { account = await checkAccount({host: selection.host,username,password}); }
    catch (error) {
      const kind = String(error?.message || '');
      return json(res, kind === 'code_source_expired' || kind === 'code_source_credentials_invalid' ? 422 : 503,
        { error: ['code_source_expired','code_source_credentials_invalid'].includes(kind) ? kind : 'code_source_unavailable' });
    }
    const expiresAt = account.expiresAt ?? null;
    if (expiresAt != null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()))
      return json(res, 422, { error:'code_source_expired' });

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = crypto.randomInt(0, 100_000_000).toString().padStart(8, '0');
      const id = crypto.randomUUID();
      const result = await pool.query(
        `INSERT INTO blofy_code_subscriptions
         (id,code_proof,username_enc,password_enc,host_enc,source_label,expires_at,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
         ON CONFLICT(code_proof) DO NOTHING RETURNING id`,
        [id, codec.proof(code), codec.seal(username), codec.seal(password),
          codec.seal(selection.host), selection.label,
          expiresAt == null ? null : new Date(expiresAt)]
      );
      if (result.rows[0]) return json(res, 201,
        { code, providerId:id, host:selection.host, source:selection.source, expiresAt });
    }
    return json(res, 503, {error:'code_generation_unavailable'});
  }

  async function revoke(req, res, codeInput) {
    if (!requireAdmin(req, res)) return;
    const code = normalizedBlofyCode(codeInput);
    if (!code) return json(res, 400, { error: 'invalid_code' });
    const result = await pool.query(
      'UPDATE blofy_code_subscriptions SET active=FALSE,updated_at=NOW() WHERE code_proof=$1 RETURNING id',
      [codec.proof(code)]
    );
    return json(res, result.rowCount ? 200 : 404,
      result.rowCount ? { revoked: true } : { error: 'not_found' });
  }

  async function adminById(req, res, id, action) {
    if (!requireAdmin(req, res)) return;
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) return json(res, 400, { error: 'invalid_provider_id' });
    if (!['revoke','unbind','bind'].includes(action)) return json(res, 400, { error: 'invalid_action' });
    if (action === 'bind') {
      const input = await readJson(req);
      const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim().toUpperCase() : '';
      if (!/^BLOFY-[A-Z0-9-]{4,32}$/.test(deviceId))
        return json(res, 400, { error: 'invalid_device_id' });
      const device = await pool.query(
        'SELECT status,expires_at FROM devices WHERE device_id=$1 LIMIT 1', [deviceId]
      );
      const row = device.rows[0];
      if (!row || !['active','trial'].includes(row.status) ||
          (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()))
        return json(res, 422, { error:'code_device_inactive' });
      // Never hijack an existing binding: explicitly unbind first.
      const bound = await pool.query(
        'UPDATE blofy_code_subscriptions SET device_id=$2,updated_at=NOW() WHERE id=$1 AND active=TRUE AND device_id IS NULL RETURNING id',
        [id, deviceId]
      );
      return json(res, bound.rowCount ? 200 : 409,
        bound.rowCount ? { ok:true, deviceId } : { error:'code_already_bound_or_inactive' });
    }
    const result = action === 'revoke'
      ? await pool.query(
          'UPDATE blofy_code_subscriptions SET active=FALSE,updated_at=NOW() WHERE id=$1 RETURNING id',
          [id])
      : await pool.query(
          'UPDATE blofy_code_subscriptions SET device_id=NULL,updated_at=NOW() WHERE id=$1 AND active=TRUE RETURNING id',
          [id]);
    return json(res, result.rowCount ? 200 : 404,
      result.rowCount ? { ok: true } : { error: 'code_not_found_or_inactive' });
  }

  async function list(req, res) {
    if (!requireAdmin(req, res)) return;
    const result = await pool.query(
      'SELECT id,active,expires_at,device_id,created_at,source_label FROM blofy_code_subscriptions ORDER BY created_at DESC LIMIT 200'
    );
    return json(res, 200, { items: result.rows.map(row => ({
      providerId: row.id, active: row.active, boundDeviceId: row.device_id,
      source: row.source_label || 'BLOFY',
      expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
      createdAt: new Date(row.created_at).getTime()
    })) });
  }

  async function redeem(req, res) {
    const body = await readJson(req);
    const code = normalizedBlofyCode(body.code);
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.trim() : '';
    const activationCode = typeof body.activationCode === 'string' ? body.activationCode : '';
    const rate = loginLimit.consume(requestClientKey(req) + '|' + deviceId.slice(0,40));
    if (!rate.allowed) return json(res, 429, { error: 'rate_limited' },
      { 'retry-after': String(rate.retryAfterSeconds) });
    if (!code) return json(res, 400, { error: 'invalid_code' });
    const device = await authorizedDevice(deviceId, activationCode, req);
    if (!device) return json(res, 403, { error: 'device_not_active' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'SELECT * FROM blofy_code_subscriptions WHERE code_proof=$1 FOR UPDATE', [codec.proof(code)]
      );
      const row = result.rows[0];
      if (!row || !row.active || (row.device_id && row.device_id !== deviceId)) {
        await client.query('COMMIT');
        return json(res, 403, { error: 'code_unavailable' });
      }
      const username = codec.open(row.username_enc);
      const password = codec.open(row.password_enc);
      // Existing issued codes are preserved; newer numeric codes carry a sealed host.
      const host = row.host_enc ? codec.open(row.host_enc) : CODE_HOST;
      let expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
      if (row.host_enc) {
        try {
          const latest = await checkAccount({host,username,password});
          expiresAt = latest.expiresAt ?? null; // Reads provider renewal automatically.
        } catch (error) {
          await client.query('COMMIT');
          return json(res, 403, {error: String(error?.message || '') === 'code_source_expired'
            ? 'code_source_expired' : 'code_unavailable'});
        }
      } else if (expiresAt && expiresAt <= Date.now()) {
        await client.query('COMMIT');
        return json(res, 403, {error:'code_unavailable'});
      }
      await client.query(
        'UPDATE blofy_code_subscriptions SET device_id=COALESCE(device_id,$2),expires_at=$3,updated_at=NOW() WHERE id=$1',
        [row.id,deviceId,expiresAt == null ? null : new Date(expiresAt)]
      );
      await client.query('COMMIT');
      return json(res, 200, {
        delivery: 'direct', providerId: row.id, providerName: row.source_label || 'BLOFY',
        baseUrl: host, username, password, expiresAt
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { issue, revoke, list, redeem, adminById };
}

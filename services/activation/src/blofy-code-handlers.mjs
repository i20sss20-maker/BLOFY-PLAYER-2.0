import crypto from 'node:crypto';
import { createFixedWindowLimiter, requestClientKey } from './auth-protection.mjs';

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

export function createBlofyCodeHandlers({ pool, secretHex, json, readJson, requireAdmin, authorizedDevice }) {
  const codec = createBlofyCodeCrypto(secretHex);

  // Operator maps a one-time-issued code to a legitimate Xtream account.
  // No code or upstream secret is stored as plaintext in the database.
  async function issue(req, res) {
    if (!requireAdmin(req, res)) return;
    const input = await readJson(req);
    const username = typeof input.username === 'string' ? input.username.trim() : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const code = input.code == null
      ? crypto.randomBytes(10).toString('hex').toUpperCase()
      : normalizedBlofyCode(input.code);
    const expiresAt = input.expiresAt == null ? null : Number(input.expiresAt);
    if (!code || !username || !password || username.length > 256 || password.length > 512 ||
        (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()))) {
      return json(res, 400, { error: 'invalid_code_account' });
    }
    const id = crypto.randomUUID();
    const result = await pool.query(
      'INSERT INTO blofy_code_subscriptions (id,code_proof,username_enc,password_enc,expires_at,active) VALUES ($1,$2,$3,$4,$5,TRUE) ON CONFLICT(code_proof) DO NOTHING RETURNING id',
      [id, codec.proof(code), codec.seal(username), codec.seal(password),
       expiresAt == null ? null : new Date(expiresAt)]
    );
    if (!result.rows[0]) return json(res, 409, { error: 'code_exists' });
    return json(res, 201, { code, providerId: id, host: CODE_HOST, expiresAt });
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

  async function list(req, res) {
    if (!requireAdmin(req, res)) return;
    const result = await pool.query(
      'SELECT id,active,expires_at,device_id,created_at FROM blofy_code_subscriptions ORDER BY created_at DESC LIMIT 200'
    );
    return json(res, 200, { items: result.rows.map(row => ({
      providerId: row.id, active: row.active, boundDeviceId: row.device_id,
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
      const expired = row?.expires_at && new Date(row.expires_at).getTime() <= Date.now();
      if (!row || !row.active || expired || (row.device_id && row.device_id !== deviceId)) {
        await client.query('COMMIT');
        return json(res, 403, { error: 'code_unavailable' });
      }
      if (!row.device_id) {
        await client.query(
          'UPDATE blofy_code_subscriptions SET device_id=$2,updated_at=NOW() WHERE id=$1 AND device_id IS NULL',
          [row.id, deviceId]
        );
      }
      const username = codec.open(row.username_enc);
      const password = codec.open(row.password_enc);
      await client.query('COMMIT');
      return json(res, 200, {
        delivery: 'direct', providerId: row.id, providerName: 'BLOFY',
        baseUrl: CODE_HOST, username, password,
        expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  return { issue, revoke, list, redeem };
}

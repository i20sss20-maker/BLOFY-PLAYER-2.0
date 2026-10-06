import crypto from 'node:crypto';

const OAUTH_AUTHORIZE_URL = 'https://oauth.zid.sa/oauth/authorize';
const OAUTH_TOKEN_URL = 'https://oauth.zid.sa/oauth/token';
const VERIFY_ORDERS_URL = 'https://api.zid.sa/v1/managers/store/orders?payload_type=simple&page=1&per_page=1';
const TOKEN_AAD = Buffer.from('blofy-zid-oauth:v1', 'utf8');
const STATE_TTL_MINUTES = 10;

function clean(value, max = 2048) {
  return String(value ?? '').trim().slice(0, max);
}

function keyBuffer(keyHex) {
  const value = clean(keyHex, 128);
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('zid_oauth_key_invalid');
  return Buffer.from(value, 'hex');
}

function seal(value, keyHex) {
  const text = clean(value, 32768);
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function open(value, keyHex) {
  if (!value) return '';
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('zid_oauth_ciphertext_invalid');
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ciphertext = Buffer.from(parts[3], 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error('zid_oauth_ciphertext_invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  decipher.setAAD(TOKEN_AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS zid_oauth_states (
  state_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS zid_oauth_connections (
  store_id TEXT PRIMARY KEY,
  authorization_enc TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function ensureSchema(pool) {
  await pool.query(SCHEMA);
}

export async function loadZidOAuthTokens({ pool, keyHex, storeId }) {
  await ensureSchema(pool);
  const row = (await pool.query(
    'SELECT authorization_enc,access_token_enc,refresh_token_enc,expires_at FROM zid_oauth_connections WHERE store_id=$1 LIMIT 1',
    [String(storeId)]
  )).rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  return {
    authorization: open(row.authorization_enc, keyHex),
    accessToken: open(row.access_token_enc, keyHex),
    refreshToken: row.refresh_token_enc ? open(row.refresh_token_enc, keyHex) : '',
    expiresAt: row.expires_at ? new Date(row.expires_at) : null
  };
}

function html(res, status, title, message) {
  const body = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#0b0712;color:#fff;font-family:Tahoma,Arial,sans-serif;display:grid;place-items:center;min-height:100vh}.card{width:min(560px,calc(100% - 40px));background:#171020;border:1px solid #3c2857;border-radius:24px;padding:28px;box-sizing:border-box;text-align:center;box-shadow:0 24px 80px #0008}h1{margin:0 0 12px;color:#c9a5ff}p{line-height:1.9;color:#d5cedd;margin:0}</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000'
  });
  res.end(body);
}

export function createZidOAuthHandlers({ pool, json, keyHex, env = process.env, fetchImpl = globalThis.fetch }) {
  const clientId = clean(env.BLOFY_ZID_CLIENT_ID, 80);
  const clientSecret = clean(env.BLOFY_ZID_CLIENT_SECRET, 512);
  const redirectUri = clean(env.BLOFY_ZID_OAUTH_REDIRECT_URI || 'https://api.blofyplayer.com/api/v1/payments/zid/oauth/callback', 2048);
  const storeId = clean(env.BLOFY_ZID_STORE_ID, 80);
  const configured = Boolean(clientId && clientSecret && storeId && redirectUri.startsWith('https://'));

  async function install(req, res) {
    if (!configured) return html(res, 503, 'الربط غير مكتمل', 'بيانات تطبيق زد لم تكتمل في الخادم بعد.');
    await ensureSchema(pool);
    await pool.query('DELETE FROM zid_oauth_states WHERE expires_at<=NOW() OR consumed_at IS NOT NULL');
    const state = crypto.randomBytes(32).toString('base64url');
    const stateHash = crypto.createHash('sha256').update(state).digest('hex');
    await pool.query(
      `INSERT INTO zid_oauth_states(state_hash,expires_at)
       VALUES($1,NOW()+($2::text || ' minutes')::interval)
       ON CONFLICT(state_hash) DO NOTHING`,
      [stateHash, String(STATE_TTL_MINUTES)]
    );
    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    res.writeHead(302, {
      location: url.toString(),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff'
    });
    res.end();
  }

  async function consumeState(state) {
    const stateHash = crypto.createHash('sha256').update(String(state || '')).digest('hex');
    const result = await pool.query(
      `UPDATE zid_oauth_states SET consumed_at=NOW()
       WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>NOW()
       RETURNING state_hash`,
      [stateHash]
    );
    return Boolean(result.rows[0]);
  }

  async function exchangeCode(code) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code
    });
    const response = await fetchImpl(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw Object.assign(new Error('zid_oauth_token_exchange_failed'), { status: 502 });
    const payload = await response.json();
    const authorization = clean(payload.authorization ?? payload.Authorization, 32768);
    const accessToken = clean(payload.access_token, 32768);
    const refreshToken = clean(payload.refresh_token, 32768);
    const expiresIn = Number(payload.expires_in);
    if (!authorization || !accessToken) throw Object.assign(new Error('zid_oauth_tokens_missing'), { status: 502 });
    return {
      authorization,
      accessToken,
      refreshToken,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.min(expiresIn, 366 * 86400) : 365 * 86400
    };
  }

  async function verifyTokens(tokens) {
    const response = await fetchImpl(VERIFY_ORDERS_URL, {
      headers: {
        Authorization: tokens.authorization,
        'X-Manager-Token': tokens.accessToken,
        'Accept-Language': 'en',
        accept: 'application/json'
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw Object.assign(new Error('zid_oauth_verification_failed'), { status: 502 });
  }

  async function callback(req, res, url) {
    if (!configured) return html(res, 503, 'الربط غير مكتمل', 'بيانات تطبيق زد لم تكتمل في الخادم بعد.');
    const error = clean(url.searchParams.get('error'), 120);
    if (error) return html(res, 400, 'لم يكتمل الربط', 'تم إلغاء أو رفض تفويض تطبيق BLOFY PLAYER.');
    const code = clean(url.searchParams.get('code'), 4096);
    const state = clean(url.searchParams.get('state'), 256);
    if (!code || !state || !await consumeState(state)) {
      return html(res, 400, 'تعذر التحقق', 'رمز الربط غير صالح أو انتهت صلاحيته. أعد التفعيل من لوحة زد.');
    }
    try {
      const tokens = await exchangeCode(code);
      await verifyTokens(tokens);
      await ensureSchema(pool);
      const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
      await pool.query(
        `INSERT INTO zid_oauth_connections(store_id,authorization_enc,access_token_enc,refresh_token_enc,expires_at,updated_at)
         VALUES($1,$2,$3,$4,$5,NOW())
         ON CONFLICT(store_id) DO UPDATE SET
           authorization_enc=EXCLUDED.authorization_enc,
           access_token_enc=EXCLUDED.access_token_enc,
           refresh_token_enc=EXCLUDED.refresh_token_enc,
           expires_at=EXCLUDED.expires_at,
           updated_at=NOW()`,
        [
          storeId,
          seal(tokens.authorization, keyHex),
          seal(tokens.accessToken, keyHex),
          tokens.refreshToken ? seal(tokens.refreshToken, keyHex) : null,
          expiresAt
        ]
      );
      return html(res, 200, 'تم ربط BLOFY SAT بنجاح ✓', 'تم حفظ تفويض زد بشكل آمن في السيرفر. يمكنك إغلاق هذه الصفحة والعودة إلى لوحة زد.');
    } catch (exchangeError) {
      return html(res, Number(exchangeError?.status) || 502, 'فشل ربط زد', 'تعذر إكمال OAuth مع زد. أعد المحاولة بعد التحقق من إعدادات التطبيق.');
    }
  }

  async function status(req, res) {
    const tokens = configured ? await loadZidOAuthTokens({ pool, keyHex, storeId }).catch(() => null) : null;
    return json(res, 200, {
      configured,
      connected: Boolean(tokens),
      storeId: storeId || null,
      expiresAt: tokens?.expiresAt ? tokens.expiresAt.getTime() : null
    });
  }

  async function handler(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/v1/payments/zid/install') {
      await install(req, res);
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/payments/zid/oauth/callback') {
      await callback(req, res, url);
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/payments/zid/oauth/status') {
      await status(req, res);
      return true;
    }
    return false;
  }

  handler.configured = configured;
  handler.storeId = storeId;
  handler.loadTokens = () => loadZidOAuthTokens({ pool, keyHex, storeId });
  return handler;
}

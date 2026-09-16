import crypto from 'node:crypto';

const AAD = Buffer.from('blofy-subscriber-host-v1', 'utf8');
const VERSION = 'v1';

function keyBuffer(keyHex) {
  const value = String(keyHex || '').trim();
  if (!/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('subscriber_host_key_unavailable');
  return Buffer.from(value, 'hex');
}

export function normalizeLearnedSubscriberHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!url.hostname || url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function sealSubscriberHost(host, keyHex) {
  const normalized = normalizeLearnedSubscriberHost(host);
  if (!normalized) throw new Error('invalid_subscriber_host');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.');
}

export function openSubscriberHost(encoded, keyHex) {
  try {
    const [version, ivText, ciphertextText, tagText, extra] = String(encoded || '').split('.');
    if (version !== VERSION || extra !== undefined) return null;
    const iv = Buffer.from(ivText || '', 'base64url');
    const ciphertext = Buffer.from(ciphertextText || '', 'base64url');
    const tag = Buffer.from(tagText || '', 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer(keyHex), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return normalizeLearnedSubscriberHost(plaintext);
  } catch {
    return null;
  }
}

export async function ensureSubscriberHostStateTable(pool) {
  if (!pool) throw new Error('subscriber_host_database_unavailable');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blofy_subscriber_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      host_enc TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function loadPersistedSubscriberHost(pool, keyHex) {
  await ensureSubscriberHostStateTable(pool);
  const result = await pool.query('SELECT host_enc FROM blofy_subscriber_state WHERE id = 1 LIMIT 1');
  if (!result.rows?.length) return null;
  return openSubscriberHost(result.rows[0].host_enc, keyHex);
}

export async function savePersistedSubscriberHost(pool, keyHex, host) {
  const normalized = normalizeLearnedSubscriberHost(host);
  if (!normalized) throw new Error('invalid_subscriber_host');
  const encoded = sealSubscriberHost(normalized, keyHex);
  await ensureSubscriberHostStateTable(pool);
  await pool.query(
    `INSERT INTO blofy_subscriber_state (id, host_enc, updated_at)
     VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET host_enc = EXCLUDED.host_enc, updated_at = NOW()`,
    [encoded]
  );
  return normalized;
}

export async function discoverSubscriberHost({ bootstrapBaseUrl, deviceId, activationCode, username, password, fetchImpl = fetch }) {
  const bootstrap = normalizeLearnedSubscriberHost(bootstrapBaseUrl);
  if (!bootstrap) throw new Error('subscriber_bootstrap_unavailable');
  const response = await fetchImpl(`${bootstrap}/api/v1/subscribers/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, activationCode, username, password, delivery: 'direct' }),
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000)
  });
  let payload = null;
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'subscriber_login_failed' : 'subscriber_bootstrap_failed');
    error.status = response.status;
    throw error;
  }
  const host = normalizeLearnedSubscriberHost(payload?.baseUrl);
  if (!host || payload?.delivery !== 'direct') throw new Error('subscriber_bootstrap_invalid_response');
  return host;
}

export const SANDBOX_PROJECT = 'BLOFY-Geidea-Sandbox';
export const PRICE_MINOR = 100;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fault(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

export function loadConfig(env = process.env) {
  if (env.BLOFY_GEIDEA_TEST_MODE !== 'enabled' || env.GEIDEA_CREDENTIALS_ENVIRONMENT !== 'test') {
    throw fault('sandbox_test_mode_required');
  }
  // This executable has no activation imports or production data access. Reject
  // accidental configuration copied from the real BLOFY backend as well.
  if (['DATABASE_URL', 'DATABASE_PUBLIC_URL', 'BLOFY_ADMIN_TOKEN', 'TAP_SECRET_KEY',
    'GEIDEA_API_PASSWORD', 'GEIDEA_MERCHANT_PUBLIC_KEY'].some(key => env[key])) {
    throw fault('sandbox_production_configuration_forbidden');
  }
  if (env.GEIDEA_TEST_PRICE_MINOR && env.GEIDEA_TEST_PRICE_MINOR !== String(PRICE_MINOR)) {
    throw fault('sandbox_price_is_fixed');
  }
  const publicKey = env.GEIDEA_TEST_MERCHANT_PUBLIC_KEY;
  const password = env.GEIDEA_TEST_API_PASSWORD;
  const adminToken = env.BLOFY_GEIDEA_ADMIN_TOKEN;
  if (!UUID.test(publicKey ?? '') || typeof password !== 'string' || password.trim().length < 8) {
    throw fault('sandbox_test_credentials_required');
  }
  if (typeof adminToken !== 'string' || adminToken.length < 32 ||
      [password, publicKey].includes(adminToken)) throw fault('sandbox_admin_token_required');
  let url;
  try { url = new URL(env.BLOFY_GEIDEA_PUBLIC_URL); } catch { throw fault('sandbox_public_url_required'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/' || url.port || !url.hostname.endsWith('.up.railway.app')) {
    throw fault('sandbox_railway_https_origin_required');
  }
  const deployed = Boolean(env.RAILWAY_PROJECT_ID);
  if (deployed && (env.RAILWAY_PROJECT_NAME !== SANDBOX_PROJECT ||
      !UUID.test(env.BLOFY_GEIDEA_SANDBOX_PROJECT_ID ?? '') ||
      env.RAILWAY_PROJECT_ID !== env.BLOFY_GEIDEA_SANDBOX_PROJECT_ID ||
      env.RAILWAY_PUBLIC_DOMAIN !== url.hostname || env.RAILWAY_VOLUME_MOUNT_PATH !== '/data')) {
    throw fault('sandbox_railway_isolation_required');
  }
  const dbPath = env.BLOFY_GEIDEA_DB_PATH || '/data/geidea-sandbox.sqlite';
  if (deployed && dbPath !== '/data/geidea-sandbox.sqlite') throw fault('sandbox_volume_required');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw fault('sandbox_invalid_port');
  return Object.freeze({
    publicKey, password, adminToken, publicOrigin: url.origin,
    dbPath, port, host: deployed ? '0.0.0.0' : '127.0.0.1',
    revision: /^[a-f0-9]{40}$/i.test(env.RAILWAY_GIT_COMMIT_SHA ?? '') ? env.RAILWAY_GIT_COMMIT_SHA : null,
  });
}

export function amountMinor(value) {
  if (typeof value !== 'number' && typeof value !== 'string') throw fault('geidea_invalid_amount');
  const text = String(value);
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) throw fault('geidea_invalid_amount');
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor)) throw fault('geidea_invalid_amount');
  return minor;
}

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { playlistUrlValidation } from './portal.mjs';

function decrypt(value, key) {
  if (!value) return '';
  const data = Buffer.from(value, 'base64url');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}

export function readAccount(row, env = process.env, now = Date.now()) {
  if (row.provider_type !== 'xtream') return { error: 'unsupported' };
  try {
    const key = Buffer.from(env.BLOFY_PLAYLIST_ENCRYPTION_KEY || '', 'hex');
    let baseUrl = decrypt(row.base_url_enc, key);
    let username = decrypt(row.username_enc, key);
    let password = decrypt(row.password_enc, key);
    if (/\/api\/v1\/subscribers\/xtream\/?$/.test(baseUrl)) {
      const session = JSON.parse(decrypt(username, key));
      if (session.d !== row.device_id || !Number.isFinite(session.exp) || session.exp <= now) return { error: 'session_expired' };
      baseUrl = env.BLOFY_SUBSCRIBER_HOST || '';
      username = session.u; password = session.p;
    }
    if (playlistUrlValidation(baseUrl) || !username || !password) return { error: 'invalid_account' };
    const url = new URL(baseUrl.replace(/\/$/, '') + '/player_api.php');
    url.searchParams.set('username', username); url.searchParams.set('password', password);
    return { url };
  } catch { return { error: 'invalid_account' }; }
}

export function summarizeAccount(payload, now = Date.now()) {
  const user = payload?.user_info;
  if (!user || typeof user !== 'object') return { state: 'unknown' };
  const number = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
  const expires = number(user.exp_date);
  const expiresAt = expires && expires > 0 ? expires * 1000 : null;
  const connections = number(user.active_cons);
  const limit = number(user.max_connections);
  const status = String(user.status || '').toLowerCase();
  const state = status === 'expired' || (expiresAt && expiresAt <= now) ? 'expired'
    : ['banned', 'blocked', 'disabled'].includes(status) ? 'blocked'
    : user.auth != null && Number(user.auth) !== 1 ? 'invalid_account'
    : status !== 'active' ? 'unknown'
    : connections != null && limit > 0 && connections >= limit ? 'connection_limit' : 'active';
  return { state, expiresAt, connections, limit };
}

/** Resolve once and pin the public address for the request. Never follow a provider redirect. */
export async function probeAccount(row, { env = process.env, resolve = lookup, request = null, now = Date.now } = {}) {
  const started = now();
  const account = readAccount(row, env, started);
  if (account.error) return { state: account.error, checkedAt: started };
  let result;
  try {
    const addresses = await Promise.race([
      resolve(account.url.hostname.replace(/^\[|\]$/g, ''), { all: true }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'ETIMEOUT' })), 4000); timer.unref?.(); })
    ]);
    if (!addresses.length || addresses.some(({address}) => playlistUrlValidation(`http://${address.includes(':') ? '['+address+']' : address}/`))) {
      return { state: 'unreachable', checkedAt: now() };
    }
    const selected = addresses[0];
    result = await new Promise(resolveResult => {
      let settled = false;
      let req;
      const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolveResult(value); };
      const timer = setTimeout(() => { finish({state:'timeout'}); req?.destroy(); }, 8000);
      const send = request || (account.url.protocol === 'https:' ? https.request : http.request);
      req = send(account.url, {
        method: 'GET', headers: { accept: 'application/json', 'user-agent': 'BLOFY-Account-Check/1.0', 'accept-encoding': 'identity' },
        lookup(_host, options, callback) { callback(null, options?.all ? [selected] : selected.address, selected.family); }
      }, response => {
        if (response.statusCode !== 200) {
          response.destroy(); finish({state: [401,403].includes(response.statusCode) ? 'invalid_account' : 'unreachable'}); return;
        }
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 65_536) { finish({state:'unknown'}); response.destroy(); } else chunks.push(chunk);
        });
        response.on('error', () => finish({state:'unreachable'}));
        response.on('end', () => {
          try { finish(summarizeAccount(JSON.parse(Buffer.concat(chunks).toString('utf8')), now())); }
          catch { finish({state:'unknown'}); }
        });
      });
      req.on('error', error => finish({state: ['ETIMEDOUT','ETIMEOUT'].includes(error.code) ? 'timeout' : 'unreachable'}));
      req.end();
    });
  } catch (error) { result = {state: ['ENOTFOUND','EAI_AGAIN'].includes(error.code) ? 'dns' : error.code === 'ETIMEOUT' ? 'timeout' : 'unreachable'}; }
  return {...result, checkedAt: now(), elapsedMs: Math.max(0, now() - started)};
}

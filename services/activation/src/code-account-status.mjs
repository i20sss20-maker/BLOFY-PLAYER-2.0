import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { assertPublicXtreamUrl, isBlockedNetworkAddress, normalizeXtreamBaseUrl, xtreamApiUrl } from './xtream-core.mjs';
import { summarizeAccount } from './account-health.mjs';

export const BLOFY_CODE_DEFAULT_HOST = 'http://annkel.com:80';
const MAX_RESPONSE_BYTES = 65_536;

export function selectedCodeSource(input, { strongHost = process.env.BLOFY_CODE_STRONG_HOST || BLOFY_CODE_DEFAULT_HOST } = {}) {
  const source = String(input?.source || 'blofy').toLowerCase();
  if (!['blofy', 'strong', 'custom'].includes(source)) throw new Error('invalid_code_source');
  const value = source === 'blofy' ? BLOFY_CODE_DEFAULT_HOST
    : source === 'strong' ? strongHost : String(input?.host || '');
  let url;
  try { url = new URL(normalizeXtreamBaseUrl(value)); } catch { throw new Error('invalid_code_host'); }
  if (!['http:', 'https:'].includes(url.protocol) ||
      !url.hostname || url.pathname !== '/' ||
      url.search || url.hash || url.username || url.password ||
      url.hostname.length > 253 || !['', '/'].includes(url.pathname)) throw new Error('invalid_code_host');
  const host = url.protocol === 'http:' && url.hostname.toLowerCase() === 'annkel.com' && !url.port
    ? BLOFY_CODE_DEFAULT_HOST : url.toString().replace(/\/$/, '');
  // A host must never be inferred from an untrusted redirect or from URL credentials.
  // The admin sets it explicitly, and code redemption obtains the sealed original host.
  return { source, label: source === 'strong' ? 'STROING 8K' : source === 'blofy' ? 'BLOFY' : 'Xtream', host };
}

/**
 * Uses only public resolved IPs and pins the selected DNS result on the request.
 * No redirects or proxies. Account credentials are never logged.
 */
export async function checkCodeAccount({ host, username, password }, {
  lookup = dns.lookup, timeoutMs = 8_000, now = Date.now
} = {}) {
  const base = await assertPublicXtreamUrl(host, lookup);
  const url = xtreamApiUrl(base, username, password);
  const records = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('code_source_timeout')), 4_000).unref?.())
  ]);
  if (!Array.isArray(records) || !records.length || records.some(r => isBlockedNetworkAddress(r.address))) {
    throw new Error('invalid_code_host');
  }
  const chosen = records[0];
  const requestFn = url.protocol === 'https:' ? https.request : http.request;
  const payload = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, data) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve(data);
    };
    const req = requestFn(url, {
      method: 'GET',
      headers: { 'accept': 'application/json', 'accept-encoding': 'identity', 'user-agent': 'BLOFY-Code-Account/1.0' },
      lookup(_host, opts, callback) {
        callback(null, opts?.all ? [chosen] : chosen.address, chosen.family);
      },
      timeout: timeoutMs
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        finish(new Error(res.statusCode === 401 || res.statusCode === 403 ? 'code_source_credentials_invalid' : 'code_source_unavailable'));
        return;
      }
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          res.destroy(); finish(new Error('code_source_response_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', () => finish(new Error('code_source_unavailable')));
      res.on('end', () => {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { finish(new Error('code_source_response_invalid')); }
      });
    });
    req.on('timeout', () => { req.destroy(); finish(new Error('code_source_timeout')); });
    req.on('error', () => finish(new Error('code_source_unavailable')));
    req.end();
  });
  const account = summarizeAccount(payload, now());
  if (!['active','connection_limit'].includes(account.state)) {
    throw new Error(account.state === 'expired' ? 'code_source_expired' :
      ['blocked','invalid_account'].includes(account.state) ? 'code_source_credentials_invalid' :
      'code_source_unavailable');
  }
  return { expiresAt: account.expiresAt, status: account.state };
}

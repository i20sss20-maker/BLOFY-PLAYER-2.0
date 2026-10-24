import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { loadConfig, fault, PRICE_MINOR, UUID } from './config.mjs';
import { OrderStore, publicOrder } from './store.mjs';
import { createSession, reconcile, verifyCallback, safeError } from './provider.mjs';

const NETWORKS = ['visa', 'mastercard', 'mada'];
const SCENARIOS = ['success', 'decline', 'cancel'];
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
// Geidea can return in a new tab without the dashboard's Basic credentials.
// These static files disclose no order data and never interpret redirect input.
const RETURN_ASSETS = new Map([
  ['/return', ['return.html', 'text/html; charset=utf-8']],
  ['/return.css', ['return.css', 'text/css; charset=utf-8']],
]);

function authenticated(req, token) {
  const actual = createHash('sha256').update(String(req.headers.authorization ?? '')).digest();
  const expected = createHash('sha256').update('Basic ' + Buffer.from('sandbox:' + token).toString('base64')).digest();
  return timingSafeEqual(actual, expected);
}

async function jsonBody(req, limit) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw fault('sandbox_json_required', 415);
  }
  if (Number(req.headers['content-length'] || 0) > limit) throw fault('sandbox_body_too_large', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fault('sandbox_body_too_large', 413);
    chunks.push(chunk);
  }
  let data;
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fault('sandbox_invalid_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw fault('sandbox_invalid_json');
  return data;
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createSandboxServer({ config, store = new OrderStore(config.dbPath), fetchImpl = fetch }) {
  const inflight = new Map();
  const orderJobs = new Map();
  const limits = new Map();
  const gate = (name, max) => {
    const window = Math.floor(Date.now() / 60000);
    const previous = limits.get(name);
    const count = previous?.window === window ? previous.count + 1 : 1;
    limits.set(name, { window, count });
    if (count > max) throw fault('sandbox_rate_limited', 429);
  };
  // Serialize callbacks and manual reconciliation for each order. The SQLite
  // transaction records the final evidence and callback receipt atomically.
  const withOrder = (reference, action) => {
    const previous = orderJobs.get(reference) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(action);
    orderJobs.set(reference, job);
    void job.finally(() => { if (orderJobs.get(reference) === job) orderJobs.delete(reference); }).catch(() => {});
    return job;
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('strict-transport-security', 'max-age=31536000');
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, config.publicOrigin);
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { status: 'ok', mode: 'sandbox', service: 'blofy-geidea-sandbox',
          activationsEnabled: false, amountMinor: PRICE_MINOR, currency: 'SAR', revision: config.revision });
      }
      if (req.method === 'GET' && RETURN_ASSETS.has(url.pathname)) {
        const [name, type] = RETURN_ASSETS.get(url.pathname);
        const data = await readFile(new URL('../web/' + name, import.meta.url));
        res.writeHead(200, { 'content-type': type });
        return res.end(data);
      }
      if (req.method === 'POST' && url.pathname === '/api/geidea/callback') {
        gate('callback', 90);
        const payload = await jsonBody(req, 256 * 1024);
        const reference = payload.order?.merchantReferenceId;
        if (!UUID.test(reference ?? '')) throw fault('geidea_unknown_reference', 404);
        await withOrder(reference, async () => {
          const order = store.get(reference);
          if (!order) throw fault('geidea_unknown_reference', 404);
          const digest = verifyCallback(payload, order, config);
          if (store.hasCallback(digest)) return;
          // No success decision is made from a browser event or callback alone.
          // Failed provider reads return non-2xx, allowing Geidea to retry.
          const verified = await reconcile(config, order, fetchImpl, payload.order.orderId);
          store.commitVerified(reference, { ...verified, callbackVerified: 1 }, digest);
        });
        return send(res, 200, { received: true, mode: 'sandbox', activationsEnabled: false });
      }
      if (!authenticated(req, config.adminToken)) {
        gate('auth', 60);
        res.setHeader('www-authenticate', 'Basic realm="BLOFY Geidea Sandbox", charset="UTF-8"');
        return send(res, 401, { error: 'sandbox_authentication_required' });
      }
      if (req.method === 'GET' && ASSETS.has(url.pathname)) {
        const [name, type] = ASSETS.get(url.pathname);
        const data = await readFile(new URL('../web/' + name, import.meta.url));
        res.writeHead(200, { 'content-type': type });
        return res.end(data);
      }
      if (req.method === 'GET' && url.pathname === '/api/orders') {
        return send(res, 200, { mode: 'sandbox', amountMinor: PRICE_MINOR, currency: 'SAR',
          activationsEnabled: false, orders: store.list().map(publicOrder) });
      }
      if (req.method === 'GET' && url.pathname === '/api/evidence') {
        res.setHeader('content-disposition', 'attachment; filename="BLOFY-Geidea-Sandbox-evidence.json"');
        return send(res, 200, { generatedAt: new Date().toISOString(), mode: 'sandbox',
          revision: config.revision, activationsEnabled: false,
          // The network selected in the UI is a test intention. Only the network
          // returned by Geidea counts as evidence of a network-specific success.
          matrix: NETWORKS.map(network => ({ network, scenarios: SCENARIOS.map(scenario => ({
            scenario, verified: store.list().some(order => order.scenario === scenario &&
              order.observedNetwork === network && order.providerVerified === 1 && order.callbackVerified === 1 &&
              order.status === ({ success: 'paid', decline: 'failed', cancel: 'cancelled' })[scenario]),
          })) })), orders: store.list().map(publicOrder) });
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== config.publicOrigin || req.headers['sec-fetch-site'] === 'cross-site') {
          throw fault('sandbox_origin_rejected', 403);
        }
        if (url.pathname === '/api/sessions') {
          const body = await jsonBody(req, 1024);
          if (Object.keys(body).some(key => !['network', 'scenario'].includes(key)) ||
              !NETWORKS.includes(body.network) || !SCENARIOS.includes(body.scenario)) {
            throw fault('sandbox_invalid_test_case');
          }
          const key = req.headers['idempotency-key'];
          if (typeof key !== 'string' || !UUID.test(key)) throw fault('sandbox_idempotency_key_required');
          let order = store.byKey(key);
          if (order && (order.network !== body.network || order.scenario !== body.scenario)) {
            throw fault('sandbox_idempotency_conflict', 409);
          }
          if (!order) {
            gate('create', 5);
            order = store.create(key, body.network, body.scenario);
            const job = (async () => {
              try {
                const session = await createSession(config, order.reference, fetchImpl);
                // A fast callback may have arrived while the create request was
                // in flight. Persist the session without overwriting its result.
                const current = store.get(order.reference);
                store.patch(order.reference, { sessionId: session.sessionId, expiresAt: session.expiresAt,
                  ...(current.status === 'creating' ? { status: 'pending' } : {}) });
              } catch (error) {
                const current = store.get(order.reference);
                if (current.status === 'creating') store.patch(order.reference, {
                  status: 'create_unknown', errorCode: safeError(error),
                });
              }
            })();
            inflight.set(key, job);
            void job.finally(() => inflight.delete(key)).catch(() => {});
          }
          if (inflight.has(key)) await inflight.get(key);
          const current = store.byKey(key);
          return send(res, current.sessionId ? 200 : 502, {
            order: publicOrder(current),
            checkoutUrl: current.status === 'pending' && Date.parse(current.expiresAt) > Date.now() ?
              'https://www.ksamerchant.geidea.net/hpp/checkout/?' + current.sessionId : null,
            activationsEnabled: false,
          });
        }
        const match = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/reconcile$/i);
        if (match) {
          gate('reconcile', 30);
          const body = await jsonBody(req, 1024);
          if (Object.keys(body).length) throw fault('sandbox_reconcile_body_must_be_empty');
          const reference = match[1];
          const updated = await withOrder(reference, async () => {
            const order = store.get(reference);
            if (!order) throw fault('geidea_unknown_reference', 404);
            const verified = await reconcile(config, order, fetchImpl);
            return verified ? store.commitVerified(reference, verified) : order;
          });
          return send(res, 200, { order: publicOrder(updated), activationsEnabled: false });
        }
      }
      send(res, 404, { error: 'sandbox_not_found' });
    } catch (error) {
      if (!res.headersSent) send(res, error.status || 500, { error: safeError(error), activationsEnabled: false });
      else res.end();
    }
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 30000;
  return { server, store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig();
    const { server, store } = createSandboxServer({ config });
    server.listen(config.port, config.host, () => console.info('BLOFY Geidea sandbox ready; activations disabled'));
    server.on('error', () => { console.error('sandbox_server_error'); process.exitCode = 1; });
    const stop = () => server.close(() => { store.close(); process.exit(0); });
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}

// Real PostgreSQL and independent HTTP processes; never run against customer data.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import pg from 'pg';
import { createAdminSessionStore } from '../src/admin-session-store.mjs';

const databaseUrl = process.env.BLOFY_TEST_DATABASE_URL;
assert.ok(databaseUrl, 'BLOFY_TEST_DATABASE_URL must identify a dedicated local *_test database');
const parsed = new URL(databaseUrl);
assert.ok(['localhost', '127.0.0.1', 'postgres'].includes(parsed.hostname) && /^\/[a-z0-9_]+_test$/.test(parsed.pathname),
  'Only a dedicated local *_test database is allowed');
const schema = 'admin_auth_test_' + crypto.randomBytes(10).toString('hex');
const options = { connectionString: databaseUrl, ssl: false, max: 8,
  connectionTimeoutMillis: 4000, statement_timeout: 5000, options: '-c search_path=' + schema };
const maintenance = new pg.Pool({ connectionString: databaseUrl, ssl: false });
const aPool = new pg.Pool(options), bPool = new pg.Pool(options);
const children = new Set();
const request = async (base, path, { method = 'GET', cookie, origin = base, authorization, body } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  const response = await fetch(base + path, { method, headers,
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
};
async function stop(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const done = once(child, 'exit'); child.kill('SIGTERM'); await done;
  }
  children.delete(child);
}
async function start(env) {
  const source = `import http from 'node:http';
    await import('./src/admin-session-hook.mjs');
    const server=http.createServer((req,res)=>{
      const restricted=req.url.startsWith('/api/v1/admin/');
      const ok=!restricted||req.headers.authorization==='Bearer '+process.env.BLOFY_ADMIN_TOKEN;
      res.writeHead(ok?200:401,{'content-type':'application/json'});res.end(JSON.stringify({ok}));
    });
    server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({port:server.address().port})+'\\n'));
    process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, ...env, DATABASE_URL: databaseUrl, PGSSLMODE: 'disable',
      PGOPTIONS: '-c search_path=' + schema, VERCEL_ENV: '', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  children.add(child);
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('HTTP fixture startup timeout')), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('HTTP fixture exited')); });
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.includes('\n')) { clearTimeout(timeout); resolve(JSON.parse(output.split('\n')[0]).port); }
    });
    child.stderr.resume();
  });
  return { child, base: 'http://127.0.0.1:' + port };
}

try {
  await maintenance.query('CREATE SCHEMA ' + schema);
  const key = crypto.randomBytes(32);
  const a = createAdminSessionStore({ key, pool: aPool }), b = createAdminSessionStore({ key, pool: bPool });
  await test('simultaneous cold starts create the schema safely and do not authorize unknown sessions', async () => {
    assert.deepEqual(await Promise.all([a.active('absent'), b.active('absent')]), [false, false]);
  });
  await test('concurrent login attempts share exactly twelve allowances, including after a new store starts', async () => {
    const attempts = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).consumeLogin('192.0.2.25')));
    assert.equal(attempts.filter(x => x.allowed).length, 12);
    assert.ok(attempts.every(x => x.retryAfterSeconds > 0 && x.retryAfterSeconds <= 900));
    const restarted = createAdminSessionStore({ key, pool: bPool });
    assert.equal((await restarted.consumeLogin('192.0.2.25')).allowed, false);
    const persisted = await aPool.query('SELECT * FROM admin_login_limits');
    assert.equal(persisted.rowCount, 2);
    assert.ok(persisted.rows.every(x => /^[a-f0-9]{64}$/.test(x.key_hash) && /^[a-f0-9]{64}$/.test(x.scope)));
    assert.ok(!JSON.stringify(persisted.rows).includes('192.0.2.25'));
  });
  await test('account budget bounds rotating client keys and denied attempts do not extend the window', async () => {
    await aPool.query('TRUNCATE admin_login_limits');
    const attempts = await Promise.all(Array.from({ length: 150 }, (_, i) => (i % 2 ? a : b).consumeLogin('client-' + i)));
    assert.equal(attempts.filter(x => x.allowed).length, 120);
    assert.equal((await aPool.query('SELECT COUNT(*)::integer AS count FROM admin_login_limits')).rows[0].count, 121);
    const before = (await aPool.query('SELECT MAX(expires_at) AS latest FROM admin_login_limits')).rows[0].latest;
    assert.equal((await b.consumeLogin('new-client')).allowed, false);
    const after = (await aPool.query('SELECT MAX(expires_at) AS latest FROM admin_login_limits')).rows[0].latest;
    assert.equal(after.getTime(), before.getTime());
    await aPool.query("UPDATE admin_login_limits SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal((await b.consumeLogin('192.0.2.25')).allowed, true);
    assert.equal((await aPool.query('SELECT COUNT(*)::integer AS count FROM admin_login_limits')).rows[0].count, 2);
  });
  await test('revocation persists, isolates other sessions and stores neither cookies nor raw nonces', async () => {
    const first = crypto.randomBytes(16).toString('base64url'), second = crypto.randomBytes(16).toString('base64url');
    await a.create(first, Date.now() + 3600000); await b.create(second, Date.now() + 3600000);
    assert.equal(await b.active(first), true); await b.revoke(first);
    assert.equal(await createAdminSessionStore({ key, pool: aPool }).active(first), false);
    assert.equal(await a.active(second), true); await a.revoke(first); assert.equal(await b.active(first), false);
    const data = await aPool.query('SELECT * FROM admin_web_sessions');
    assert.equal(data.rowCount, 1); assert.match(data.rows[0].nonce_hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(data.rows).includes(second));
    assert.equal(await createAdminSessionStore({ key: crypto.randomBytes(32), pool: bPool }).active(second), false);
    await aPool.query("UPDATE admin_web_sessions SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal(await b.active(second), false);
  });
  await test('independent HTTP processes: login, CSRF checks, logout replay, restart, and database failure', async () => {
    const env = { BLOFY_ADMIN_TOKEN: crypto.randomBytes(32).toString('hex'),
      BLOFY_ADMIN_USERNAME: 'isolated-admin', BLOFY_ADMIN_PASSWORD: crypto.randomBytes(32).toString('hex') };
    const first = await start(env), second = await start(env);
    const login = async base => {
      const res = await request(base, '/api/v1/admin/session/login', { method: 'POST',
        body: { username: env.BLOFY_ADMIN_USERNAME, password: env.BLOFY_ADMIN_PASSWORD } });
      assert.equal(res.status, 200); assert.match(res.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
      return res.headers.get('set-cookie').split(';')[0];
    };
    const firstCookie = await login(first.base), secondCookie = await login(second.base);
    assert.equal((await request(second.base, '/api/v1/admin/test', { cookie: firstCookie })).status, 200);
    assert.equal((await request(first.base, '/api/v1/admin/test')).status, 401);
    for (const extra of [{ origin: 'https://foreign.invalid' }, { origin: null, authorization: 'Bearer incorrect' }]) {
      assert.equal((await request(first.base, '/api/v1/admin/test', { method: 'POST', cookie: firstCookie, ...extra })).status, 403);
    }
    assert.equal((await request(first.base, '/api/v1/admin/test', { method: 'POST', cookie: firstCookie })).status, 200);
    const logout = await request(first.base, '/api/v1/admin/session/logout', { method: 'POST', cookie: firstCookie });
    assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await request(second.base, '/api/v1/admin/test', { cookie: firstCookie })).status, 401);
    await stop(first.child); const restarted = await start(env);
    assert.equal((await request(restarted.base, '/api/v1/admin/test', { cookie: firstCookie })).status, 401);
    assert.equal((await request(restarted.base, '/api/v1/admin/test', { cookie: secondCookie })).status, 200);
    await aPool.query('ALTER TABLE admin_web_sessions RENAME TO unavailable_web_sessions');
    try {
      assert.equal((await request(second.base, '/api/v1/admin/test', { cookie: secondCookie })).status, 503);
      const failed = await request(second.base, '/api/v1/admin/session/logout', { method: 'POST', cookie: secondCookie });
      assert.equal(failed.status, 503); assert.equal(failed.headers.get('set-cookie'), null);
      const loginFailure = await request(second.base, '/api/v1/admin/session/login', { method: 'POST',
        body: { username: env.BLOFY_ADMIN_USERNAME, password: env.BLOFY_ADMIN_PASSWORD } });
      assert.equal(loginFailure.status, 503); assert.equal(loginFailure.headers.get('set-cookie'), null);
      assert.equal((await request(second.base, '/api/v1/admin/test', { cookie: secondCookie,
        authorization: 'Bearer ' + env.BLOFY_ADMIN_TOKEN, origin: null })).status, 200);
      assert.equal((await request(second.base, '/health', { cookie: secondCookie })).status, 200);
    } finally { await aPool.query('ALTER TABLE unavailable_web_sessions RENAME TO admin_web_sessions'); }
    assert.equal((await request(second.base, '/api/v1/admin/test', { cookie: secondCookie })).status, 200);
    await Promise.all([...children].map(stop));
  });
} finally {
  await Promise.all([...children].map(stop));
  await Promise.all([aPool.end(), bPool.end()]);
  await maintenance.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
  await maintenance.end();
}

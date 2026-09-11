import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { loadHooks } from './helpers/hook-harness.mjs';

const env = { DATABASE_URL: 'fixture', BLOFY_ADMIN_TOKEN: 'fixture-admin-token-at-least-24-characters', BLOFY_ADMIN_USERNAME: 'admin', BLOFY_ADMIN_PASSWORD: 'fixture-password' };

async function adminHooks(items = []) {
  const bootstrap = await readFile(new URL('../src/bootstrap.mjs', import.meta.url), 'utf8');
  const names = [...bootstrap.matchAll(/import '\.\/([^']+)';/g)].map((m) => m[1])
    .filter((name) => ['admin-session-hook.mjs', 'zid-commerce-hook.mjs'].includes(name));
  const pool = { async query(sql) { return { rows: sql.includes('FROM devices d') ? items : [] }; } };
  return loadHooks(names, { env, pool });
}

test('bootstrap session login owns /admin and authenticates downstream admin API cookies', async () => {
  const hooks = await adminHooks([{ device_id: 'BLOFY-TEST-ADMIN' }]);
  const loggedOut = await hooks.request('/admin');
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.body, /id="admin-login"/);
  assert.doesNotMatch(loggedOut.body, /Admin token|sessionStorage/);
  const denied = await hooks.request('/api/v1/admin/users');
  assert.equal(denied.status, 401);
  const login = await hooks.request('/api/v1/admin/session/login', { method: 'POST', body: { username: env.BLOFY_ADMIN_USERNAME, password: env.BLOFY_ADMIN_PASSWORD } });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'];
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  const dashboard = await hooks.request('/admin', { headers: { cookie } });
  assert.match(dashboard.body, /id="grant-form"/);
  assert.match(dashboard.body, /src="\/experience.js"/);
  const users = await hooks.request('/api/v1/admin/users', { headers: { cookie } });
  assert.equal(users.status, 200);
  assert.equal(JSON.parse(users.body).items[0].device_id, 'BLOFY-TEST-ADMIN');
  const tampered = await hooks.request('/api/v1/admin/users', { headers: { cookie: cookie.replace('blofy_admin_session=', 'blofy_admin_session=x') } });
  assert.equal(tampered.status, 401);
});

test('customer HTML is rendered only as literal cell text in the authenticated dashboard', async () => {
  const hooks = await adminHooks();
  const login = await hooks.request('/api/v1/admin/session/login', { method: 'POST', body: { username: env.BLOFY_ADMIN_USERNAME, password: env.BLOFY_ADMIN_PASSWORD } });
  const dashboard = await hooks.request('/admin', { headers: { cookie: login.headers['set-cookie'] } });
  const malicious = '<img src=x onerror="globalThis.compromised=true">';
  const makeElement = (tag) => ({
    tag, children: [], options: [], textContent: '', classList: {toggle(){}},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren() { this.children = []; },
    addEventListener(){}, querySelector(){return {};}, setAttribute(){},
    set innerHTML(_value) { throw new Error('HTML insertion is unsafe for customer fields'); }
  });
  const rows = makeElement('tbody');
  const elements = {'customer-rows':rows};
  const element = id => elements[id] ||= makeElement('div');
  element('grant-form').elements = {planKey:makeElement('select')};
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout, URLSearchParams,
    FormData: class { get(){return '';} },
    document: { body:{dataset:{page:'admin'}}, getElementById:element, createElement: makeElement },
    fetch: async url => ({ ok:true, status: 200, json: async () => url.includes('/users?') ? ({ items: [{ device_id: 'BLOFY-TEST-XSS', customer_name: malicious, customer_phone: malicious, customer_email: malicious, plan_key: malicious, status: 'active' }] }) : {items:[]} })
  });
  const script = await readFile(new URL('../web/experience.js',import.meta.url),'utf8');
  vm.runInContext(script, context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rows.children.length, 1);
  assert.equal(rows.children[0].children.length, 6);
  assert.equal(rows.children[0].children[0].children[0].textContent, malicious);
  assert.equal(context.compromised, undefined);
});

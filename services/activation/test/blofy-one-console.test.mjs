import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file=relative=>readFile(new URL('../'+relative,import.meta.url),'utf8');

test('BLOFY ONE dashboard uses existing admin session and never exposes an unprotected admin path',async()=>{
  const session=await file('src/admin-session-hook.mjs');
  const expected="if (req.method==='GET' && url.pathname==='/one') return html(res, await validSession(req)?await blofyOnePage():await loginPage());";
  assert.ok(session.includes(expected),'new dashboard must use existing signed admin session');
  assert.ok(session.indexOf(expected)<session.indexOf("if (!url.pathname.startsWith('/api/v1/admin/')) return listener(req,res);"));
  assert.doesNotMatch(session,/cookie\('blofy_one'/);
});

test('BLOFY ONE links existing code and subscriber flows rather than making new databases or customer routes',async()=>{
  const html=await file('web/blofy-one.html');
  for(const path of ['/sources-admin#xtream','/sources-admin#catalog','/admin#devices',
    '/admin#codes','/admin#releases','/admin#support','/connect','/status'])
    assert.ok(html.includes('href="'+path+'"'),path);
  for(const asset of ['/blofy-one.css?v=1','/blofy-one.js?v=1'])
    assert.ok(html.includes(asset));
  assert.match(html,/هذه أعداد قاعدة البيانات وليست قنوات أو مشاهدين يعملون الآن/);
  assert.match(html,/لا يثبت عمل القنوات الحقيقية/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)[^>]*>/);
});

test('unified dashboard assets have secure existing file routing',async()=>{
  const admin=await file('src/admin-console-hook.mjs');
  for(const asset of ["['/blofy-one.css', ['blofy-one.css', 'text/css']]",
    "['/blofy-one.js', ['blofy-one.js', 'text/javascript']]"])
    assert.ok(admin.includes(asset),asset);
  assert.match(admin,/x-content-type-options.*nosniff/);
  const css=await file('web/blofy-one.css');
  assert.match(css,/@media\(max-width:640px\)/);
  assert.match(css,/prefers-reduced-motion/);
  for(const original of ['web/admin.html','web/sources-admin.html'])
    assert.ok((await file(original)).includes('href="/one"'),original);
});

test('read-only status uses true service endpoints and explicit on-demand synthetic test',async()=>{
  const js=await file('web/blofy-one.js');
  for(const path of ['/health','/xtream/health','/api/v1/admin/restream-engine/health',
    '/api/v1/admin/restream-engine/smoke'])
    assert.ok(js.includes(path),path);
  assert.match(js,/mediaVerified/);
  assert.match(js,/realSourceVerified|لا يثبت تشغيل مصادر العملاء/);
  assert.match(js,/credentials:'same-origin'/);
  assert.doesNotMatch(js,/(?:localStorage|sessionStorage|POST|DELETE|PATCH|\/api\/v1\/admin\/xtream\/sync)/);
});

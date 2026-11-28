import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
const login=app.slice(app.indexOf('function login(message)'),app.indexOf('// Remember the exact scroll'));
test('native entry layout keeps existing authenticated code flow',()=>{
 assert.match(login,/native-stream-login/);
 assert.match(login,/id="stream-login-form"/);
 assert.match(login,/id="activation-code"/);
 assert.match(login,/\/api\/redeem/);
 assert.match(login,/deviceKey:deviceKey\(\)/);
 assert.match(login,/if\(!btn\|\|btn.disabled\)return/);
 assert.match(login,/form.onsubmit/);
});
test('direct provider access is disabled until the server explicitly enables it',()=>{
 assert.match(login,/disabled aria-describedby="direct-login-notice">اكستريم/);
 assert.match(login,/disabled aria-describedby="direct-login-notice">M3U/);
 assert.match(login,/api\('GET','\/api\/login-modes'/);
 assert.match(login,/st===200&&v.direct===true/);
 assert.match(login,/if\(!directReady\|\|!btn\|\|btn.disabled\)return/);
 assert.match(login,/api\('POST','\/api\/direct-login'/);
 assert.match(login,/document.getElementById\('provider-password'\).value=''/);
 assert.match(login,/document.getElementById\('provider-url'\).value=''/);
});
test('responsive entry styling is isolated and supports older TVs',()=>{
 assert.match(css,/\.login-screen\.native-login-screen/);
 assert.match(css,/\.login-panel\.native-stream-login/);
 assert.match(css,/#143e4c,#0b2a36,#071c26/);
 assert.match(css,/data-blofy-device="tv"/);
});

test('direct sign-in uses fixed first-party session exchange, not external network destinations',()=>{
 const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 assert.match(server,/BLOFY_WEB_BOUND_LOGIN_QA!=='1'/);
 assert.match(server,/normalizeDirectEntry\(input.value\)/);
 assert.match(server,/ORIGIN\+'\/api\/v1\/stream\/app\/web-bound-login'/);
 assert.match(server,/ORIGIN\+'\/api\/v1\/stream\/app\/session'/);
 assert.match(server,/HttpOnly; Secure; SameSite=Strict/);
 assert.match(login,/S.aiBusy=false;S.aiToken\+\+/);
});

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

test('movie and series descriptions use Arabic AI translation without replacing existing Arabic descriptions',()=>{
 const a=app.indexOf('function needsPlotTranslation('),b=app.indexOf('function details(',a);
 const needs=new Function(app.slice(a,b)+';return needsPlotTranslation')();
 assert.equal(needs('A detective searches for his missing brother.'),true);
 assert.equal(needs('探偵が行方不明の兄を探す'),true);
 assert.equal(needs('يبحث المحقق عن أخيه المفقود في المدينة.'),false);
 assert.equal(needs('x'.repeat(3901)),false);
 const detail=app.slice(b,app.indexOf('function parseEpisodes(',b));
 assert.match(detail,/generation!==plotGeneration\|\|plotSource!==source/);
 assert.match(detail,/if\(extra&&needsPlotTranslation\(plotSource\)/);
 assert.match(detail,/field.textContent=plotTranslation/);
 assert.match(detail,/api\('POST','\/api\/ai\/translate'/);
 const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 assert.match(server,/blofy-ai-gateway-production\.up\.railway\.app\/v1\/translate/);
 assert.match(server,/JSON.stringify\(\{title:'',overview,locale:'ar'\}\)/);
});

test('native subscription screen uses verified session and picture fit persists per profile',()=>{
 const a=app.indexOf('function pictureFitMode('),b=app.indexOf('function settingsScreen(',a);
 const fit=new Function(app.slice(a,b)+';return pictureFitMode')();
 assert.equal(fit('fit'),'contain');assert.equal(fit('zoom'),'cover');assert.equal(fit('fill'),'fill');assert.equal(fit('invalid'),'contain');
 const settings=app.slice(b,app.indexOf('function fmt(',b));
 assert.match(settings,/api\('GET','\/api\/session'/);
 assert.match(settings,/data\.profileKey===S\.profileKey/);
 assert.match(settings,/profileSave\('pictureFit'/);
 assert.match(app,/video\.style\.objectFit=pictureFitMode\(readJson\(profileStorageKey\('pictureFit'\)/);
});

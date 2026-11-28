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
 assert.equal(needs('این فیلم افسانه یک قهرمان را روایت میکند که برای نجات مردمش تلاش میکند.'),true);
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

test('saved login slots preserve the preceding account, switch only with verification, and clear on logout',()=>{
 const server=readFileSync(new URL('../server.ts',import.meta.url),'utf8');
 const start=server.indexOf('const SAVED_LOGIN='),end=server.indexOf('function closeAccountMedia(',start);
 const source=server.slice(start,end);
 const seal=v=>'sealed_'+v,unseal=v=>v.startsWith('sealed_')?v.slice(7):null;
 const json=(status,body,extra={})=>({status,body,cookies:extra['Set-Cookie']?[extra['Set-Cookie']]:[],headers:{append(){}}});
 const fakeJson=(status,body,extra={})=>{const r=json(status,body,extra);r.headers.append=(k,v)=>r.cookies.push(v);return r};
 const helper=new Function('Bun','seal','unseal','json',source+';return {loginResponse,savedToken,token,activeMode}')({env:{BLOFY_WEB_SAVED_LOGIN_QA:'1'}},seal,unseal,fakeJson);
 const jar={bv_session:seal('codeToken')};
 const req=()=>({headers:{get:()=>Object.entries(jar).map(([k,v])=>k+'='+v).join('; ')}});
 const apply=r=>r.cookies.forEach(c=>{const pair=c.split(';')[0],i=pair.indexOf('=');jar[pair.slice(0,i)]=pair.slice(i+1);assert.match(c,/HttpOnly; Secure; SameSite=Strict/)});
 apply(helper.loginResponse(req(),{ok:true},'xtreamToken','xtream'));
 assert.equal(helper.savedToken(req(),'code'),'codeToken');
 assert.equal(helper.token(req()),'xtreamToken');
 assert.equal(helper.activeMode(req()),'xtream');
 apply(helper.loginResponse(req(),{ok:true},'codeToken','code'));
 assert.equal(helper.savedToken(req(),'xtream'),'xtreamToken');
 assert.equal(helper.token(req()),'codeToken');
 assert.equal(helper.savedToken(req(),'invalid'),null);
 const switchRoute=server.slice(server.indexOf("if(p==='/api/saved-logins/switch'"),server.indexOf("if(p==='/api/external/stop'"));
 assert.match(switchRoute,/if\(!session.active\|\|!profileKey\)return json\(401/);
 assert.match(switchRoute,/api\/v1\/stream\/app\/session/);
 assert.match(server,/\['bv_session','bv_active_mode',\.\.\.LOGIN_MODES\.map/);
 assert.match(app,/reloadSavedLogin\(\)/);
 assert.match(app,/id="switch-saved-login"/);
});

 test('poster category labels match actual category IDs and full detail fields are retained',()=>{
 const a=app.indexOf('function posterCategory('),b=app.indexOf('function refreshPosterCategories(',a);
 const category=new Function('S',app.slice(a,b)+';return posterCategory')({cats:{movie:[{category_id:'2',category_name:'دراما'}]}});
 assert.equal(category({category_id:2},'movie'),'دراما');
 assert.equal(category({category_id:9,genre:'Action'},'movie'),'Action');
 assert.equal(category({category_id:9},'movie'),'');
 for(const label of ['الممثلون','المخرج','التقييم','تاريخ الإصدار','المدة','الدولة','اللغة'])assert.ok(app.includes("field('"+label+"'"));
 const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 assert.match(css,/\.detail-plot\{white-space:pre-wrap;overflow-wrap:anywhere;max-height:none/);
});

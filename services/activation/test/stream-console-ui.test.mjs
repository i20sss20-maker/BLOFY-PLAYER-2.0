import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const web=new URL('../web/',import.meta.url);
const html=await readFile(new URL('sources-admin.html',web),'utf8');
const js=await readFile(new URL('sources-admin.js',web),'utf8');
const css=await readFile(new URL('stream-console.css',web),'utf8');
const premiumCss=await readFile(new URL('stream-premium.css',web),'utf8');
const premiumJs=await readFile(new URL('stream-premium.js',web),'utf8');
const hook=await readFile(new URL('../src/sources-admin-hook.mjs',import.meta.url),'utf8');

test('default dashboard and deep-linked original tabs exist',()=>{
 for(const name of ['home','xtream','studio','catalog'])assert.match(html,new RegExp('id="tab-'+name+'"'));
 assert.match(js,/const TAB_NAMES = new Set\(\['home', 'xtream', 'catalog', 'studio'\]\)/);
 assert.match(js,/activeTab: 'home'/);
 assert.match(js,/initialTab && initialTab !== state.activeTab/);
});
test('critical existing admin actions and forms remain present',()=>{
 for(const id of ['gatewayCreateBtn','gatewayAccounts','xtreamForm','xtAddBtn','xtreamServers',
   'xtProbeAllBtn','blofyProbeRun','blofyPlaybackMetrics','catalogLoadBtn','studioIdentityForm',
   'message','gatewaySourceId'])assert.ok(html.includes('id="'+id+'"'),id+' must remain accessible');
});
test('no duplicated HTML ids, including engine status',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length,'duplicate id');
 assert.equal(ids.filter(id=>id==='blofyRestreamEngineStatus').length,1);
});
test('task-first controls route to existing workspace and tab handlers',()=>{
 for(const mode of ['sources','accounts','diagnostics','all']){
   assert.ok(html.includes('data-workspace-mode="'+mode+'"'));
   assert.ok(js.includes("'"+mode+"'"));
 }
 assert.match(js,/function selectWorkspaceMode/);
 assert.match(js,/toggleSourceForm\(true\)/);
 assert.match(html,/aria-controls="xtreamForm"/);
});
test('new CSS loads after site polish and is served with no-cache',()=>{
 assert.ok(html.indexOf('stream-console.css?')>html.indexOf('site-polish.css?'));
 assert.match(hook,/url\.pathname === '\/stream-console\.css'/);
 assert.match(css,/\.console-hero/);
 assert.match(css,/#tab-xtream\[data-workspace-mode="accounts"\]/);
 assert.match(css,/@media\(max-width:620px\)/);
});

test('premium console keeps all operational tools and the real engine diagnostic',()=>{
 for(const id of [
   'streamCommandDialog','streamCommandOpen','streamCommandInput','streamCommandResults',
   'streamDensityToggle','streamExportReport','premiumSourceAlerts','premiumCatalogDonut',
   'premiumPublishedCount','premiumIssueCount','premiumSyncCount','premiumCatalogTotal',
   'premiumTriageHeading','blofyRestreamEngineStatus'
 ])assert.ok(html.includes('id="'+id+'"'),id+' required');
 assert.ok(html.includes('stream-premium.css?v='));
 assert.ok(html.includes('stream-premium.js?v='));
 assert.match(hook,/url\.pathname === '\/stream-premium\.css'/);
 assert.match(hook,/url\.pathname === '\/stream-premium\.js'/);
});
test('premium dashboard includes functional insights and source search without credential sharing',()=>{
 for(const fn of ['renderSnapshot','renderAlerts','renderCatalog','exportSnapshot','openPalette','focusSource'])
   assert.ok(premiumJs.includes('function '+fn+'('),fn+' required');
 assert.match(premiumJs,/blofy:stream-snapshot/);
 assert.match(premiumJs,/CSV/);
 assert.match(premiumJs,/localStorage/);
 assert.match(html,/value="issues"/);
 assert.match(premiumCss,/\.stream-horizon/);
 assert.match(premiumCss,/\.premium-ops-grid/);
 assert.match(premiumCss,/\.premium-command-dialog/);
});
test('all sensitive source connection values remain outside dashboard snapshots',()=>{
 const base=await readFile(new URL('sources-admin.js',web),'utf8');
 assert.match(base,/window\.__BLOFY_STREAM_SNAPSHOT__/);
 assert.match(base,/new CustomEvent\('blofy:stream-snapshot'/);
 // Source snapshots are built from an explicit list of public operational
 // fields; no URL, password, username, decrypted secret or bearer is included.
 const snippet=base.split('const dashboardSnapshot=')[1]?.split('window.__BLOFY_STREAM_SNAPSHOT__')[0]||'';
 assert.ok(snippet.length>0);
 for(const field of ['baseUrl','username','password','token','credentials','secret'])
   assert.ok(!snippet.includes('item.'+field),'snapshot must not include '+field);
});

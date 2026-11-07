import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const web=new URL('../web/',import.meta.url);
const html=await readFile(new URL('sources-admin.html',web),'utf8');
const js=await readFile(new URL('sources-admin.js',web),'utf8');
const css=await readFile(new URL('stream-console.css',web),'utf8');
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

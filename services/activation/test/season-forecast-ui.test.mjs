import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const page=new URL('../web/admin-content-hub.html',import.meta.url);
const js=new URL('../web/admin-season-detail.js',import.meta.url);
const css=new URL('../web/admin-content-hub.css',import.meta.url);
test('owner season forecast controls have exactly one matching HTML id each',async()=>{
 const html=await readFile(page,'utf8');
 const source=await readFile(js,'utf8');
 for(const id of [
  'analyticsReportPanel','analyticsForecastValue',
  'analyticsForecastDescription','analyticsReportSearch',
  'analyticsReportFilter','analyticsReportRefresh'
 ]){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
   'One element required: '+id);
  assert.match(source,new RegExp(id));
 }
 assert.match(html,/حلقات.*الصفحة الحالية/);
 assert.match(source,/document\.hidden/);
 assert.match(source,/30000/);
 assert.doesNotMatch(source,/\/internal\/seasons\/(?:start|pause)/);
});
test('report controls have a mobile-safe CSS footprint',async()=>{
 const styles=await readFile(css,'utf8');
 assert.match(styles,/\.season-report-controls/);
 assert.match(styles,/\.season-forecast/);
 assert.match(styles,/max-width:540px/);
});

test('incident triage UI stays owner-only with explicit confirmation',async()=>{
 const html=await readFile(page,'utf8');
 const source=await readFile(new URL('../web/admin-season-attention.js',
  import.meta.url),'utf8');
 const hook=await readFile(new URL('../src/content-hub-admin-hook.mjs',
  import.meta.url),'utf8');
 assert.match(html,/admin-season-attention\.js/);
 for(const id of ['attentionTitle','attentionRefresh','attentionLevel',
  'attentionStatus','attentionList','attentionSummary'])
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
 assert.match(source,/confirm\(/);
 assert.match(source,/x-blofy-owner-action/);
 assert.match(source,/licensedStorage:true,sourceIdle:true/);
 assert.match(source,/automaticRetry!==false/);
 assert.match(hook,/manual-review-transient-failure/);
 assert.match(hook,/season_retry_manual_review_required/);
 assert.doesNotMatch(source,/\/internal\/seasons\//);
});

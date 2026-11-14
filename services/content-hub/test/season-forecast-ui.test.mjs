import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const page=new URL('../../activation/web/admin-content-hub.html',import.meta.url);
const js=new URL('../../activation/web/admin-season-detail.js',import.meta.url);
const css=new URL('../../activation/web/admin-content-hub.css',import.meta.url);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../web/admin-device-contact.js', import.meta.url), 'utf8');

function render(state, text = 'لا يوجد اشتراك منتهٍ لهذا التسجيل.') {
  const element = () => ({textContent:'', dataset:{}, disabled:true,
    classList:{values:new Set(), toggle(key,on){on?this.values.add(key):this.values.delete(key);},
      add(key){this.values.add(key);}, remove(key){this.values.delete(key);}},
    removeAttribute(){}});
  const action=element();action.textContent='إدارة ←';
  const row=element();
  row.querySelectorAll=()=>[{}, {textContent:text, querySelector:()=>state==='expired'?{}:null}, {querySelector:()=>action}];
  const ids=Object.fromEntries(['customer-rows','record-summary','grant-form','renewal-heading','renewal-caption','renewal-state','preview-renewal','renewal-options'].map(id=>[id,element()]));
  ids['record-summary'].textContent=text;
  ids['record-summary'].dataset={status:state,lifetime:'false'};
  vm.runInNewContext(script, {
    document:{body:{dataset:{page:'admin'}},readyState:'complete',getElementById:id=>ids[id],
      querySelector:()=>null,querySelectorAll:selector=>selector==='#customer-rows tr'?[row]:[]},
    labels:{},location:{hash:''},window:{addEventListener(){}},
    MutationObserver:class {observe(){}},clearTimeout(){},setTimeout(callback){callback();return 1;}
  });
  return {ids,row,action};
}

test('pending registrations do not gain expired styling from their explanatory text',()=>{
  const {ids,row,action}=render('pending');
  assert.equal(row.classList.values.has('is-expired'),false);
  assert.equal(action.textContent,'إدارة ←');
  assert.equal(ids['renewal-state'].textContent,'تسجيل غير مكتمل');
  assert.equal(ids['renewal-heading'].textContent,'تفعيل تسجيل جديد');
  assert.match(ids['renewal-caption'].textContent,/لم تبدأ التجربة/);
});

test('expired and blocked renewal states still follow structured status',()=>{
  const expired=render('expired','اسم العميل');
  assert.equal(expired.row.classList.values.has('is-expired'),true);
  assert.equal(expired.action.textContent,'تجديد / إدارة ←');
  assert.equal(expired.ids['renewal-heading'].textContent,'إعادة تفعيل الجهاز');
  const blocked=render('blocked');
  assert.equal(blocked.ids['renewal-heading'].textContent,'الجهاز موقوف');
  const active=render('active','عميل باسم منتهي');
  assert.equal(active.row.classList.values.has('is-expired'),false);
  assert.equal(active.ids['renewal-state'].textContent,'ساري');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const web=new URL('../web/',import.meta.url);
const code=new URL('../src/content-hub-admin-hook.mjs',import.meta.url);
const tick=()=>new Promise(resolve=>setTimeout(resolve,12));
const runId='saleh_episode_127434_20261114';
class Node{
 constructor(id){this.id=id;this.disabled=false;this.value='';
  this.checked=false;this.textContent='';this.listeners={};this.children=[];}
 addEventListener(event,fn){(this.listeners[event]??=[]).push(fn)}
 click(){for(const fn of this.listeners.click||[])fn()}
 change(){for(const fn of this.listeners.change||[])fn()}
 replaceChildren(...args){this.children=args;this.value=args[0]?.value||''}
}
test('private full-file audit UI is explicit owner-only and defaults OFF',async()=>{
 const [html,js,hook,hub]=await Promise.all([
  readFile(new URL('admin-content-hub.html',web),'utf8'),
  readFile(new URL('admin-private-copy-audit.js',web),'utf8'),
  readFile(code,'utf8'),
  readFile(new URL('../../content-hub/src/server.mjs',import.meta.url),'utf8')]);
 for(const id of ['privateCopyAuditTitle','privateCopyAuditKind',
   'privateCopyAuditConfirm','privateCopyAuditStart',
   'privateCopyAuditStatus','privateCopyAuditRefresh']){
  assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 }
 assert.match(html,/admin-private-copy-audit\\.js/);
 assert.match(hook,/private-copy\\/audit-full/);
 assert.match(hook,/admin-private-copy-audit\\.js/);
 assert.match(hook,/audit-one-stored-private-copy/);
 assert.match(hub,/BLOFY_CONTENT_HUB_FULL_SHA_AUDIT_ENABLED/);
 assert.match(hub,/fullCopyAuditBusy/);
 assert.match(hub,/automaticCopyStarted:false/);
 assert.doesNotMatch(js,/innerHTML\\s*=/);
 assert.doesNotMatch(js,/source\\/episode|Xtream\\/get\\.php/);
});
test('UI polls read-only initially, starts no audit until the owner consents',async()=>{
 const ids=['privateCopyAuditKind','privateCopyAuditConfirm',
  'privateCopyAuditStart','privateCopyAuditRefresh','privateCopyAuditStatus'];
 const dom=Object.fromEntries(ids.map(id=>[id,new Node(id)]));
 const requests=[];
 const context={
  document:{getElementById:id=>dom[id],hidden:false},
  Option:class {constructor(label,value){this.text=label;this.value=value}},
  AbortSignal,clearTimeout:()=>{},setTimeout:()=>9,
  location:{assign:()=>{throw Error('unexpected redirect')}},
  fetch:async(url,opts)=>{
   requests.push({url,opts});
   if(opts.method==='GET')return {status:200,ok:true,json:async()=>({
    ok:true,privateOnly:true,readOnly:true,
    providerRequests:0,customerCutover:false,automaticCopyStarted:false,
    configuredRuns:{episode:runId,movie:null},
    status:{state:'idle',fullSha256Verified:false}
   })};
   return {status:202,ok:true,json:async()=>({
    ok:true,customerCutover:false,automaticCopyStarted:false
   })};
  }
 };
 const js=await readFile(new URL('admin-private-copy-audit.js',web),'utf8');
 vm.runInNewContext(js,context);
 await tick();
 assert.equal(requests.length,1);
 assert.equal(requests[0].opts.method,'GET');
 assert.equal(dom.privateCopyAuditStart.disabled,true);
 const selector=dom.privateCopyAuditKind;
 selector.value='episode:'+runId;selector.change();
 assert.equal(dom.privateCopyAuditStart.disabled,true);
 dom.privateCopyAuditConfirm.checked=true;
 dom.privateCopyAuditConfirm.change();
 assert.equal(dom.privateCopyAuditStart.disabled,false);
 dom.privateCopyAuditStart.click();
 await tick();
 assert.equal(requests.length,2);
 assert.equal(requests[1].opts.method,'POST');
 assert.equal(requests[1].opts.headers['x-blofy-owner-action'],
  'audit-one-stored-private-copy');
 const payload=JSON.parse(requests[1].opts.body);
 assert.equal(payload.kind,'episode');
 assert.equal(payload.runId,runId);
 assert.equal(payload.confirmed,true);
 assert.equal(dom.privateCopyAuditConfirm.checked,false);
 assert.equal(dom.privateCopyAuditStart.disabled,true);
});

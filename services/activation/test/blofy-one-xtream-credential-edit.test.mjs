import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,runInNewContext} from 'node:vm';

const read=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');
test('Xtream editor is inside the existing codes/Xtream owner tab and securely routed',()=>{
 const html=read('blofy-one.html'),panel=read('blofy-one-code-center.js'),
   list=read('blofy-one-xtream-register.js'),editor=read('blofy-one-xtream-credential-edit.js'),
   css=read('blofy-one-code-register.css'),
   gateway=readFileSync(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8'),
   admin=readFileSync(new URL('../src/admin-console-hook.mjs',import.meta.url),'utf8');
 assert.match(html,/blofy-one-xtream-credential-edit\.js\?v=/);
 assert.match(admin,/\['\/blofy-one-xtream-credential-edit\.js'/);
 assert.match(panel,/one-xtream-edit-dialog/);
 assert.match(panel,/one-xtream-edit-username-mode/);
 assert.match(panel,/one-xtream-edit-password-mode/);
 assert.match(panel,/one-xtream-edit-password/);
 assert.match(panel,/one-xtream-edit-ack/);
 assert.match(list,/blofy-one:xtream-change/);
 assert.match(editor,/change-credentials/);
 assert.match(gateway,/changeAccountCredentials/);
 assert.match(gateway,/change-credentials/);
 assert.match(css,/one-xtream-edit-grid/);
 assert.doesNotThrow(()=>new Script(editor));
 assert.doesNotThrow(()=>new Script(list));
 assert.doesNotThrow(()=>new Script(panel));
 for(const forbidden of [
  'localStorage','sessionStorage','console.log','/reset','/rotate-credentials',
  '/link/xtream-to-code','/codes/redeem'
 ])assert.ok(!editor.includes(forbidden),'editor must not persist or mutate other entities: '+forbidden);
});
test('operator chooses manual username and system password, then submits exactly once with no secrets in URL',async()=>{
 class Element{
  constructor(tag='div'){
   this.tagName=tag;this.children=[];this.listeners={};this.textContent='';
   this.hidden=false;this.disabled=false;this.value='';this.checked=false;
   this.required=false;this.open=false;
  }
  addEventListener(kind,callback){(this.listeners[kind]??=[]).push(callback);}
  dispatch(kind,detail){for(const fn of this.listeners[kind]||[])
   fn({type:kind,detail,preventDefault(){}});}
  showModal(){this.open=true;}close(){this.open=false;this.dispatch('close');}
  reset(){}
 }
 const ids=['one-xtream-edit-dialog','one-xtream-edit-form','one-xtream-edit-status',
  'one-xtream-edit-result','one-xtream-edit-username-mode','one-xtream-edit-password-mode',
  'one-xtream-edit-username-field','one-xtream-edit-password-field',
  'one-xtream-edit-username','one-xtream-edit-password','one-xtream-edit-ack',
  'one-xtream-edit-submit','one-xtream-edit-close','one-xtream-edit-cancel',
  'one-xtream-edit-account','one-xtream-edit-host','one-xtream-edit-user',
  'one-xtream-edit-pass','one-xtream-edit-m3u','one-xtream-edit-copy',
  'one-xtream-edit-copy-m3u','one-xtream-edit-hide'];
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
 const docListeners={},winListeners={};
 const document={
  readyState:'complete',hidden:false,
  getElementById:id=>elements[id]||null,
  addEventListener:(kind,fn)=>{(docListeners[kind]??=[]).push(fn);}
 };
 const emitted=[],requests=[];
 const window={
  confirm:()=>true,
  addEventListener:(kind,fn)=>{(winListeners[kind]??=[]).push(fn);},
  dispatchEvent:event=>{emitted.push(event.type);return true;}
 };
 const fetch=async(path,opts)=>{
  requests.push({path,...opts});
  return {ok:true,status:200,json:async()=>({
   accountId:'91894e2e-b3d7-4822-a2c7-a79ac9d7c18f',
   item:{id:'91894e2e-b3d7-4822-a2c7-a79ac9d7c18f',username:'OwnerManual'},
   subscriptionUnchanged:true,oldCredentialsDisabled:true,
   credentials:{serverUrl:'https://y.blofyplayer.com',
    username:'OwnerManual',password:'SystemPass123'}
  })};
 };
 const context={
  document,window,fetch,navigator:{clipboard:{writeText:async()=>{}}},
  CustomEvent:class CustomEvent{constructor(type,options){this.type=type;this.detail=options.detail;}},
  URL,URLSearchParams,AbortController,
  setTimeout,clearTimeout,Date,Number,String,Math,Promise,RegExp,Error
 };
 runInNewContext(read('blofy-one-xtream-credential-edit.js'),context);
 const id='91894e2e-b3d7-4822-a2c7-a79ac9d7c18f';
 for(const fn of winListeners['blofy-one:xtream-change'])fn({detail:{
  id,label:'عميل',username:'OriginalUser',updatedAt:Date.now(),expiresAt:Date.now()+86400000
 }});
 assert.equal(elements['one-xtream-edit-dialog'].open,true);
 elements['one-xtream-edit-username-mode'].value='manual';
 elements['one-xtream-edit-username-mode'].dispatch('change');
 elements['one-xtream-edit-password-mode'].value='automatic';
 elements['one-xtream-edit-password-mode'].dispatch('change');
 elements['one-xtream-edit-username'].value='OwnerManual';
 elements['one-xtream-edit-ack'].checked=true;
 elements['one-xtream-edit-form'].dispatch('submit');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(requests.length,1);
 assert.equal(requests[0].path,'/api/v1/admin/xtream-gateway/accounts/'+id+'/change-credentials');
 assert.equal(requests[0].method,'POST');
 assert.equal(requests[0].cache,'no-store');
 assert.equal(requests[0].credentials,'same-origin');
 const body=JSON.parse(requests[0].body);
 assert.equal(body.expectedUsername,'OriginalUser');
 assert.equal(body.usernameMode,'manual');
 assert.equal(body.username,'OwnerManual');
 assert.equal(body.passwordMode,'automatic');
 assert.equal(body.acknowledgeDisconnect,true);
 assert.ok(!('password' in body),'must not accidentally send hidden password input');
 assert.equal(elements['one-xtream-edit-username'].value,'');
 assert.equal(elements['one-xtream-edit-result'].hidden,false);
 assert.equal(elements['one-xtream-edit-pass'].textContent,'SystemPass123');
 assert.equal(elements['one-xtream-edit-host'].textContent,'https://y.blofyplayer.com:443');
 assert.ok(emitted.includes('blofy-one:xtream-credentials-updated'));
 elements['one-xtream-edit-hide'].dispatch('click');
 assert.equal(elements['one-xtream-edit-pass'].textContent,'');
 assert.equal(elements['one-xtream-edit-m3u'].textContent,'');
});

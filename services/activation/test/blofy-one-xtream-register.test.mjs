import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';

const read=name=>readFileSync(new URL('../web/'+name,import.meta.url),'utf8');
const UUID='66d6a87d-cc48-4e3d-8aab-a778272dc8da';
const username='account_001';
const secret='original-password-do-not-change';

test('BLOFY ONE really contains both Xtream accounts and all issued vouchers',()=>{
 const html=read('blofy-one.html');
 const panel=read('blofy-one-code-center.js');
 const js=read('blofy-one-xtream-register.js');
 assert.match(html,/blofy-one-xtream-register\.js\?v=/);
 assert.match(panel,/one-xtream-register-rows/);
 assert.match(panel,/one-register-rows/);
 assert.match(panel,/حسابات Xtream — المرتبطة والمستقلة/);
 assert.match(panel,/one-xtream-register-credentials/);
 assert.match(js,/\/api\/v1\/admin\/xtream-gateway\/accounts\//);
 assert.match(js,/\/api\/v1\/admin\/xtream-gateway'/);
 assert.doesNotThrow(()=>new Script(js));
 const admin=readFileSync(new URL('../src/admin-console-hook.mjs',import.meta.url),'utf8');
 assert.ok(admin.includes("['/blofy-one-xtream-register.js'"),'admin needs safe asset allowlist');
 const gateway=readFileSync(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 assert.match(gateway,/revealAccountCredentials\(id,req\),\{/);
 assert.match(gateway,/'cache-control':'no-store, private'/);
});
test('Xtream list is readable without secrets; selected existing account re-reveals and clears',async()=>{
 const ids=[
  'one-xtream-register','one-xtream-register-rows','one-xtream-register-status',
  'one-xtream-register-dialog','one-xtream-register-detail-status',
  'one-xtream-register-credentials','one-xtream-register-host',
  'one-xtream-register-user','one-xtream-register-password',
  'one-xtream-register-m3u','one-xtream-register-copy',
  'one-xtream-register-copy-m3u','one-xtream-register-prev',
  'one-xtream-register-next','one-xtream-register-state',
  'one-register-query','one-register-search-form','one-register-refresh',
  'one-xtream-register-page','one-xtream-register-info',
  'one-xtream-register-close','one-xtream-register-hide'
 ];
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.listeners={};
   this.textContent='';this.hidden=false;this.disabled=false;this.value='';this.open=false;}
  addEventListener(type,callback){(this.listeners[type]??=[]).push(callback);}
  dispatch(type,detail){for(const fn of this.listeners[type]||[])fn({type,detail,preventDefault(){}});}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  showModal(){this.open=true;}
  close(){this.open=false;this.dispatch('close');}
 }
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
 elements['one-xtream-register-state'].value='all';
 const documentListeners={};
 const document={
  readyState:'complete',hidden:false,
  getElementById:id=>elements[id]||null,
  createElement:tag=>new Element(tag),
  addEventListener:(type,fn)=>{(documentListeners[type]??=[]).push(fn);}
 };
 const windowListeners={};
 const window={
  confirm:()=>true,
  addEventListener:(type,fn)=>{(windowListeners[type]??=[]).push(fn);}
 };
 const calls=[];
 const fetch=async(path,options)=>{
  calls.push({path,method:options.method,cache:options.cache,credentials:options.credentials});
  if(path==='/api/v1/admin/xtream-gateway')
   return {ok:true,status:200,json:async()=>({items:[{
    id:UUID,label:'حساب Xtream مباشر',username,enabled:true,
    maxConnections:1,expiresAt:Date.now()+86400000,sourceId:null
   }]})};
  if(path==='/api/v1/admin/xtream-gateway/accounts/'+UUID+'/credentials')
   return {ok:true,status:200,json:async()=>({credentials:{
    serverUrl:'https://y.blofyplayer.com',username,password:secret
   }})};
  throw Error('unexpected route: '+path);
 };
 const context={document,window,fetch,URL,URLSearchParams,
  location:{hash:'#one-code-register'},navigator:{clipboard:{writeText:async()=>{}}},
  setTimeout,clearTimeout,AbortController,Date,Number,String,Math,RegExp,Error,Promise};
 runInNewContext(read('blofy-one-xtream-register.js'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1,'accounts loaded directly inside unified code register');
 assert.equal(calls[0].method,'GET');
 assert.equal(calls[0].credentials,'same-origin');
 assert.equal(calls[0].cache,'no-store');
 assert.match(elements['one-xtream-register-status'].textContent,/1/);
 const table=elements['one-xtream-register-rows'];
 assert.equal(table.children.length,1);
 const row=table.children[0];
 const before=JSON.stringify(row);
 assert.ok(before.includes('حساب Xtream مباشر'));
 assert.ok(before.includes(username));
 assert.ok(!before.includes(secret),'ordinary list must not include password');
 const extractionButton=row.children.at(-1).children[0];
 extractionButton.dispatch('click');
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,2);
 assert.equal(calls[1].method,'GET');
 assert.equal(calls[1].path,'/api/v1/admin/xtream-gateway/accounts/'+UUID+'/credentials');
 assert.equal(elements['one-xtream-register-dialog'].open,true);
 assert.equal(elements['one-xtream-register-host'].textContent,'https://y.blofyplayer.com:443');
 assert.equal(elements['one-xtream-register-password'].textContent,secret);
 assert.ok(elements['one-xtream-register-m3u'].textContent.includes('get.php?'));
 elements['one-xtream-register-close'].dispatch('click');
 assert.equal(elements['one-xtream-register-dialog'].open,false);
 assert.equal(elements['one-xtream-register-password'].textContent,'');
 assert.equal(elements['one-xtream-register-m3u'].textContent,'');
 assert.ok(calls.every(c=>c.method==='GET'),'no creation or mutation');
});
test('no implicit account creation, password reset, storage or URL credential logging',()=>{
 const js=read('blofy-one-xtream-register.js');
 for(const forbidden of [
  'localStorage','sessionStorage','console.log','/link/xtream-to-code',
  "'POST'","'PATCH'","'DELETE'",'/rotate-credentials','/reset',
  '/codes/redeem','/store/cart/checkout'
 ])assert.ok(!js.includes(forbidden),'unexpected potentially destructive reference '+forbidden);
 assert.match(js,/clearSecrets\(\)/);
 assert.match(js,/visibilitychange/);
 assert.match(js,/pagehide/);
 assert.match(js,/30000/);
});

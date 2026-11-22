import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src=readFileSync(new URL('../web/stream-activate.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/stream-activate.html',import.meta.url),'utf8');

test('BLOFY extraction explicitly offers two separate copy buttons',()=>{
 assert.match(html,/id="copy-all"[^>]*>📋 نسخ بيانات Xtream فقط \(Host \+ Username \+ Password\)/);
 assert.match(html,/id="copy-m3u"[^>]*>🔗 نسخ رابط M3U فقط/);
 assert.match(html,/activate\.js\?v=20261122-xtream-copy-separate-v2/);
 assert.doesNotMatch(html,/نسخ جميع بيانات Xtream/);
 assert.doesNotThrow(()=>new vm.Script(src));
});

test('copy Xtream never includes M3U URL; M3U button copies only the playlist URL',async()=>{
 const listeners=new Map(),clipboard=[];
 function node(id){
  return {
   id,disabled:false,checked:false,value:'',className:'',
   textContent:'',children:[],classList:{
    contains:()=>false,add:()=>{},remove:()=>{}
   },
   addEventListener(event,fn){listeners.set(id+':'+event,fn);},
   append(...kids){this.children.push(...kids);},
   replaceChildren(){this.children=[];}
  };
 }
 const nodes=new Map();
 const $=id=>{if(!nodes.has(id))nodes.set(id,node(id));return nodes.get(id)};
 const document={
  getElementById:$,
  createElement:tag=>node(tag),
  addEventListener:()=>{}
 };
 const window={addEventListener:()=>{}};
 const ctx={document,window,navigator:{clipboard:{writeText:async x=>clipboard.push(x)}},
  setTimeout:()=>1,clearTimeout:()=>{},URL,URLSearchParams,Date,Intl,
  fetch:async()=>({ok:true,status:201,json:async()=>({
   ok:true,universalExtraction:true,originalVoucherPreserved:true,
   recovered:false,account:{durationDays:30,activatedAt:Date.now(),
    expiresAt:Date.now()+30*86400000},
   credentials:{serverUrl:'https://blofyplayer.com',username:'test_user',
    password:'test_password',m3uUrl:'https://blofyplayer.com/get.php?username=test_user&password=test_password'}
  })})};
 vm.runInNewContext(src,ctx);
 $('code').value='12345678';$('confirm-start').checked=true;
 await listeners.get('form:submit')({preventDefault(){}});
 await listeners.get('copy-all:click')();
 assert.equal(clipboard.length,1);
 assert.equal(clipboard[0],[
  'Host: https://blofyplayer.com:443',
  'Username: test_user',
  'Password: test_password'
 ].join('\n'));
 assert.doesNotMatch(clipboard[0],/get\.php|M3U|username=test_user/);
 await listeners.get('copy-m3u:click')();
 assert.equal(clipboard[1],
  'https://blofyplayer.com/get.php?username=test_user&password=test_password');
 assert.doesNotMatch(clipboard[1],/\nHost:|\nUsername:|\nPassword:/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const stylesheet=read('../web/store-visual.css');
const pages=[
 ['../web/store.html','data-blofy-storefront="1"'],
 ['../web/store-cart.html','class="cart-experience"'],
 ['../web/store-account.html','data-blofy-store-customer="1"'],
 ['../web/store-orders.html','data-blofy-store-customer="1"'],
 ['../web/store-inventory.html','data-blofy-store-admin="1"']
];
test('one cohesive storefront theme loads last on every BLOFY customer and merchant page',()=>{
 for(const [path,scope] of pages){
  const html=read(path);
  assert.ok(html.includes(scope),path+' is not scoped to safe theme');
  assert.equal((html.match(/\/store\/visual\.css\?v=20261119-3/g)||[]).length,1,path+' must load one versioned visual theme');
  assert.ok(html.lastIndexOf('/store/visual.css')>html.lastIndexOf('stylesheet" href="'),path+' theme must be the last stylesheet');
  assert.match(html,/blofy-logo\.png/);
 }
});
test('light palette has accessible colour contrast, no active wallets implied',()=>{
 const tokens=Object.fromEntries([...stylesheet.matchAll(/(--blofy-[a-z-]+):\s*(#[0-9a-fA-F]{6})/g)]
  .map(m=>[m[1],m[2]]));
 const ratio=(a,b)=>{
  const c=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const lum=hex=>c(hex).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const x=lum(a),y=lum(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
 };
 for(const [fg,bg] of [
   ['--blofy-ink','--blofy-page'],['--blofy-muted','--blofy-paper'],
   ['--blofy-paper','--blofy-primary'],['--blofy-paper','--blofy-primary-dark']
 ]){
  assert.ok(tokens[fg]&&tokens[bg],'Missing palette colour: '+fg+'/'+bg);
  assert.ok(ratio(tokens[fg],tokens[bg])>=4.5,
    'Not enough AA contrast for '+fg+'/'+bg+': '+ratio(tokens[fg],tokens[bg]).toFixed(2));
 }
 assert.doesNotMatch(stylesheet,/Google Pay|Apple Pay|unlimited|guaranteed/);
});
test('admin styling keeps dashboard readable and payment operations untouched',()=>{
 for(const css of ['storefront','checkout','admin']){
  const selector=css==='storefront'?'body\\[data-blofy-storefront\\]':
    css==='checkout'?'body\\.cart-experience':'body\\[data-blofy-store-admin\\]';
  assert.match(stylesheet,new RegExp(selector));
 }
 assert.match(stylesheet,/\.order-state\.paid/);
 assert.match(stylesheet,/\.commercial-metric/);
 assert.match(stylesheet,/\.merchandising-banner/);
 assert.match(stylesheet,/@media\(max-width:760px\)/);
 assert.match(stylesheet,/@media\(prefers-reduced-motion:reduce\)/);
 const server=read('../src/server.mjs');
 assert.match(server,/requestUrl\.pathname==='\/store\/visual\.css'/);
 assert.match(server,/serveStoreAssetFile\(res,'store-visual\.css','text\/css; charset=utf-8'\)/);
 assert.match(server,/storeBranding\(req,res,requestUrl\)/);
 assert.match(server,/storeShowcase\(req,res,requestUrl\)/);
 const storefront=read('../web/store.html');
 assert.match(storefront,/id="bundle-add-cart"/);
 assert.match(storefront,/data-cart-add="stream"/);
 assert.match(storefront,/data-cart-add="xtream"/);
 const cart=read('../web/store-cart.html');
 assert.match(cart,/\/store\/cart\.js/);
 assert.match(cart,/id="cart-main"/);
});

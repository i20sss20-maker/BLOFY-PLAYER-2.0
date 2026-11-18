import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const cartJs=readFileSync(new URL('../web/store-cart.js',import.meta.url),'utf8');
const cartHtml=readFileSync(new URL('../web/store-cart.html',import.meta.url),'utf8');
const accountJs=readFileSync(new URL('../web/store-account.js',import.meta.url),'utf8');
const oldId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const newId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const line=(sku,quantity=1)=>({sku,quantity});
const tick=()=>new Promise(resolve=>setTimeout(resolve,30));

function browser({local=[],owner=null,remote=[],remoteCoupon='',url='',saveFailures=0,saveConflict=false}={}){
 const storage=new Map([['blofy.shop.cart.v1',JSON.stringify(local)]]);
 if(owner)storage.set('blofy.shop.cart.owner.v1',owner);
 const sessions=new Map(),elements=new Map(),listeners=new Map(),requests=[],redirects=[];
 let writeFailures=saveFailures,reloads=0,serverRevision=3;
 const make=(id='')=>{
  const node={id,children:[],hidden:false,disabled:false,dataset:{},
   textContent:'',value:'',className:'',style:{},
   setAttribute(){},
   addEventListener(event,callback){listeners.set(this.id+':'+event,callback)},
   append(...items){this.children.push(...items)},
   replaceChildren(...items){this.children=[...items]}};
  if(id)elements.set(id,node);
  return node;
 };
 const document={
  getElementById(id){return elements.get(id)||make(id)},
  createElement(){return make()}
 };
 const ids=['checkout','items','clear-cart','coupon','apply','subtotal','discount',
  'total','codes-count','message','auth-gate','auth-title','auth-message','auth-link','cart-sync',
  'started','order-number','open-geidea','copy-private-link','check-pending','pending-status',
  'retry-pending','retry-cart-sync'];
 ids.forEach(make);
 const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
 const fetch=async(path,opts={})=>{
  const data=opts.body?JSON.parse(opts.body):null;
  requests.push({path,method:opts.method||'GET',data});
  if(path==='/api/v1/store/account')
   return response(200,{customerId:newId,email:'verified@example.com'});
  if(path==='/api/v1/store/account/cart'&&opts.method!=='POST')
   return response(200,{items:remote,couponCode:remoteCoupon,revision:3});
  if(path==='/api/v1/store/account/cart'){
   if(writeFailures-- >0){
    if(saveConflict)return response(409,{error:'store_cart_changed_on_another_device'});
    throw Error('simulated_network_drop');
   }
   serverRevision++;
   return response(200,{revision:serverRevision});
  }
  if(path==='/api/v1/store/products')
   return response(200,{checkoutAvailable:true});
  if(path==='/api/v1/store/cart/pending')
   return response(200,{pending:false});
  if(path==='/api/v1/store/cart/quote'){
   const items=data.items||[];
   return response(200,{
    codeCount:items.reduce((n,x)=>n+x.quantity,0),
    subtotalMinor:items.length*4000,
    discountMinor:0,totalMinor:items.length*4000,
    items:items.map(x=>({...x,lineTotalMinor:4000}))
   });
  }
  throw Error('Unexpected HTTP call: '+path);
 };
 const location={search:url,origin:'https://blofyplayer.com',
  assign(url){redirects.push(url)},reload(){reloads++}};
 const localStorage={
  getItem:k=>storage.get(k)??null,
  setItem:(k,v)=>storage.set(k,v),
  removeItem:k=>storage.delete(k)
 };
 const sessionStorage={
  getItem:k=>sessions.get(k)||null,
  setItem:(k,v)=>sessions.set(k,v),
  removeItem:k=>sessions.delete(k)
 };
 const ctx={window:{},document,fetch,localStorage,sessionStorage,location,
  history:{replaceState(){}},URLSearchParams,console,confirm:()=>true};
 vm.runInNewContext(cartJs,ctx,{filename:'store-cart.js'});
 return {elements,listeners,storage,requests,redirects,location,get reloads(){return reloads}};
}

test('signing in to a different customer never merges the former account private basket or coupon',async()=>{
 const b=browser({owner:oldId,local:[line('stream-3m')],
  remote:[line('xtream-6m')],remoteCoupon:'CURRENT'});
 await tick();
 assert.deepEqual(JSON.parse(b.storage.get('blofy.shop.cart.v1')),[line('xtream-6m')]);
 assert.equal(b.storage.get('blofy.shop.cart.owner.v1'),newId);
 assert.equal(b.elements.get('coupon').value,'CURRENT');
 assert.equal(b.elements.get('checkout').disabled,false);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/account/cart'&&x.method==='POST').length,0,
  'no stale old-account cart write should occur');
});

test('an explicit new purchase from product page survives account switch without importing old items',async()=>{
 const b=browser({owner:oldId,local:[line('stream-3m')],
  remote:[line('xtream-6m')],url:'?add=stream-1y'});
 await tick();
 const cart=JSON.parse(b.storage.get('blofy.shop.cart.v1'));
 assert.deepEqual(cart,[line('xtream-6m'),line('stream-1y')]);
 assert.equal(cart.some(x=>x.sku==='stream-3m'),false);
 assert.equal(b.elements.get('checkout').disabled,false);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/cart/pending').length,1);
});

test('after a transient cloud write failure checkout remains locked until explicit successful retry',async()=>{
 const b=browser({local:[line('stream-3m')],remote:[],saveFailures:1});
 await tick();
 assert.equal(b.elements.get('checkout').disabled,true);
 assert.equal(b.elements.get('retry-cart-sync').hidden,false);
 assert.match(b.elements.get('cart-sync').textContent,/أعد محاولة الحفظ/);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/cart/checkout').length,0);
 b.listeners.get('retry-cart-sync:click')();
 await tick();
 assert.equal(b.elements.get('retry-cart-sync').hidden,true);
 assert.equal(b.elements.get('checkout').disabled,false);
 assert.equal(b.elements.get('cart-sync').dataset.state,'saved');
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/account/cart'&&x.method==='POST').length,2);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/cart/pending').length,1);
});

test('retry failure caused by another device requires a reload instead of clobbering its cart',async()=>{
 const b=browser({local:[line('stream-3m')],remote:[],saveFailures:1,saveConflict:true});
 await tick();
 const retry=b.elements.get('retry-cart-sync');
 assert.equal(retry.dataset.reload,'yes','the actual HTTP 409 must require a reload');
 const writes=b.requests.filter(x=>x.path==='/api/v1/store/account/cart'&&x.method==='POST').length;
 b.listeners.get('retry-cart-sync:click')();
 await tick();
 assert.equal(b.reloads,1);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/account/cart'&&x.method==='POST').length,writes);
});

test('store site exposes recovery controls and logout clears browser-owned cart/token references',()=>{
 assert.doesNotThrow(()=>new Function(cartJs));
 assert.doesNotThrow(()=>new Function(accountJs));
 assert.match(cartHtml,/id="retry-cart-sync"/);
 assert.match(cartHtml,/id="retry-pending"/);
 assert.match(cartJs,/accountChanged=!!previousOwner&&previousOwner!==data\.customerId/);
 assert.match(accountJs,/localStorage\.removeItem\('blofy\.shop\.cart\.owner\.v1'\)/);
 assert.match(accountJs,/sessionStorage\.removeItem\('blofy\.shop\.pending-checkout\.v1'\)/);
 assert.match(accountJs,/sessionStorage\.removeItem\('blofy\.shop\.order\.'\+order\.orderId\)/);
});

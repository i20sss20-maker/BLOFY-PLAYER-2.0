import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// This exercises the REAL storefront JS with a fake browser and fake Geidea
// response; it never makes a bank transaction or contacts external providers.
const script=readFileSync(new URL('../web/store-cart.js',import.meta.url),'utf8');
const orderId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const customerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token='x'.repeat(43);
const item={sku:'stream-3m',quantity:1};
const hosted='https://www.ksamerchant.geidea.net/hpp/checkout/?'+sessionId;

async function fixture({merchantEnabled=true,deviceSupported=true}={}){
 const storage=new Map([['blofy.shop.cart.v1',JSON.stringify([item])],
  ['blofy.shop.cart.owner.v1',customerId]]);
 const saved=new Map(),calls=[],redirects=[],events=new Map(),nodes=new Map();
 let sdkRequests=0;
 function el(id=''){
  const obj={id,hidden:false,disabled:false,style:{},dataset:{},value:'',
   children:[],className:'',textContent:'',setAttribute(){},remove(){},
   append(...x){this.children.push(...x);},replaceChildren(){this.children=[];},
   scrollIntoView(){},focus(){},addEventListener(t,fn){events.set(id+':'+t,fn);}};
  if(id)nodes.set(id,obj);return obj;
 }
 const document={
  getElementById:id=>nodes.get(id)||el(id),
  createElement:tag=>el(),
  head:{appendChild(){sdkRequests++;throw Error('No SDK needed for Apple Pay redirect')}}
 };
 const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
 const fetch=async(path,options={})=>{
  calls.push({path,method:options.method||'GET'});
  if(path==='/api/v1/store/account')
   return response(200,{customerId,email:'person@example.test'});
  if(path==='/api/v1/store/account/cart'&&options.method!=='POST')
   return response(200,{items:[item],couponCode:'',revision:1});
  if(path==='/api/v1/store/products')
   return response(200,{checkoutAvailable:true,paymentMethods:{cards:true,applePay:merchantEnabled}});
  if(path==='/api/v1/store/cart/pending')
   return response(200,{ok:true,pending:false});
  if(path==='/api/v1/store/cart/quote')
   return response(200,{codeCount:1,subtotalMinor:5000,discountMinor:0,
    totalMinor:5000,items:[{...item,lineTotalMinor:5000}]});
  if(path==='/api/v1/store/cart/checkout')
   return response(201,{provider:'geidea',checkoutMode:'redirect',sku:'cart',
    orderId,sessionId,sessionExpiresAt:new Date(Date.now()+9*60000).toISOString(),
    orderNumber:'BF-261120-BBBBBBBB',accessToken:token,priceMinor:5000,currency:'SAR'});
  throw Error('unexpected request '+path);
 };
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const sessionStorage={getItem:k=>saved.get(k)||null,
  setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const location={search:'',origin:'https://blofyplayer.com',
  assign(path){redirects.push(path);}};
 const ctx={window:{...deviceSupported?{ApplePaySession:{canMakePayments:()=>true}}:{}},
  document,fetch,localStorage,sessionStorage,location,
  history:{replaceState(){}},URLSearchParams,console,confirm:()=>true,
  setTimeout,clearTimeout};
 vm.runInNewContext(script,ctx,{filename:'store-cart.js'});
 await new Promise(resolve=>setTimeout(resolve,25));
 return {nodes,events,calls,redirects,saved,sdkRequests:()=>sdkRequests};
}

test('supported Apple Wallet creates ONE order and redirects to same Geidea hosted session',async()=>{
 const f=await fixture();
 assert.equal(f.nodes.get('checkout-apple-pay').hidden,false);
 assert.equal(f.nodes.get('checkout-apple-pay').disabled,false);
 assert.equal(f.nodes.get('apple-pay-option').hidden,false);
 const click=f.events.get('checkout-apple-pay:click');
 assert.equal(typeof click,'function');
 click();
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.deepEqual(f.redirects,[hosted]);
 assert.equal(f.calls.filter(x=>x.path==='/api/v1/store/cart/checkout').length,1);
 assert.equal(f.sdkRequests(),0,'Apple Pay must not depend on drop-in iframe or site-owned wallet tokens');
 assert.equal(f.saved.get('blofy.shop.order.'+orderId),token);
 assert.equal(JSON.parse(f.saved.get('blofy.shop.pending-checkout.v1')).sessionId,sessionId);
 assert.equal(f.nodes.get('checkout-apple-pay').disabled,true,
  'same session remains locked while payment is in progress');
});

test('disabled merchant wallet remains hidden even if a device supports Apple Pay',async()=>{
 const f=await fixture({merchantEnabled:false});
 assert.equal(f.nodes.get('checkout-apple-pay').hidden,true);
 assert.equal(f.nodes.get('apple-pay-option').hidden,true);
 assert.match(f.nodes.get('payment-wallet-note').textContent,/قيد التفعيل/);
 assert.equal(f.calls.filter(x=>x.path==='/api/v1/store/cart/checkout').length,0);
});

test('non-Apple device keeps ordinary card checkout available',async()=>{
 const f=await fixture({merchantEnabled:true,deviceSupported:false});
 assert.equal(f.nodes.get('checkout-apple-pay').hidden,true);
 assert.equal(f.nodes.get('apple-pay-option').hidden,false);
 assert.equal(f.nodes.get('checkout').disabled,false);
 assert.match(f.nodes.get('payment-wallet-note').textContent,/الأجهزة المدعومة/);
 assert.equal(f.calls.filter(x=>x.path==='/api/v1/store/cart/checkout').length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseSavedStoreCart,parseStoreCart,isTrialCartSku} from '../src/store-cart.mjs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const script=read('../web/store-cart.js');
const cartHtml=read('../web/store-cart.html');
const home=read('../web/store.html');
const server=read('../src/server.mjs');
test('zero SAR trial may be saved but never parsed as a paid Geidea invoice',()=>{
 const trial={sku:'trial-stream-1d',quantity:1};
 const paid={sku:'stream-3m',quantity:1};
 assert.equal(isTrialCartSku(trial.sku),true);
 assert.equal(parseStoreCart([trial]),null);
 assert.equal(parseStoreCart([paid,trial]),null);
 assert.deepEqual(parseSavedStoreCart([trial]),[trial]);
 assert.deepEqual(parseSavedStoreCart([paid,trial]),[paid,trial]);
 assert.equal(parseSavedStoreCart([{sku:'trial-stream-1d',quantity:2}]),null);
 assert.equal(parseSavedStoreCart([{sku:'trial-stream-1d',quantity:1},
   {sku:'trial-xtream-1d',quantity:1}]),null);
 assert.equal(parseSavedStoreCart([{sku:'trial-xtream-1d',quantity:1},
   {sku:'trial-xtream-1d',quantity:1}]),null);
 assert.deepEqual(parseSavedStoreCart([]),[]);
 assert.equal(parseSavedStoreCart(undefined),null);
 assert.equal(parseSavedStoreCart({items:[]}),null);
 assert.equal(parseSavedStoreCart([{sku:'fake-free',quantity:1}]),null);
});
test('free day is one of five price choices inside both product cards, not a standalone product',()=>{
 for(const product of ['stream','xtream']){
  assert.match(home,new RegExp('id="duration-'+product+'"[^>]*><option value="تجربة مجانية"'));
  assert.match(home,new RegExp('data-plan-product="'+product+'" data-plan-option="تجربة مجانية"'));
  assert.match(home,new RegExp('data-trial-stock="'+product+'"'));
  assert.match(home,new RegExp('trial-'+product+'-1d'));
 }
 assert.doesNotMatch(home,/id="trial-product"|id="trial-home-stock"|data-free-trial-link/);
 assert.doesNotMatch(home,/href="[^"]*store.trial"/);
 assert.match(home,/0 ر.س/);
 assert.ok(home.includes('/api/v1/store/trials/availability'));
 assert.match(home,/شهر — 25 ريال/);
 assert.match(home,/3 أشهر — 50 ريال/);
});
test('Geidea SDK uses official drop-in, with no merchant card inputs or callback-based code release',()=>{
 assert.match(cartHtml,/id="checkout-tag"/);
 assert.match(cartHtml,/id="geidea-embedded-panel"/);
 assert.match(cartHtml,/id="geidea-hosted-fallback"/);
 assert.match(script,/startPayment\(data\.sessionId,null,'checkout-tag'\)/);
 assert.match(script,/new window\.GeideaCheckout/);
 assert.match(script,/function ensureEmbeddedGeidea/);
 assert.match(script,/result\.status==='paid'&&result\.fulfilled===true/);
 assert.match(script,/\/api\/v1\/store\/trials\/claim/);
 assert.match(script,/paidLines\(\)\.map/);
 assert.doesNotMatch(cartHtml,/(?:name|id)="(?:cardNumber|cardExpiry|cardCvv|cvv)"/i);
 assert.doesNotMatch(script,/localStorage\.setItem\([^)]*(?:card|cvv)/);
 assert.match(server,/frame-src https:\/\/www\.ksamerchant\.geidea\.net/);
 assert.doesNotThrow(()=>new Function(script));
});
function browser({paid=false,incomplete=false,claimError=null,previousClaim=false}={}){
 let profileSaved=!incomplete;
 const customerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const initial=[{sku:'trial-stream-1d',quantity:1},
  ...(paid?[{sku:'stream-3m',quantity:1}]:[])];
 const storage=new Map([
  ['blofy.shop.cart.v1',JSON.stringify(initial)],
  ['blofy.shop.cart.owner.v1',customerId]
 ]);
 const nodes=new Map(),listeners=new Map(),requests=[];
 const make=(id='')=>{
   const el={id,hidden:false,disabled:false,textContent:'',value:'',dataset:{},children:[],
    className:'',style:{},setAttribute(){},scrollIntoView(){},focus(){},
    classList:{toggle(){}},
    addEventListener(event,callback){listeners.set(id+':'+event,callback);},
    append(...children){this.children.push(...children)},
    replaceChildren(...children){this.children=[...children]}
   };
   if(id)nodes.set(id,el);
   return el;
 };
 const document={getElementById(id){return nodes.get(id)||make(id)},
  createElement(){return make()}};
 const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
 let revision=3;
 const fetch=async(path,opts={})=>{
   const payload=opts.body?JSON.parse(opts.body):null;
   requests.push({path,method:opts.method||'GET',payload});
   if(path==='/api/v1/store/account')return response(200,{
     customerId,email:'verified@test.example',profileRequired:true,
     profileComplete:profileSaved,fullName:profileSaved?'اختبار BLOFY':'',
     phone:profileSaved?'+966551234567':''
   });
   if(path==='/api/v1/store/account/profile'&&opts.method==='POST'){
     assert.equal(payload.fullName,'اختبار BLOFY');
     assert.equal(payload.phone,'0551234567');
     profileSaved=true;
     return response(200,{ok:true,profileComplete:true,fullName:payload.fullName,
       phone:'+966551234567'});
   }
   if(path==='/api/v1/store/trials/mine'){
     return response(200,previousClaim?
       {ok:true,claimed:true,trial:{ok:true,code:'88776655',channel:'app',
         alreadyClaimed:true,activatedAt:null,expiresAt:null}}:
       {ok:true,claimed:false,trial:null});
   }
   if(path==='/api/v1/store/account/cart'&&opts.method!=='POST')
     return response(200,{items:initial,revision:3,couponCode:''});
   if(path==='/api/v1/store/account/cart')return response(200,{ok:true,revision:++revision});
   if(path==='/api/v1/store/products')return response(200,{checkoutAvailable:paid});
   if(path==='/api/v1/store/trials/availability')return response(200,{ok:true,enabled:true,
      products:[{sku:'trial-stream-1d',available:2,priceMinor:0,currency:'SAR',durationDays:1}]});
   if(path==='/api/v1/store/cart/quote'&&paid)
     return response(200,{items:[{sku:'stream-3m',quantity:1,lineTotalMinor:5000}],
      totalMinor:5000,subtotalMinor:5000,discountMinor:0,codeCount:1});
   if(path==='/api/v1/store/cart/pending'&&paid)return response(200,{pending:false});
   if(path==='/api/v1/store/trials/claim'){
     assert.deepEqual(payload,{sku:'trial-stream-1d'});
     if(claimError==='forbidden')return response(403,{error:'trial_profile_required'});
     if(claimError==='after_commit')return response(503,{error:'trial_claim_unconfirmed'});
     if(claimError==='other_channel')return response(200,{
       ok:true,sku:'trial-xtream-1d',channel:'xtream',durationDays:1,
       code:'98765432',alreadyClaimed:true,activatedAt:null,expiresAt:null});
     return response(200,{ok:true,sku:'trial-stream-1d',channel:'app',durationDays:1,
       code:'12345678',alreadyClaimed:false,expiresAt:null});
   }
   throw Error('Unexpected request '+path);
 };
 const session=new Map();
 const ctx={document,window:{},fetch,localStorage:{
   getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
   sessionStorage:{
    getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),
    removeItem:k=>session.delete(k)},
   location:{search:'',origin:'https://blofyplayer.com',assign(){}},
   history:{replaceState(){}},URLSearchParams,console,confirm:()=>true
 };
 vm.runInNewContext(script,ctx);
 return {requests,nodes,listeners,storage};
}
test('trial-only checkout takes verified free stock and never opens a Geidea session',async()=>{
 const b=browser();
 await new Promise(r=>setTimeout(r,40));
 assert.equal(b.nodes.get('checkout').disabled,false);
 assert.equal(b.nodes.get('total').textContent,'٠ ر.س');
 b.listeners.get('checkout:click')();
 await new Promise(r=>setTimeout(r,50));
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/trials/claim').length,1);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/cart/checkout').length,0);
 assert.equal(b.nodes.get('trial-cart-code').textContent,'12345678');
 assert.equal(b.nodes.get('trial-cart-result').hidden,false);
 assert.equal(JSON.parse(b.storage.get('blofy.shop.cart.v1')).length,0);
});
test('mixed basket takes free code first and leaves paid item for separate authorized payment',async()=>{
 const b=browser({paid:true});
 await new Promise(r=>setTimeout(r,50));
 assert.equal(b.nodes.get('total').textContent,'٥٠ ر.س');
 b.listeners.get('checkout:click')();
 await new Promise(r=>setTimeout(r,70));
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/trials/claim').length,1);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/cart/checkout').length,0);
 assert.deepEqual(JSON.parse(b.storage.get('blofy.shop.cart.v1')),
   [{sku:'stream-3m',quantity:1}]);
 assert.equal(b.nodes.get('trial-cart-code').textContent,'12345678');
});

test('verified email missing profile sees mandatory inline full name and phone before free checkout',async()=>{
 const b=browser({incomplete:true});
 await new Promise(r=>setTimeout(r,80));
 assert.equal(b.nodes.get('checkout-profile-panel').hidden,false,
   'same checkout page must display the missing customer form');
 assert.match(b.nodes.get('checkout').textContent,/أكمل الاسم والجوال/);
 b.listeners.get('checkout:click')();
 await new Promise(r=>setTimeout(r,10));
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/trials/claim').length,0,
   'must not submit trial until profile is saved');
 b.nodes.get('checkout-profile-name').value='اختبار BLOFY';
 b.nodes.get('checkout-profile-phone').value='0551234567';
 await b.listeners.get('checkout-profile-form:submit')({preventDefault(){}});
 assert.equal(b.nodes.get('checkout-profile-panel').hidden,true);
 assert.ok(b.requests.some(x=>x.path==='/api/v1/store/account/profile'));
 b.listeners.get('checkout:click')();
 await new Promise(r=>setTimeout(r,70));
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/trials/claim').length,1);
 assert.equal(b.nodes.get('trial-cart-code').textContent,'12345678');
});

test('403 profile gate shows actionable inline form instead of generic delivery error',async()=>{
 const b=browser({claimError:'forbidden'});
 await new Promise(r=>setTimeout(r,55));
 b.listeners.get('checkout:click')();
 await new Promise(r=>setTimeout(r,70));
 assert.equal(b.nodes.get('checkout-profile-panel').hidden,false);
 assert.match(b.nodes.get('checkout-profile-message').textContent,/الاسم ورقم الجوال/);
 assert.doesNotMatch(b.nodes.get('message').textContent,/تعذر التأكد من التسليم/);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/trials/claim').length,1);
});

test('an ambiguous trial response reopens the already-issued code without a duplicate claim',async()=>{
 const b=browser({claimError:'after_commit',previousClaim:true});
 await new Promise(r=>setTimeout(r,55));
 b.listeners.get('checkout:click')();
 await new Promise(r=>setTimeout(r,75));
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/trials/claim').length,1);
 assert.equal(b.requests.filter(x=>x.path==='/api/v1/store/trials/mine').length,1);
 assert.equal(b.nodes.get('trial-cart-code').textContent,'88776655');
 assert.equal(b.nodes.get('trial-cart-result').hidden,false);
 assert.equal(JSON.parse(b.storage.get('blofy.shop.cart.v1')).length,0);
});
test('an earlier trial of the other channel is shown correctly, not counted as second free code',async()=>{
 const b=browser({claimError:'other_channel'});
 await new Promise(r=>setTimeout(r,55));
 b.listeners.get('checkout:click')();
 await new Promise(r=>setTimeout(r,60));
 assert.equal(b.nodes.get('trial-cart-code').textContent,'98765432');
 assert.equal(b.nodes.get('trial-cart-xtream').hidden,false);
 assert.match(b.nodes.get('message').textContent,/تجربتك السابقة/);
});

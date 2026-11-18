import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Reproduce the user's precise failure: valid signed-in cart but the Geidea
// modal global never loads. The official hosted checkout must still open.
test('signed-in cart redirects to official hosted Geidea even when modal SDK is absent',async()=>{
 const code=readFileSync(new URL('../web/store-cart.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../web/store-cart.html',import.meta.url),'utf8');
 const storage=new Map();
 const customerId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const orderId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const token='x'.repeat(43);
 const item={sku:'stream-3m',quantity:1};
 storage.set('blofy.shop.cart.v1',JSON.stringify([item]));
 storage.set('blofy.shop.cart.owner.v1',customerId);
 const events=new Map(),nodes=new Map(),calls=[],redirects=[];
 let serverRecovery=false;
 function el(id=''){
  const node={id,hidden:false,disabled:false,style:{},dataset:{},children:[],value:'',
   textContent:'',className:'',setAttribute(){},
   addEventListener(type,handler){events.set((this.id||'element')+':'+type,handler);},
   append(...items){this.children.push(...items);},
   replaceChildren(...items){this.children=[...items];},
   scrollIntoView(){}};
  if(id)nodes.set(id,node);return node;
 }
 const document={getElementById(id){return nodes.get(id)||el(id);},createElement(tag){return el();}};
 // Pre-create named elements so repeated calls to getElementById keep identity.
 for(const id of ['checkout','items','clear-cart','coupon','apply','subtotal','discount',
 'total','codes-count','message','auth-gate','auth-title','auth-message','auth-link','cart-sync',
 'started','order-number','open-geidea','copy-private-link','check-pending','pending-status','retry-pending'])el(id);
 const fetch=async(path,opts={})=>{
  calls.push({path,method:opts.method||'GET'});
  const response=(status,data)=>({ok:status>=200&&status<300,status,
    json:async()=>data});
  if(path==='/api/v1/store/account')return response(200,{customerId,email:'test@example.com'});
  if(path==='/api/v1/store/account/cart'&&opts.method!=='POST')
   return response(200,{items:[item],couponCode:'',revision:3});
  if(path==='/api/v1/store/products')return response(200,{checkoutAvailable:true});
  if(path==='/api/v1/store/cart/pending')return response(200,serverRecovery?
   {ok:true,pending:true,orderId,sessionId,
     sessionExpiresAt:new Date(Date.now()+8*60000).toISOString(),
     orderNumber:'BF-261118-BBBBBBBB',status:'pending'}:{ok:true,pending:false});
  if(path==='/api/v1/store/cart/quote')return response(200,{codeCount:1,
   subtotalMinor:4000,discountMinor:0,totalMinor:4000,
   items:[{...item,lineTotalMinor:4000}]});
  if(path==='/api/v1/store/orders/status')return response(200,{orderId,status:'pending',fulfilled:false});
  if(path==='/api/v1/store/cart/checkout')return response(201,{
   provider:'geidea',checkoutMode:'modal',sku:'cart',orderId,
   sessionId,sessionExpiresAt:new Date(Date.now()+14*60000).toISOString(),
   accessToken:token,orderNumber:'BF-261118-BBBBBBBB',
   priceMinor:4000,currency:'SAR'
  });
  throw Error('Unexpected fetch: '+path);
 };
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const session=new Map();
 const sessionStorage={getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)};
 const location={search:'',origin:'https://blofyplayer.com',
  assign(url){redirects.push(url);}};
 const ctx={window:{},document,fetch,localStorage,sessionStorage,location,
  history:{replaceState(){}},URLSearchParams,console,confirm:()=>true};
 vm.runInNewContext(code,ctx,{filename:'store-cart.js'});
 await new Promise(resolve=>setTimeout(resolve,15));
 const button=nodes.get('checkout');
 assert.equal(button.disabled,false,'a verified and saved cart can pay');
 assert.equal(typeof ctx.window.GeideaCheckout,'undefined','modal SDK intentionally unavailable');
 const click=events.get('checkout:click');assert.equal(typeof click,'function');
 click();
 await new Promise(resolve=>setTimeout(resolve,15));
 assert.equal(calls.filter(x=>x.path==='/api/v1/store/cart/checkout').length,1);
 const hosted='https://www.ksamerchant.geidea.net/hpp/checkout/?'+sessionId;
 assert.deepEqual(redirects,[hosted]);
 assert.equal(nodes.get('open-geidea').href,hosted,'manual same-session fallback link exists');
 assert.equal(nodes.get('open-geidea').hidden,false);
 assert.equal(session.get('blofy.shop.order.'+orderId),token,'receipt secret stays local');
 assert.equal(nodes.get('started').hidden,false);
 assert.doesNotMatch(html,/geideaCheckout.min.js/);
 assert.equal(JSON.parse(session.get('blofy.shop.pending-checkout.v1')).orderId,orderId,
   'new session is preserved for safe recovery after browser back');
 // Simulate returning to the cart before completing Geidea payment. Never open
 // a second Geidea session, even if the customer presses the button again.
 nodes.clear();events.clear();
 for(const id of ['checkout','items','clear-cart','coupon','apply','subtotal','discount',
 'total','codes-count','message','auth-gate','auth-title','auth-message','auth-link','cart-sync',
 'started','order-number','open-geidea','copy-private-link','check-pending','pending-status'])el(id);
 vm.runInNewContext(code,{...ctx,window:{}},{filename:'store-cart.js'});
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(nodes.get('checkout').disabled,true,'outstanding Geidea session blocks new checkout');
 assert.equal(nodes.get('open-geidea').href,hosted,'customer can resume the SAME Geidea session');
 assert.equal(nodes.get('open-geidea').hidden,false);
 assert.match(nodes.get('pending-status').textContent,/نفس الجلسة/);
 assert.equal(calls.filter(x=>x.path==='/api/v1/store/cart/checkout').length,1,
   'reloading the page cannot create another payment session');
 // Switching device or clearing tab sessionStorage must still recover using the
 // verified account; no payment token or previous checkout secret is required.
 session.clear();serverRecovery=true;
 nodes.clear();events.clear();
 for(const id of ['checkout','items','clear-cart','coupon','apply','subtotal','discount',
 'total','codes-count','message','auth-gate','auth-title','auth-message','auth-link','cart-sync',
 'started','order-number','open-geidea','copy-private-link','check-pending','pending-status','retry-pending'])el(id);
 vm.runInNewContext(code,{...ctx,window:{}},{filename:'store-cart.js'});
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(nodes.get('checkout').disabled,true,
   'cross-device recovery must block another payment session');
 assert.equal(nodes.get('open-geidea').href,hosted);
 assert.equal(nodes.get('open-geidea').hidden,false);
 assert.equal(nodes.get('copy-private-link').hidden,true,
   'owner recovery never fabricates a private receipt bearer token');
 assert.match(nodes.get('pending-status').textContent,/نفس جلسة Geidea/);
 assert.equal(calls.filter(x=>x.path==='/api/v1/store/cart/checkout').length,1);
});

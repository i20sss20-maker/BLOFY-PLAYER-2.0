import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../web/store-account.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/store-account.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/store-cart.css',import.meta.url),'utf8');
const order=(number,status)=>({
 orderId:'aaaaaaaa-aaaa-4aaa-8aaa-'+number.slice(-12).padEnd(12,'0').replace(/[^0-9a-f]/ig,'0'),
 orderNumber:number,status,createdAt:'2026-11-18T19:00:00Z',amountMinor:4000
});
const future=days=>new Date(Date.now()+days*86400000).toISOString();
const subscriptions=[
 {voucherId:'a',channel:'app',codeHint:'A***1',redeemed:true,expiresAt:future(35),reason:null,canRenew:true},
 {voucherId:'b',channel:'xtream',codeHint:'X***2',redeemed:true,expiresAt:future(4),reason:null,canRenew:true},
 {voucherId:'c',channel:'app',codeHint:'A***3',redeemed:true,expiresAt:future(-3),reason:'not_eligible',canRenew:false},
 {voucherId:'d',channel:'app',codeHint:'A***4',redeemed:false,expiresAt:null,reason:'not_activated',canRenew:false},
 {voucherId:'e',channel:'xtream',codeHint:'X***5',redeemed:true,expiresAt:future(5),reason:'revoked',canRenew:false}
];

function browser({subs=subscriptions,subError=false}={}){
 const elements=new Map(),listeners=new Map(),calls=[];
 const local=new Map([['blofy.shop.cart.v1','[{"sku":"stream-3m","quantity":1}]'],
  ['blofy.shop.cart.owner.v1','22222222-2222-4222-8222-222222222222']]);
 const session=new Map([['blofy.shop.pending-checkout.v1','example']]);
 const make=(id='')=>{
  const el={id,value:'',hidden:false,disabled:false,children:[],className:'',dataset:{},
   textContent:'',style:{},type:'',checked:false,href:'',
   append(...children){this.children.push(...children)},
   replaceChildren(...children){this.children=[...children]},
   addEventListener(type,fn){listeners.set((this.id||'anonymous')+':'+type,fn)},
   setAttribute(){},scrollIntoView(){}};
  if(id)elements.set(id,el);
  return el;
 };
 for(const id of ['login','dashboard','message','receipt','codes','payment-receipt',
  'payment-receipt-details','orders','orders-search','orders-filter',
  'orders-result-count','refresh-orders','account-email','reminder-optin',
  'subscriptions','subscriptions-note','expiry-alerts','overview-paid',
  'overview-pending','overview-active','overview-expiring','request-form',
  'request-button','verify-form','verify-button','claim-form','claim-button',
  'reminder-status','logout','payment-receipt-close','payment-receipt-print',
  'close-receipt','checkout-return','claim-order','claim-token','email',
  'otp','receipt-title','receipt-status'])make(id);
 elements.get('orders-filter').value='all';
 const document={visibilityState:'visible',
  getElementById:id=>elements.get(id)||make(id),
  createElement:()=>make(),
  addEventListener(){}};
 let records=[
  order('BF-261118-AAA00001','paid'),
  order('BF-261118-BBB00002','pending'),
  order('BF-261118-CCC00003','failed'),
  order('BF-261118-DDD00004','cancelled')
 ];
 const fetch=async(url,opts={})=>{
  calls.push({url,method:opts.method||'GET'});
  const ok=data=>({ok:true,status:200,json:async()=>data});
  if(url==='/api/v1/store/account')return ok({
    email:'verified@example.com',alertsOptIn:false,orders:records
  });
  if(url==='/api/v1/store/account/subscriptions'){
   if(subError)throw Error('backend_unavailable');
   return ok({renewalsAvailable:true,subscriptions:subs,plans:[]});
  }
  if(url==='/api/v1/store/account/alerts')return ok({alerts:[]});
  if(url==='/api/v1/store/account/logout')return ok({ok:true});
  throw Error('Unexpected URL: '+url);
 };
 const context={window:{addEventListener(){},print(){}},
  document,fetch,URLSearchParams,Date,Intl,console,
  location:{search:'',hash:'',replace(){},assign(){}},
  history:{replaceState(){}},
  sessionStorage:{getItem:k=>session.get(k)||null,
   setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},
  localStorage:{getItem:k=>local.get(k)||null,
   removeItem:k=>local.delete(k),setItem:(k,v)=>local.set(k,v)},
  setTimeout,clearTimeout,confirm:()=>true};
 vm.runInNewContext(js,context,{filename:'store-account.js'});
 return {elements,listeners,calls,local,session,setRecords:rows=>{records=rows}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,25));

test('authenticated BLOFY site shows accurate order and subscription dashboard without issuing codes',async()=>{
 const b=browser();
 await tick();
 assert.equal(b.elements.get('dashboard').hidden,false);
 assert.equal(b.elements.get('overview-paid').textContent,'1');
 assert.equal(b.elements.get('overview-pending').textContent,'1');
 assert.equal(b.elements.get('overview-active').textContent,'2');
 assert.equal(b.elements.get('overview-expiring').textContent,'1');
 assert.equal(b.elements.get('orders').children.length,4);
 assert.match(b.elements.get('orders-result-count').textContent,/4 من 4/);
 assert.equal(b.calls.some(x=>x.url.endsWith('/checkout')||x.url.endsWith('/check')),false);
});

test('order filters and search reuse only authenticated account data without server queries',async()=>{
 const b=browser();await tick();
 const prior=b.calls.length;
 b.elements.get('orders-filter').value='paid';
 b.listeners.get('orders-filter:change')();
 assert.equal(b.elements.get('orders').children.length,1);
 assert.match(b.elements.get('orders-result-count').textContent,/1 من 4/);
 b.elements.get('orders-search').value='AAA';
 b.listeners.get('orders-search:input')();
 assert.equal(b.elements.get('orders').children.length,1);
 b.elements.get('orders-search').value='BBB';
 b.listeners.get('orders-search:input')();
 assert.equal(b.elements.get('orders').children.length,1,
  'empty state appears instead of displaying another order status');
 assert.match(b.elements.get('orders').children[0].textContent,/لا توجد طلبات/);
 assert.equal(b.calls.length,prior,'search must not query unrelated account orders');
});

test('customer refresh re-fetches summaries, never starts checkout or verifies Geidea implicitly',async()=>{
 const b=browser();await tick();
 b.setRecords([order('BF-261118-EEE00005','paid')]);
 await b.listeners.get('refresh-orders:click')();
 assert.equal(b.elements.get('overview-paid').textContent,'1');
 assert.equal(b.elements.get('overview-pending').textContent,'0');
 assert.equal(b.elements.get('orders').children.length,1);
 assert.equal(b.elements.get('refresh-orders').disabled,false);
 assert.equal(b.calls.filter(x=>x.url==='/api/v1/store/account').length,2);
 assert.equal(b.calls.some(x=>x.url.includes('/checkout')||x.url.endsWith('/check')),false);
});

test('subscription read failure stays unknown and is never presented as zero active subscriptions',async()=>{
 const b=browser({subError:true});await tick();
 assert.equal(b.elements.get('overview-active').textContent,'—');
 assert.equal(b.elements.get('overview-expiring').textContent,'—');
 assert.match(b.elements.get('subscriptions-note').textContent,/تعذّر تحميل/);
});

test('logout hides totals and removes private local basket references while preserving server orders',async()=>{
 const b=browser();await tick();
 await b.listeners.get('logout:click')();await tick();
 assert.equal(b.elements.get('dashboard').hidden,true);
 assert.equal(b.elements.get('overview-paid').textContent,'—');
 assert.equal(b.elements.get('overview-active').textContent,'—');
 assert.equal(b.elements.get('orders').children.length,0);
 assert.equal(b.local.has('blofy.shop.cart.owner.v1'),false);
 assert.equal(b.local.has('blofy.shop.cart.v1'),false);
 assert.equal(b.session.has('blofy.shop.pending-checkout.v1'),false);
 assert.equal(b.calls.filter(x=>x.url==='/api/v1/store/account/logout').length,1);
});

test('HTML summary, order filters and existing customer paid receipts remain accessible',()=>{
 assert.doesNotThrow(()=>new Function(js));
 for(const id of ['overview-paid','overview-pending','overview-active','overview-expiring',
  'orders-search','orders-filter','orders-result-count','refresh-orders','payment-receipt'])
   assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/store\\/account\\.js\\?v=[a-z0-9-]+/i);
 assert.match(html,/store\/cart\.css\?v=4/);
 assert.match(css,/account-summary-grid/);
 assert.match(css,/prefers-reduced-motion/);
 assert.match(js,/showPaymentReceipt/);
 assert.match(js,/receipt\.isTaxInvoice!==false/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const html=read('../web/store.html');
const css=read('../web/store-market.css');
const script=read('../web/store-market.js');

test('mobile store exposes orders and an accessible cart counter without altering checkout',()=>{
 const nav=html.match(/<nav class="market-mobile-nav"[\s\S]*?<\/nav>/)?.[0];
 assert.ok(nav,'mobile navigation exists');
 for(const href of ['/','/#products','/store/cart','/store/orders','/store/account'])
   assert.ok(nav.includes('href="'+href+'"'),href);
 assert.match(nav,/id="market-mobile-cart-count"[^>]*hidden/);
 assert.match(html,/\/store\/market\.css\?v=3/);
 assert.match(html,/\/store\/market\.js\?v=3/);
 assert.match(html,/id="store-receipt"/);
 assert.match(html,/id="bundle-receipt"/);
 assert.match(css,/\.market-category-nav\s*\{/);
 assert.match(css,/scroll-snap-type:x proximity/);
 assert.match(css,/overscroll-behavior-x:contain/);
 assert.match(css,/\.market-mobile-nav a:focus-visible/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.doesNotThrow(()=>new Function(script));
});

test('desktop and mobile cart badges stay synchronized; scroll respects reduced-motion',()=>{
 const node=overrides=>({
   hidden:false,textContent:'',value:'',dataset:{},listeners:{},attrs:{},
   addEventListener(type,fn){this.listeners[type]=fn;},
   setAttribute(k,v){this.attrs[k]=v;},
   scrollIntoView(options){this.scrollOptions=options;},
   classList:{contains:()=>false},
   ...overrides
 });
 const form=node(),input=node(),topBadge=node(),mobileBadge=node(),
       products=node(),result=node(),feedback=node(),collection=node({querySelector:()=>null});
 const oneCard=node({dataset:{productCard:'stream'},textContent:'BLOFY STREAM سنة'});
 const els={
   'market-search-form':form,'market-search':input,
   'market-cart-count':topBadge,'market-mobile-cart-count':mobileBadge,
   'market-results-count':result,'market-search-feedback':feedback,
   'shop-managed-products':collection,products
 };
 const doc={
   getElementById:id=>els[id]||null,
   querySelectorAll:selector=>selector==='article.product,article.managed-product'?[oneCard]:[],
   querySelector:()=>null,
   addEventListener:()=>{},
   body:{dataset:{}}
 };
 let reduced=true;
 const win={matchMedia:()=>({matches:reduced}),addEventListener:()=>{}};
 const storage=[{sku:'stream-1y',quantity:2},{sku:'bundle-2y',quantity:1}];
 const sandbox={document:doc,window:win,
   localStorage:{getItem:()=>JSON.stringify(storage)},
   location:{search:'',origin:'https://blofyplayer.com'},
   URLSearchParams,URL,
   fetch:()=>Promise.reject(new Error('offline')),
   setTimeout:fn=>{fn();return 1;},clearTimeout:()=>{}
 };
 vm.runInNewContext(script,sandbox,{timeout:1000});
 assert.equal(topBadge.textContent,'4');
 assert.equal(mobileBadge.textContent,'4');
 assert.equal(topBadge.hidden,false);
 assert.equal(mobileBadge.hidden,false);
 assert.equal(mobileBadge.attrs['aria-label'],'عدد الأكواد في السلة: 4');
 form.listeners.submit({preventDefault(){}});
 assert.equal(products.scrollOptions.behavior,'auto');
 reduced=false;
 form.listeners.submit({preventDefault(){}});
 assert.equal(products.scrollOptions.behavior,'smooth');
});

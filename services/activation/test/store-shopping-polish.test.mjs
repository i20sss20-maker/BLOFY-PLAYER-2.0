import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const main=source('../web/store.html');
const cart=source('../web/store-cart.html');
const account=source('../web/store-account.html');
const orders=source('../web/store-orders.html');
const marketScript=source('../web/store-market.js');
const cartStyle=source('../web/store-checkout-theme.css');

test('one visual shopping theme is loaded on cart, account and order pages',()=>{
  for(const [name,html] of [['cart',cart],['account',account],['orders',orders]]){
    assert.match(html,/\/store\/checkout-theme\.css\?v=(?:1|2)/,name+' must load the same shopping theme');
    assert.match(html,/class="store-mobile-links"/,name+' must expose mobile navigation');
    for(const path of ['/', '/store/cart', '/store/account'])
      assert.ok(html.includes('href="'+path+'"'),name+' navigation has '+path);
  }
  assert.match(cartStyle,/\.cart-experience \.card/);
  assert.match(cartStyle,/\.account-stat/);
  assert.match(cartStyle,/\.code-card code/);
  assert.match(cartStyle,/@media print/);
  assert.match(cartStyle,/\.cart-experience \.mobile-checkout-dock/);
  assert.doesNotMatch(cartStyle,/position:\s*fixed.*card/);
});
test('new search and mobile navigation preserve normal purchase/catalog controls',()=>{
  assert.match(main,/class="market-mobile-nav"/);
  assert.match(main,/id="market-search"/);
  assert.match(main,/id="market-results-count"/);
  for(const filter of ['all','stream','xtream'])
    assert.match(main,new RegExp('data-market-filter="'+filter+'"'));
  assert.match(main,/data-cart-add="stream"/);
  assert.match(main,/data-cart-add="xtream"/);
  assert.match(main,/id="bundle-first"/);
  assert.match(main,/id="bundle-second"/);
  assert.match(main,/\/store\/market\.js\?v=2/);
  assert.match(main,/\/store\/market\.css\?v=3/);
  assert.match(main,/\/store\/showcase\.js\?v=2/);
  assert.doesNotThrow(()=>new Function(marketScript));
});
test('server can deliver new theme without changing Geidea or order routes',()=>{
  const server=source('../src/server.mjs');
  assert.match(server,/requestUrl\.pathname==='\/store\/checkout-theme\.css'/);
  assert.match(server,/serveStoreAssetFile\(res,'store-checkout-theme\.css','text\/css; charset=utf-8'\)/);
  assert.match(server,/storeBranding\(req,res,requestUrl\)/);
  assert.match(server,/storeShowcase\(req,res,requestUrl\)/);
});
test('storefront filter handles Arabic/English search and admin-loaded products',async()=>{
  const events=new Map(),docEvents=new Map();
  const node=extra=>({
    hidden:false,textContent:'',value:'',dataset:{},attributes:{},
    listeners:{},addEventListener(type,fn){this.listeners[type]=fn;},
    setAttribute(k,v){this.attributes[k]=v;},
    scrollIntoView(){this.scrolled=true;},
    ...extra
  });
  const stream=node({dataset:{productCard:'stream'},textContent:'اشتراك بلوفي ستريم لمدة سنة',
    classList:{contains:()=>false}});
  const xtream=node({dataset:{productCard:'xtream'},textContent:'اشتراك BLOFY PLAYER اكستريم 3 أشهر',
    classList:{contains:()=>false}});
  const cards=[stream,xtream];
  const buttons=['all','stream','xtream'].map(f=>node({dataset:{marketFilter:f}}));
  const search=node({value:''}),form=node(),count=node(),feedback=node(),collection=node({
    hidden:true,querySelector(selector){return selector==='.managed-product'?cards.find(x=>x.dataset.checkoutSku)||null:null;}
  });
  const badge=node(),products=node();
  const elements={
    'market-search':search,'market-search-form':form,'market-results-count':count,
    'market-search-feedback':feedback,'shop-managed-products':collection,
    'market-cart-count':badge,products
  };
  const document={
    getElementById:id=>elements[id]||null,
    querySelectorAll:selector=>{
      if(selector==='article.product,article.managed-product')return cards;
      if(selector==='[data-market-filter]')return buttons;
      return [];
    },
    querySelector:()=>null,
    addEventListener:(name,fn)=>docEvents.set(name,fn),
    body:{dataset:{}}
  };
  const window={addEventListener:(name,fn)=>events.set(name,fn)};
  const sandbox={
    document,window,localStorage:{getItem:()=>null},location:{search:'',origin:'https://blofyplayer.com'},
    URLSearchParams,fetch:()=>Promise.reject(Error('offline')),setTimeout:fn=>{fn();return 1;},
    clearTimeout:()=>{},console,URL
  };
  vm.runInNewContext(marketScript,sandbox,{timeout:1000});
  // Normalized Arabic search must find the xtream product despite hamza forms.
  search.value='إكستريم';form.listeners.submit({preventDefault(){}});
  assert.equal(stream.hidden,true);
  assert.equal(xtream.hidden,false);
  assert.match(count.textContent,/منتج واحد/);
  search.value='';buttons.find(x=>x.dataset.marketFilter==='stream').listeners.click();
  assert.equal(stream.hidden,false);
  assert.equal(xtream.hidden,true);
  assert.equal(buttons[1].attributes['aria-pressed'],'true');
  // Simulate a third product published by admin after script initialization.
  const managed=node({dataset:{checkoutSku:'stream-1y'},
    textContent:'باقة ستريم مميزة',classList:{contains:x=>x==='managed-product'}});
  cards.push(managed);
  docEvents.get('blofy:showcase-ready')();
  assert.equal(managed.hidden,false);
  assert.equal(collection.hidden,false);
  assert.match(count.textContent,/2/);
  search.value='لا توجد باقة بهذا الاسم';form.listeners.submit({preventDefault(){}});
  assert.equal(feedback.hidden,false);
  assert.match(feedback.textContent,/ما لقينا/);
});

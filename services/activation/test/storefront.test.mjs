import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {injectSubscriberPortalUi} from '../src/subscriber-portal-ui-hook.mjs';
import {publicStorePlans,publicStoreOffers,validBundleChannels,createStoreGeideaHandlers} from '../src/store-geidea-checkout.mjs';

const html=readFileSync(new URL('../web/store.html',import.meta.url),'utf8');
test('Exactly two BLOFY subscription products; no app/download offers',()=>{
 assert.match(html,/<html lang="ar" dir="rtl">/);
 assert.match(html,/كود BLOFY STREAM/);
 assert.match(html,/اشتراك Xtream BLOFY/);
 assert.equal((html.match(/<article class="product"/g)||[]).length,2);
 for(const key of ['stream','xtream'])assert.match(html,new RegExp('data-buy="'+key+'"'));
 assert.match(html,/https:\/\/wa\.me\/966568941484/);
 assert.match(html,/href="\/privacy"/);
 assert.match(html,/href="\/store\/contact"/);
 assert.doesNotMatch(html,/\/downloads|تحميل التطبيق|BLOFY BUSINESS|href="\/pay"/);
});
test('Public catalog prices use exact server values for 1, 3, 6 and 12 months',()=>{
 const plans=publicStorePlans();
 assert.equal(plans.length,8);
 for(const channel of ['app','xtream']){
   const subset=plans.filter(p=>p.channel===channel);
   assert.deepEqual(subset.map(p=>p.priceMinor),[2500,5000,7000,12000]);
   assert.deepEqual(subset.map(p=>p.durationDays),[30,90,180,365]);
   assert.ok(subset.every(p=>p.currency==='SAR'));
 }
 for(const price of ['25 ر.س','50 ر.س','70 ر.س','120 ر.س'])assert.match(html,new RegExp(price));
 assert.match(html,/GeideaCheckout/);
 assert.match(html,/\/api\/v1\/store\/checkout/);
 assert.match(html,/\/api\/v1\/store\/orders\/status/);
 assert.match(html,/sessionStorage/);
 assert.match(html,/location\.replace\('\/portal'\+hash\)/);
 assert.doesNotMatch(html,/GEIDEA_LIVE_API_PASSWORD|GEIDEA_LIVE_MERCHANT_PUBLIC_KEY|<input[^>]+(?:card|cvv)/i);
});
test('Scripts compile, and subscriber UI injection leaves storefront untouched',()=>{
 const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
 assert.equal(scripts.length,2);
 for(const s of scripts)assert.doesNotThrow(()=>new Function(s[1]));
 assert.equal(injectSubscriberPortalUi(html),html);
 assert.notEqual(injectSubscriberPortalUi('<html><body><div id="loginView"></div></body></html>'),'<html><body><div id="loginView"></div></body></html>');
});
test('Store uses one blue brand system, original product artwork, trial and detail pages',()=>{
 const css=readFileSync(new URL('../web/store-premium.css',import.meta.url),'utf8');
 assert.match(html,/href="\/store\/design\.css\?v=8"/);
 assert.match(css,/font-family:"BLOFY Arabic"/);
 assert.match(css,/IBMPlexSansArabic-Regular\.ttf/);
 assert.match(css,/--night:#050b18/);
 assert.match(html,/class="product-stage stream"/);
 assert.match(html,/class="product-stage xtream"/);
 assert.match(html,/href="\/products\/stream"/);
 assert.match(html,/href="\/products\/xtream"/);
 assert.doesNotMatch(html,/href="\/store\/trial"/);
 assert.doesNotMatch(html,/يوجد تجربة/);
 assert.doesNotMatch(html,/ادفع [0-9]+ ر\.س بجيديا/);
 assert.match(html,/اشترك الآن/);
});
test('Admin inventory UI integrates with owner portal and stock-first fulfillment',()=>{
 const dashboard=readFileSync(new URL('../web/store-inventory.html',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../web/blofy-one.html',import.meta.url),'utf8');
 const mod=readFileSync(new URL('../src/store-geidea-checkout.mjs',import.meta.url),'utf8');
 assert.match(dashboard,/id="generate"/);
 assert.match(dashboard,/id="import"/);
 assert.match(dashboard,/100 كود/);
 assert.match(admin,/href="\/admin\/store-inventory"/);
 assert.match(mod,/FOR UPDATE OF i SKIP LOCKED LIMIT 1/);
 assert.match(mod,/authorizeAdmin\(req,res\)/);
 assert.match(mod,/store_source_unavailable/);
});
test('Store checkout stays off without independent opt-in even if device Geidea config exists',async()=>{
 let queried=0,paid=0;
 const handler=createStoreGeideaHandlers({
   pool:{query:async()=>{queried++;throw Error('should not query DB')}},
   json:(res,status,data)=>{res.status=status;res.data=data;},
   readJson:async()=>({sku:'stream-3m'}),
   keyHex:'0'.repeat(64),
   env:{BLOFY_PAYMENT_PROVIDER:'geidea',BLOFY_GEIDEA_CHECKOUT_ENABLED:'true',
     GEIDEA_LIVE_MERCHANT_PUBLIC_KEY:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     GEIDEA_LIVE_API_PASSWORD:'verylongpassword1234'},
   fetchImpl:async()=>{paid++;throw Error('provider must not be called');}
 });
 let res={};
 assert.equal(await handler({method:'POST',headers:{origin:'https://blofyplayer.com'}},res,new URL('https://blofyplayer.com/api/v1/store/checkout')),true);
 assert.equal(res.status,503);
 assert.equal(res.data.error,'store_checkout_disabled');
 assert.equal(queried,0);
 assert.equal(paid,0);
});

test('Bulk code generation commits all 25 vouchers atomically without exposing secrets',async()=>{
 let created=0,rolledBack=0,committed=0,codeInserts=0,stockInserts=0;
 const db={async query(sql,args=[]){
   if(sql==='BEGIN')return {rows:[]};
   if(sql==='COMMIT'){committed++;return {rows:[]};}
   if(sql==='ROLLBACK'){rolledBack++;return {rows:[]};}
   if(sql.includes("SELECT to_regclass"))return {rows:[{n:'blofy_xtream_servers'}]};
   if(sql.startsWith("SELECT id FROM blofy_xtream_servers"))
     return {rows:[{id:'00000000-0000-4000-8000-000000000100'}]};
   if(sql.includes('COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes'))return {rows:[{n:0}]};
   if(sql.startsWith('INSERT INTO blofy_xtream_gateway_duration_codes')){
     codeInserts++;return {rows:[{id:args[0]}],rowCount:1};
   }
   if(sql.startsWith('INSERT INTO blofy_store_inventory')){
     stockInserts++;return {rows:[],rowCount:1};
   }
   return {rows:[],rowCount:0};
 },release(){}};
 const pool={query:db.query,connect:async()=>db};
 const env={BLOFY_PAYMENT_PROVIDER:'other'};
 const handler=createStoreGeideaHandlers({pool,keyHex:'a'.repeat(64),env,
   authorizeAdmin:()=>true,
   json:(res,status,body)=>{res.status=status;res.data=body;},
   readJson:async()=>({sku:'xtream-6m',quantity:25})});
 const response={};
 assert.equal(await handler({method:'POST'},response,{pathname:'/api/v1/admin/store/inventory/generate'}),true);
 assert.equal(response.status,200);
 assert.equal(response.data.generated,25);
 assert.equal(codeInserts,25);
 assert.equal(stockInserts,25);
 assert.equal(committed,2,'schema and batch each commit once');
 assert.equal(rolledBack,0);
 assert.equal(response.data.items,undefined);
});

test('Market storefront preserves separated product benefits and trusted checkout with original imagery',()=>{
 const premium=readFileSync(new URL('../web/store-premium.css',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const info=readFileSync(new URL('../src/store-info-pages.mjs',import.meta.url),'utf8');
 assert.match(html,/id="hero-title"/);
 assert.match(html,/class="market-slide" data-slide/);
 assert.match(html,/id="market-categories-title"/);
 assert.match(html,/class="market-service-strip"/);
 assert.match(html,/class="visual-feature-grid"/);
 assert.match(html,/\/store\/media\/strong8k\.jpg/);
 assert.match(html,/\/store\/media\/player\.jpg/);
 assert.match(html,/BLOFY PLAYER/);
 assert.match(html,/تنقل منظم بين المواسم والحلقات/);
 assert.match(html,/بحث داخل مكتبة المحتوى والمفضلة/);
 assert.match(html,/التنزيلات والمساعدة الذكية في الإصدارات التي تدعمها/);
 assert.match(html,/بعد التحقق من الدفع/);
 assert.match(premium,/\.campaign-banner/);
 assert.match(premium,/\.benefit-panels/);
 assert.match(server,/store-strong8k-banner\.svg/);
 assert.match(server,/store-player-banner\.svg/);
 assert.match(info,/STRONG 8K/);
 assert.doesNotMatch(html,/دقة عرض 8K لجميع/);
});

test('Image-first storefront presents banners above checkout and keeps text secondary',()=>{
 const firstBanner=html.indexOf('class="market-slide"');
 const productStart=html.indexOf('id="products"');
 const featureGallery=html.indexOf('class="visual-feature-grid"');
 assert.ok(firstBanner>0&&firstBanner<productStart,'lead banner must appear before products');
 assert.ok(featureGallery>productStart,'feature imagery follows product cards');
 assert.match(html,/src="\/store\/media\/strong8k\.jpg"[^>]*fetchpriority="high"/);
 assert.ok((html.match(/src="\/store\/media\/strong8k\.jpg"/g)||[]).length>=2);
 assert.ok((html.match(/src="\/store\/media\/player\.jpg"/g)||[]).length>=2);
 assert.equal((html.match(/<article class="product"/g)||[]).length,2);
 assert.match(html,/class="product-features"/);
 assert.match(html,/class="more-benefits"/);
 assert.match(html,/data-duration="stream"/);
 assert.match(html,/data-duration="xtream"/);
 assert.match(html,/data-buy="stream"/);
 assert.match(html,/data-buy="xtream"/);
 assert.match(html,/id="store-receipt"/);
});

test('Actual banner files are committed and available to the website as compact JPG images',()=>{
 const path=readFileSync(new URL('../web/banner-strong8k-ai.jpg',import.meta.url));
 const path2=readFileSync(new URL('../web/banner-player-ai.jpg',import.meta.url));
 const jpegHeader=Buffer.from([0xff,0xd8,0xff]);
 assert.deepEqual(path.subarray(0,3),jpegHeader);
 assert.deepEqual(path2.subarray(0,3),jpegHeader);
 assert.ok(path.length>40000&&path.length<180000,'STRONG 8K banner is a real optimized image');
 assert.ok(path2.length>40000&&path2.length<180000,'BLOFY PLAYER banner is a real optimized image');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 assert.match(server,/serveStorePhoto/);
 assert.match(server,/banner-strong8k-ai\.jpg/);
 assert.match(server,/banner-player-ai\.jpg/);
});


test('Annual two-voucher promotion has a fixed 200 SAR quote and only three legal combinations',()=>{
 const offers=publicStoreOffers();
 assert.equal(offers.length,1);
 const offer=offers[0];
 assert.equal(offer.sku,'bundle-2y');
 assert.equal(offer.quantity,2);
 assert.equal(offer.priceMinor,20000);
 assert.equal(offer.regularPriceMinor,24000);
 assert.equal(offer.durationDays,365);
 for(const combo of [['app','app'],['app','xtream'],['xtream','app'],['xtream','xtream']])
   assert.equal(validBundleChannels(combo),true);
 for(const invalid of [[],['app'],['app','xtream','app'],['hack','app'],null,{},['app',null]])
   assert.equal(validBundleChannels(invalid),false);
 assert.match(html,/id="bundle-first"/);
 assert.match(html,/id="bundle-second"/);
 assert.match(html,/id="bundle-buy"/);
 assert.match(html,/id="bundle-receipt"/);
 assert.match(html,/اشتراكان لمدة سنة/);
 assert.match(html,/200 ر.س/);
 assert.match(html,/240 ر.س/);
 assert.match(html,/\/store\/offers/);
});
test('Campaign carousel, promo graphic and individual coupon handling do not replace normal checkout',()=>{
 const js=readFileSync(new URL('../web/store-offers.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/store-premium.css',import.meta.url),'utf8');
 const backend=readFileSync(new URL('../src/store-geidea-checkout.mjs',import.meta.url),'utf8');
 assert.doesNotThrow(()=>new Function(js));
 assert.match(html,/id="blofy-banners"/);
 assert.equal((html.match(/<div class="market-slide" data-slide(?: data-market-promo="[01]")?(?: hidden)?>/g)||[]).length,3);
 assert.match(html,/data-prev-slide/);
 assert.match(html,/data-next-slide/);
 assert.match(html,/store\/media\/bundle\.svg/);
 assert.match(html,/id="store-coupon"/);
 assert.match(html,/id="coupon-preview"/);
 assert.match(html,/id="coupon-sku"/);
 assert.match(html,/href="\/store\/design\.css\?v=8"/);
 assert.match(css,/\.offer-spotlight/);
 assert.match(css,/\.coupon-panel/);
 assert.match(js,/sessionStorage\.setItem\('blofy\.bundle\.'/);
 assert.match(js,/data\.codes\.length===2/);
 assert.match(backend,/BEGIN/);
 assert.match(backend,/fulfillBundle/);
 assert.match(backend,/blofy_store_order_vouchers/);
 assert.match(backend,/FOR UPDATE OF i SKIP LOCKED LIMIT 1/);
 assert.match(backend,/store_coupon_limit_reached/);
 assert.match(backend,/discountAmount/);
 assert.match(backend,/store_invalid_coupon_amount/);
 assert.match(backend,/status='paid'/);
});
test('Checkout refuses malformed bundle selections without touching database or Geidea',async()=>{
 let dbReads=0,providerCalls=0;
 const handler=createStoreGeideaHandlers({
  pool:{query:async()=>{dbReads++;throw Error('DB may not be touched');}},
  json:(res,status,data)=>{res.status=status;res.data=data;},
  readJson:async()=>({sku:'bundle-2y',bundleSelection:['app']}),
  keyHex:'a'.repeat(64),
  env:{BLOFY_PAYMENT_PROVIDER:'geidea',BLOFY_GEIDEA_CHECKOUT_ENABLED:'true',BLOFY_STORE_GEIDEA_ENABLED:'true',
    GEIDEA_LIVE_MERCHANT_PUBLIC_KEY:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    GEIDEA_LIVE_API_PASSWORD:'verylongpassword1234'},
  fetchImpl:async()=>{providerCalls++;throw Error('must not fetch Geidea');}
 });
 const response={};
 const req={method:'POST',headers:{origin:'https://blofyplayer.com','sec-fetch-site':'same-origin'},socket:{remoteAddress:'127.0.0.1'}};
 assert.equal(await handler(req,response,{pathname:'/api/v1/store/checkout'}),true);
 assert.equal(response.status,400);
 assert.equal(response.data.error,'store_invalid_sku_or_bundle');
 assert.equal(dbReads,0);
 assert.equal(providerCalls,0);
});
test('Rejects outrageous coupon percentages and protects coupon admin routes',async()=>{
 let queries=0;
 const handler=createStoreGeideaHandlers({
  pool:{query:async()=>{queries++;throw Error('must reject early');}},
  json:(res,status,data)=>{res.status=status;res.data=data;},
  readJson:async()=>({code:'BLOFY90',percent:90,maxUses:20,validDays:30}),
  keyHex:'a'.repeat(64),authorizeAdmin:()=>true,env:{}
 });
 const response={};
 assert.equal(await handler({method:'POST'},response,{pathname:'/api/v1/admin/store/coupons/create'}),true);
 assert.equal(response.status,400);
 assert.equal(response.data.error,'store_invalid_coupon');
 assert.equal(queries,0);
});
test('Sales dashboard only counts paid orders toward revenue and has stock safeguards',()=>{
 const admin=readFileSync(new URL('../web/store-inventory.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/store-inventory.js',import.meta.url),'utf8');
 assert.match(admin,/id="sales-highlights"/);
 assert.match(admin,/id="coupon-create"/);
 assert.match(admin,/id="coupon-list"/);
 assert.match(js,/x\.status==='paid'/);
 assert.match(js,/fulfillmentIssues/);
 assert.match(js,/coupons\/deactivate/);
 assert.match(js,/coupons\/create/);
 assert.doesNotThrow(()=>new Function(js));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {injectSubscriberPortalUi} from '../src/subscriber-portal-ui-hook.mjs';
import {publicStorePlans,createStoreGeideaHandlers} from '../src/store-geidea-checkout.mjs';

const html=readFileSync(new URL('../web/store.html',import.meta.url),'utf8');
test('Exactly two BLOFY subscription products; no app/download offers',()=>{
 assert.match(html,/<html lang="ar" dir="rtl">/);
 assert.match(html,/اشتراك كود BLOFY STREAM/);
 assert.match(html,/اشتراك Xtream BLOFY/);
 assert.equal((html.match(/<article class="product"/g)||[]).length,2);
 for(const key of ['stream','xtream'])assert.match(html,new RegExp('data-buy="'+key+'"'));
 assert.match(html,/https:\/\/wa\.me\/966568941484/);
 assert.match(html,/href="\/privacy"/);
 assert.match(html,/href="\/support"/);
 assert.doesNotMatch(html,/\/downloads|تحميل التطبيق|BLOFY BUSINESS|href="\/pay"/);
});
test('Public catalog prices use exact server values for 3, 6 and 12 months',()=>{
 const plans=publicStorePlans();
 assert.equal(plans.length,6);
 for(const channel of ['app','xtream']){
   const subset=plans.filter(p=>p.channel===channel);
   assert.deepEqual(subset.map(p=>p.priceMinor),[4000,6000,10000]);
   assert.deepEqual(subset.map(p=>p.durationDays),[90,180,365]);
   assert.ok(subset.every(p=>p.currency==='SAR'));
 }
 for(const price of ['40 ر.س','60 ر.س','100 ر.س'])assert.match(html,new RegExp(price));
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
 assert.match(html,/--bg:#071326/);
 assert.match(html,/src="\/store\/media\/stream\.svg"/);
 assert.match(html,/src="\/store\/media\/xtream\.svg"/);
 assert.match(html,/href="\/products\/stream"/);
 assert.match(html,/href="\/products\/xtream"/);
 assert.match(html,/href="\/store\/trial"/);
 assert.match(html,/يوجد تجربة/);
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
 assert.match(mod,/stream_code_source/);
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

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
   assert.deepEqual(subset.map(p=>p.priceMinor),[3000,5000,7000]);
   assert.deepEqual(subset.map(p=>p.durationDays),[90,180,365]);
   assert.ok(subset.every(p=>p.currency==='SAR'));
 }
 for(const price of ['30 ر.س','50 ر.س','70 ر.س'])assert.match(html,new RegExp(price));
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseStoreCart,cartVouchers,publicOrderNumber} from '../src/store-cart.mjs';
const urlPath=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('BLOFY cart uses trusted prices and supports multiple products, quantities and mixed annual offer',()=>{
 const input=[
   {sku:'stream-6m',quantity:1},
   {sku:'xtream-3m',quantity:2},
   {sku:'bundle-2y',quantity:1,bundleSelection:['app','xtream']}
 ];
 const cart=parseStoreCart(input);
 assert.equal(cart.totalMinor,35000);
 assert.equal(cart.codeCount,5);
 assert.equal(cart.items.length,3);
 assert.equal(cart.items[0].unitPriceMinor,7000);
 assert.equal(cart.items[1].lineTotalMinor,8000);
 assert.equal(cart.items[2].lineTotalMinor,20000);
 assert.deepEqual(cartVouchers(input).map(x=>x.sku),
   ['stream-6m','xtream-3m','xtream-3m','stream-1y','xtream-1y']);
});
test('BLOFY cart refuses manipulated amounts, unknown subscriptions, duplicate lines and too many codes',()=>{
 for(const invalid of [
   null,[],{},[{sku:'fake',quantity:1}],
   [{sku:'stream-3m',quantity:0}],
   [{sku:'stream-3m',quantity:4}],
   [{sku:'stream-3m',quantity:1,bundleSelection:['app','app']}],
   [{sku:'bundle-2y',quantity:1,bundleSelection:['app','invalid']}],
   [{sku:'bundle-2y',quantity:1}],
   [{sku:'bundle-2y',quantity:3,bundleSelection:['app','xtream']},{sku:'xtream-1y',quantity:1}],
   [{sku:'stream-1y',quantity:2},{sku:'stream-1y',quantity:1}],
   Array.from({length:6},(_,i)=>({sku:['stream-3m','stream-6m','stream-1y','xtream-3m','xtream-6m','xtream-1y'][i],quantity:1}))
 ])assert.equal(parseStoreCart(invalid),null);
 const priceTamper=parseStoreCart([{sku:'xtream-1y',quantity:1,priceMinor:1,discount:999,days:3}]);
 assert.equal(priceTamper.totalMinor,12000);
 assert.equal(priceTamper.items[0].unitPriceMinor,12000);
});
test('Order reference is a non-sensitive receipt reference, not an authorization token',()=>{
 const n=publicOrderNumber('a1245678-abcd-4eef-84be-888888888888',new Date('2026-11-18'));
 assert.match(n,/^BF-261118-A1245678$/);
 assert.equal(n.includes('888888888888'),false);
});
test('BLOFY store has a verified-account cart, secure historical receipts and administrator order list',()=>{
 const store=urlPath('../web/store.html');
 const cart=urlPath('../web/store-cart.html');
 const cartJs=urlPath('../web/store-cart.js');
 const orders=urlPath('../web/store-orders.html');
 const orderJs=urlPath('../web/store-order-tracking.js');
 const backend=urlPath('../src/store-geidea-checkout.mjs');
 const server=urlPath('../src/server.mjs');
 const admin=urlPath('../web/store-inventory.html');
 assert.match(store,/data-cart-add="stream"/);
 assert.match(store,/data-cart-add="xtream"/);
 assert.match(store,/id="bundle-add-cart"/);
 assert.match(store,/href="\/store\/cart"/);
 assert.match(cart,/id="checkout"/);
 assert.match(cart,/تسجيل الدخول مطلوب قبل الدفع/);
 assert.match(cart,/id="auth-gate"/);
 assert.match(cartJs,/\/api\/v1\/store\/account\/cart/);
 assert.match(cartJs,/\/api\/v1\/store\/account/);
 assert.match(cartJs,/\/api\/v1\/store\/cart\/quote/);
 assert.match(cartJs,/\/api\/v1\/store\/cart\/checkout/);
 assert.match(cartJs,/sessionStorage\.setItem\('blofy\.shop\.order\.'/);
 assert.match(cartJs,/https:\/\/www\.ksamerchant\.geidea\.net\/hpp\/checkout\/\?/);
 assert.match(cartJs,/location\.assign\(paymentUrl\)/);
 assert.match(cart,/id="open-geidea"/);
 assert.doesNotMatch(cart,/geideaCheckout\.min\.js/,'payment must not depend on external modal JavaScript');
 assert.doesNotMatch(cartJs,/window\.GeideaCheckout/,'missing payment modal script cannot block checkout');
 assert.match(orders,/id="access-token"/);
 assert.match(orderJs,/\/api\/v1\/store\/orders\/status/);
 assert.match(orderJs,/history\.replaceState/);
 assert.match(server,/serveCartPage/);
 assert.match(server,/serveCartAsset/);
 assert.match(backend,/fulfillCart/);
 assert.match(backend,/blofy_store_cart_vouchers/);
 assert.match(backend,/store_invalid_cart/);
 assert.match(backend,/store_cart_quote_integrity_failed/);
 assert.match(backend,/\/api\/v1\/admin\/store\/orders/);
 assert.match(admin,/id="admin-orders"/);
 for(const js of [cartJs,orderJs])assert.doesNotThrow(()=>new Function(js));
});

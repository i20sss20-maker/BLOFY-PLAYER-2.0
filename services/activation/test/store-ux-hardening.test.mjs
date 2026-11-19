import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../web/'+p,import.meta.url),'utf8');

test('new subscriptions use a single verified-account cart, no homepage Geidea SDK preload',()=>{
 const home=read('store.html');
 assert.match(home,/href="\/store\/cart\?add=stream-3m"/);
 assert.match(home,/href="\/store\/cart\?add=xtream-3m"/);
 assert.match(home,/href="\/downloads"/);
 assert.doesNotMatch(home,/src="https:\/\/www\.ksamerchant\.geidea\.net\/hpp\/geideaCheckout\.min\.js"/);
 assert.match(home,/<link rel="canonical" href="https:\/\/blofyplayer\.com\/"/);
 assert.match(home,/<title>متجر BLOFY \| اشتراكات STREAM وXtream وتجربة مجانية<\/title>/);
 assert.match(home,/أكد بريدك وأكمل بياناتك/);
 assert.match(home,/استلم التجربة مجانًا أو ادفع بأمان من السلة/);
 assert.match(read('store-cart.html'),/id="checkout-profile-form"/);
 assert.match(read('store-cart.js'),/\/api\/v1\/store\/cart\/checkout/);
});
test('private Xtream passwords are erased on tab switch and automatically after 90 seconds',()=>{
 const app=read('stream-activate.js');
 const account=read('store-account.js');
 const info=read('stream-activate.html');
 assert.match(app,/const SECRET_DISPLAY_MS=90\*1000/);
 assert.match(app,/document\.addEventListener\('visibilitychange'/);
 assert.match(app,/clearTimeout\(secretTimer\)/);
 assert.match(app,/fields\.replaceChildren\(\)/);
 assert.match(account,/const PRIVATE_DISPLAY_MS=90\*1000/);
 assert.match(account,/document\.addEventListener\('visibilitychange'/);
 assert.match(account,/privateLogin\?\.remove\(\)/);
 assert.match(info,/تُخفى بيانات Xtream تلقائيًا بعد 90 ثانية/);
 assert.doesNotThrow(()=>new Function(app));
 assert.doesNotThrow(()=>new Function(account));
});
test('accessible mobile product controls and reduced motion use latest visual layer',()=>{
 const visual=read('store-visual.css');
 assert.match(visual,/:focus-visible/);
 assert.match(visual,/@media\(prefers-reduced-motion:reduce\)/);
 assert.match(visual,/min-height:49px/);
 const one=read('blofy-one.html');
 assert.match(one,/href="#one-code-register"/);
});

test('the two primary products appear before annual-bundle upsell, with honest trial entry',()=>{
 const home=read('store.html');
 assert.ok(home.indexOf('id="products"')<home.indexOf('id="offer"'),
  'show STREAM and Xtream products before the secondary yearly bundle');
 assert.match(home,/جرّب قبل ما تشترك/);
 assert.match(home,/تجربة مجانية لمدة يوم/);
 assert.match(home,/حسب توفر المخزون/);
 assert.match(home,/id="bundle-add-cart"/);
 assert.match(home,/id="duration-stream"/);
 assert.match(home,/id="duration-xtream"/);
});

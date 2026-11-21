import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const web = new URL('../web/',import.meta.url);
const [html,js,css] = await Promise.all([
  readFile(new URL('store-cart.html',web),'utf8'),
  readFile(new URL('store-cart.js',web),'utf8'),
  readFile(new URL('store-cart.css',web),'utf8')
]);
test('all cart UI bindings exist once in the new HTML',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size,'HTML contains no duplicate IDs');
  const bindings=[...js.matchAll(/\$\('([a-z0-9-]+)'\)/g)].map(m=>m[1]);
  for(const id of new Set(bindings))assert.ok(ids.includes(id),'Missing cart binding '+id);
});
test('cart retains account-first payment and same-order recovery',()=>{
  assert.match(js,/if\(!signedIn\)\{/);
  assert.match(js,/cloudSynced&&pendingChecked/);
  assert.match(js,/store\/cart\/pending/);
  assert.match(js,/store\/orders\/status/);
  assert.match(html,/id="checkout-login-form"/);
  assert.match(html,/id="checkout-verify-form"/);
  assert.match(js,/store\/account\/request-code/);
  assert.match(js,/store\/account\/verify-code/);
  assert.match(js,/window\.BLOFYAnalytics/);
});
test('mobile checkout has price feedback and same payment handler',()=>{
  assert.match(html,/id="mobile-total"/);
  assert.match(html,/id="mobile-checkout"/);
  assert.match(js,/mobile-checkout'\)\.addEventListener/);
  assert.match(css,/\.cart-experience \.mobile-checkout-dock/);
  assert.match(css,/safe-area-inset-bottom/);
});
test('Apple Pay is a gated Geidea hosted checkout option, never a fake charge',()=>{
  assert.match(html,/id="checkout-apple-pay"[^>]*hidden disabled/);
  assert.match(html,/id="apple-pay-option" hidden/);
  assert.match(js,/data\.paymentMethods\?\.applePay===true/);
  assert.match(js,/window\.ApplePaySession\.canMakePayments\(\)===true/);
  assert.match(js,/if\(preferApplePay\&\&\(!applePayMerchantEnabled\|\|!applePaySupported\(\)\)\)return/);
  assert.match(js,/checkout-apple-pay'\)\.addEventListener\('click',\(\)=>void checkout\(true\)\)/);
  assert.match(js,/location\.assign\(paymentUrl\)/);
  assert.match(js,/sessionStorage\.setItem\(pendingKey/);
  assert.match(css,/-webkit-appearance:-apple-pay-button/);
  assert.doesNotMatch(js,/new ApplePaySession\(/,'no self-made Apple Pay capture or wallet token');
  assert.doesNotMatch(html,/Apple Pay متوقف مؤقتًا/);
});

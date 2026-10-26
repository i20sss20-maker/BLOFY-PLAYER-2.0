import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTapPaymentHandlers} from '../src/tap-payments.mjs';

function renderPaymentPage(provider='geidea') {
  let html='',headers={},status=0;
  const handler=createTapPaymentHandlers({
    pool:{},json:()=>{},readJson:async()=>({}),authorize:async()=>null,
    schemaSql:'',
    env:{BLOFY_PAYMENT_PROVIDER:provider}
  });
  const res={
    writeHead(code,responseHeaders){status=code;headers=responseHeaders;},
    end(body){html=String(body);}
  };
  return handler({method:'GET'},res,new URL('https://blofyplayer.com/pay'))
    .then(()=>({html,status,headers}));
}
test('checkout page matches BLOFY original theme and works responsively',async()=>{
  const {html,status,headers}=await renderPaymentPage();
  assert.equal(status,200);
  assert.match(html,/--bg:#07070d/);
  assert.match(html,/--accent:#8b37ff/);
  assert.match(html,/--surface:rgba\(18,15,29,.88\)/);
  assert.match(html,/class="topbar"/);
  assert.match(html,/class="brand"/);
  assert.match(html,/src="\/blofy-logo.png"/);
  assert.match(html,/class="layout"/);
  assert.match(html,/@media\(max-width:540px\)/);
  assert.match(html,/id="plans"/);
  assert.match(html,/id="pay" disabled/);
  assert.match(html,/type="password" inputmode="numeric"/);
  assert.match(html,/id="deviceSync"/);
  assert.match(headers['content-security-policy'],/www\.ksamerchant\.geidea\.net/);
  assert.match(html,/geideaCheckout\.min\.js/);
});
test('BLOFY checkout reads linked device from same-origin session and private fragment, never from URL query',async()=>{
  const {html}=await renderPaymentPage();
  assert.match(html,/sessionStorage\.getItem\('blofyDevice'\)/);
  assert.match(html,/history\.replaceState/);
  assert.match(html,/location\.hash\.replace/);
  assert.match(html,/p\.delete\('activationCode'\)/);
  assert.match(html,/p\.delete\('code'\)/);
  assert.match(html,/startAutoFill\(\)/);
  assert.match(html,/method:'POST'/);
  assert.match(html,/\/api\/v1\/subscriptions\/customer/);
  assert.match(html,/autofillCustomer/);
  assert.doesNotMatch(html,/location\.search.*activationCode/);
});
test('Geidea name and phone can be omitted when no saved customer exists; Tap validation remains',async()=>{
  const {html}=await renderPaymentPage();
  assert.match(html,/paymentProvider==='tap'&&customerName.length<2/);
  assert.match(html,/paymentProvider==='tap'&&customerPhone/);
  assert.match(html,/label\[for="firstName"\]/);
  assert.match(html,/label\[for="phone"\]/);
});
test('server looks up customer only after authorizing the correct device',()=>{
  const source=readFileSync(new URL('../src/commercial-handlers.mjs',import.meta.url),'utf8');
  const authorize=source.indexOf('const body=await readJson(req),deviceId=await authorize(req,res,body)');
  const lookup=source.indexOf("if (path==='/api/v1/subscriptions/customer')");
  assert.ok(authorize>=0 && lookup>authorize);
  assert.match(source,/FROM device_customers WHERE device_id=\$1/);
  assert.match(source,/SELECT to_regclass\('public\.device_customers'\)/);
});

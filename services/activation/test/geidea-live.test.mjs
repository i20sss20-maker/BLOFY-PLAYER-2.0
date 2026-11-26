import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {minor,plansFromConfig,createSignature,verifyGeideaCallback,verifiedPayment,CARD_ONLY_WALLETS,geideaHiddenWallets} from '../src/geidea-live.mjs';

const publicKey='12345678-1234-4234-8234-123456789abc';
const password='a-private-test-password-not-real';
const id='44444444-4444-4444-8444-444444444444';
const orderId='55555555-5555-4555-8555-555555555555';
const config={publicKey,password};
const order={id,amount_minor:1250,currency:'SAR',provider_reference:null};
function payment() {
  return {
    orderId,merchantReferenceId:id,merchantPublicKey:publicKey,
    amount:12.5,totalAmount:12.5,currency:'SAR',isTest:false,
    status:'Success',detailedStatus:'Paid',paymentOperation:'Pay',
    totalCapturedAmount:12.5,totalRefundedAmount:0,
    paymentMethod:{type:'Card',brand:'mada',wallet:null},
    transactions:[{type:'Pay',status:'Success',currency:'SAR',amount:12.5,
      paymentMethod:{type:'Card',brand:'mada',wallet:null},codes:{responseCode:'000',detailedResponseCode:'000'}}]
  };
}
function callback(p=payment()) {
  const timeStamp='2026-10-26T12:00:00Z';
  const data=publicKey+'12.50'+'SAR'+p.orderId+p.status+id+timeStamp;
  return {order:p,timeStamp,signature:crypto.createHmac('sha256',password).update(data).digest('base64')};
}
test('decimal amounts are exact minor units',()=>{
  assert.equal(minor('12.50'),1250);
  assert.equal(minor(0),0);
  assert.throws(()=>minor('0.001'));
  assert.throws(()=>minor(-1));
});
test('create session signature uses Geidea specified HMAC',()=>{
  assert.equal(createSignature({publicKey,password,amountMinor:1250,reference:id,timestamp:'2026/10/26 12:00:00'}),
    crypto.createHmac('sha256',password).update(publicKey+'12.50SAR'+id+'2026/10/26 12:00:00').digest('base64'));
});
test('Geidea live plans reuse exact configured prices, never invent a plan',()=>{
  const p=plansFromConfig(JSON.stringify([{planKey:'tap-live-monthly',name:'شهر',priceMinor:1900,durationDays:30,currency:'SAR',maxDevices:1}]));
  assert.deepEqual(p.map(x=>[x.planKey,x.priceMinor,x.durationDays]),[['geidea-live-monthly',1900,30]]);
  assert.deepEqual(plansFromConfig(''),[]);
  assert.throws(()=>plansFromConfig(JSON.stringify([{planKey:'tap-live-test',name:'x',priceMinor:1,currency:'SAR'}])));
  assert.throws(()=>plansFromConfig(JSON.stringify([{planKey:'tap-live-foo',name:'x',priceMinor:1000,currency:'USD'}])));
});

test('BLOFY public tariffs remain exact when mapped to Geidea Live',()=>{
 const rows=[
  {planKey:'geidea-live-3months',name:'BLOFY PLAYER — 3 شهور',priceMinor:1000,durationDays:90},
  {planKey:'geidea-live-6months',name:'BLOFY PLAYER — 6 شهور',priceMinor:2000,durationDays:180},
  {planKey:'geidea-live-year',name:'BLOFY PLAYER — سنة',priceMinor:2500,durationDays:365},
  {planKey:'geidea-live-lifetime',name:'BLOFY PLAYER — مدى الحياة',priceMinor:4500,durationDays:null}
 ];
 const plans=plansFromConfig(JSON.stringify(rows));
 assert.deepEqual(plans.map(p=>[p.priceMinor,p.durationDays,p.currency,p.maxDevices]),[
  [1000,90,'SAR',1],[2000,180,'SAR',1],[2500,365,'SAR',1],[4500,null,'SAR',1]]);
});
test('live signed callback checks signature, amount, merchant, order and test flag',()=>{
  assert.equal(verifyGeideaCallback(callback(),order,config),orderId);
  assert.throws(()=>verifyGeideaCallback({...callback(),signature:'A'.repeat(43)+'='},order,config));
  assert.throws(()=>verifyGeideaCallback(callback({...payment(),isTest:true}),order,config));
  assert.throws(()=>verifyGeideaCallback(callback({...payment(),merchantPublicKey:crypto.randomUUID()}),order,config));
  assert.throws(()=>verifyGeideaCallback(callback({...payment(),amount:13}),order,config));
});
test('card-only session hides all provider wallets',()=>{
  assert.deepEqual([...CARD_ONLY_WALLETS],['apple-pay']);
  assert.deepEqual(geideaHiddenWallets({}),['apple-pay']);
  assert.deepEqual(geideaHiddenWallets({BLOFY_GEIDEA_APPLE_PAY_ENABLED:'false'}),['apple-pay']);
  assert.deepEqual(geideaHiddenWallets({BLOFY_GEIDEA_APPLE_PAY_ENABLED:'true'}),[]);
  // Geidea Live merchant already has Google/Samsung disabled; hiding them
  // again causes create-session code 110/112 instead of displaying card form.
});
test('paid only after actual captured Pay and no refunds',()=>{
  assert.equal(verifiedPayment(payment(),order,config),'paid');
  for (const brand of ['mada','visa','mastercard']) {
    const p=payment();
    p.paymentMethod.brand=brand;
    p.transactions[0].paymentMethod.brand=brand;
    assert.equal(verifiedPayment(p,order,config),'paid');
  }
  assert.throws(()=>verifiedPayment({...payment(),paymentMethod:{type:'Card',brand:'amex',wallet:null}},order,config));
  assert.throws(()=>verifiedPayment({...payment(),transactions:[{
    ...payment().transactions[0],paymentMethod:{type:'Card',brand:'amex',wallet:null}
  }]},order,config));
  assert.equal(verifiedPayment({...payment(),status:'Failed',detailedStatus:'OrderFailed'},order,config),'failed');
  assert.equal(verifiedPayment({...payment(),status:'InProgress',detailedStatus:'PayFailed'},order,config),'pending');
  assert.throws(()=>verifiedPayment({...payment(),isTest:true},order,config));
  assert.throws(()=>verifiedPayment({...payment(),paymentMethod:{type:'Card',brand:'visa',wallet:'ApplePay'}},order,config));
  assert.throws(()=>verifiedPayment({...payment(),paymentMethod:{type:'Wallet',wallet:'GooglePay'}},order,config));
  assert.equal(verifiedPayment({...payment(),paymentMethod:null},order,config),'paid');
  assert.throws(()=>verifiedPayment({...payment(),paymentMethod:{type:'Wallet',brand:'visa',wallet:'ApplePay'}},order,config));
  assert.throws(()=>verifiedPayment({...payment(),transactions:[{
    ...payment().transactions[0],paymentMethod:{type:'Card',wallet:'SamsungPay'}
  }]},order,config));
  assert.throws(()=>verifiedPayment({...payment(),totalRefundedAmount:1},order,config));
  assert.throws(()=>verifiedPayment({...payment(),totalCapturedAmount:1},order,config));
  assert.throws(()=>verifiedPayment({...payment(),transactions:[]},order,config));
  assert.throws(()=>verifiedPayment({...payment(),merchantReferenceId:crypto.randomUUID()},order,config));
  assert.throws(()=>verifiedPayment(payment(),{...order,provider_reference:crypto.randomUUID()},config));
});


test('Apple Pay is gated and accepted only for verified captured wallet Pay',()=>{
  const settled=payment();
  settled.paymentMethod={type:'Card',brand:'visa',wallet:'ApplePay'};
  settled.transactions[0].paymentMethod={type:'Card',brand:'visa',wallet:'ApplePay'};
  assert.throws(()=>verifiedPayment(settled,order,config));
  const approved={...config,applePayEnabled:true};
  assert.equal(verifiedPayment(settled,order,approved),'paid');
  const viaWallet=structuredClone(settled);
  viaWallet.paymentMethod.type='Wallet';
  viaWallet.transactions[0].paymentMethod.type='Wallet';
  assert.equal(verifiedPayment(viaWallet,order,approved),'paid');
  for (const other of ['GooglePay','SamsungPay','UnknownWallet']) {
    const invalid=structuredClone(settled);
    invalid.paymentMethod.wallet=other;
    invalid.transactions[0].paymentMethod.wallet=other;
    assert.throws(()=>verifiedPayment(invalid,order,approved));
  }
  for (const brand of ['amex','unknown']) {
    const invalid=structuredClone(settled);
    invalid.paymentMethod.brand=brand;
    invalid.transactions[0].paymentMethod.brand=brand;
    assert.throws(()=>verifiedPayment(invalid,order,approved));
  }
  assert.throws(()=>verifiedPayment({...settled,totalRefundedAmount:1},order,approved));
  assert.throws(()=>verifiedPayment({...settled,isTest:true},order,approved));
  assert.throws(()=>verifiedPayment({...settled,transactions:[]},order,approved));
  assert.throws(()=>verifiedPayment({...settled,totalCapturedAmount:1},order,approved));
  const mismatched=structuredClone(settled);
  mismatched.transactions[0].paymentMethod.wallet=null;
  assert.throws(()=>verifiedPayment(mismatched,order,approved));
});

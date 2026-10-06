import test from 'node:test';
import assert from 'node:assert/strict';
import { createZidPaymentHandlers, licenseLines, moneyMinor, orderIdFromZidPayload, parseZidPlans, renewedExpiry, ZID_DEVICE_FIELD } from '../src/zid-payments.mjs';

const plan = {planKey:'zid-3m',productId:'9d53456e-ea98-40b0-957d-468267c7eefd',sku:'BLOFY-PLAYER-3M',name:'3 months',durationDays:90,priceMinor:1000};
const order = overrides => ({id:123,store_id:3202741,payment_status:'paid',currency_code:'SAR',order_total:'10.000000',
  products:[{id:plan.productId,sku:plan.sku,order_product_id:456,quantity:1,total:10,
    custom_fields:[{label:ZID_DEVICE_FIELD,value:'blofy-ab12-cd34'}]}],...overrides});

test('Zid plans require explicit product IDs, matching SKU durations and safe store URLs',()=>{
  assert.equal(parseZidPlans(JSON.stringify([plan]))[0].productUrl,null);
  for(const change of [{durationDays:365},{productUrl:'https://attacker.example/products/foo'},
    {productUrl:'https://blofysat.com/products/foo?secret=123'},{priceMinor:0},{sku:'STRONG'}]) {
    assert.throws(()=>parseZidPlans(JSON.stringify([{...plan,...change}])));
  }
  assert.throws(()=>parseZidPlans(JSON.stringify([plan,plan])));
});
test('Paid license matching never trusts names, unrelated SKUs or order notes',()=>{
  assert.equal(licenseLines(order(),[plan],'3202741')[0].deviceId,'BLOFY-AB12-CD34');
  assert.deepEqual(licenseLines(order({products:[{...order().products[0],id:'unrelated'}]}),[plan],'3202741'),[]);
  assert.throws(()=>licenseLines(order({store_id:3}),[plan],'3202741'),/store_mismatch/);
  assert.deepEqual(licenseLines(order({payment_status:'pending'}),[plan],'3202741'),[]);
  for(const changes of [{sku:'STRONG'},{quantity:2},{custom_fields:[]},{custom_fields:[{name:'note',value:'BLOFY-AB12-CD34'}]},
    {custom_fields:[{name:ZID_DEVICE_FIELD,value:'BLOFY-AB12-CD34'},{name:ZID_DEVICE_FIELD,value:'BLOFY-OTHER-1234'}]},
    {total:0},{order_product_id:'../../admin'}]) {
    assert.throws(()=>licenseLines(order({products:[{...order().products[0],...changes}]}),[plan],'3202741'));
  }
});
test('Currency, fraud, cancellation and free orders fail closed',()=>{
  for(const changes of [{currency_code:'USD'},{is_potential_fraud:true},{order_status:{code:'cancelled'}},{order_total:0}])
    assert.throws(()=>licenseLines(order(changes),[plan],'3202741'));
  for(const amount of ['','-1','NaN','Infinity','1e2']) assert.throws(()=>moneyMinor(amount));
  assert.equal(moneyMinor('10.000000'),1000);
});
test('Renewal preserves remaining paid/trial time and lifetime licenses',()=>{
  const now=new Date('2026-10-06T00:00:00Z'), future=new Date('2026-11-01T00:00:00Z');
  const expiry=renewedExpiry({status:'active',expires_at:future},90,now);
  assert.equal(expiry.startsAt.getTime(),future.getTime());
  assert.equal(expiry.expiresAt.getTime(),future.getTime()+90*86400000);
  assert.equal(renewedExpiry({status:'active',expires_at:null},90,now).expiresAt,null);
  assert.equal(renewedExpiry({status:'expired',expires_at:future},90,now).startsAt.getTime(),now.getTime());
  assert.throws(()=>renewedExpiry({status:'blocked'},90,now));
  assert.throws(()=>renewedExpiry({status:'expired',data_deleted_at:now},90,now));
});
test('Webhook extracts only an order ID, ignoring claimed payment and duration',()=>{
  assert.equal(orderIdFromZidPayload({data:{id:123},days:9999,paid:true}),'123');
  assert.equal(orderIdFromZidPayload({order:{id:123}}),'123');
  assert.equal(orderIdFromZidPayload({id:'../../secret'}),null);
});
test('Unconfigured and unsigned webhooks never touch database or Zid API',async()=>{
  const forbidden=()=>{throw new Error('unexpected upstream access')};
  let result;
  const deps={pool:{connect:forbidden},json:(_res,status,body)=>result={status,body},readJson:forbidden,authorize:forbidden,fetchImpl:forbidden};
  let handler=createZidPaymentHandlers({...deps,env:{}});
  await handler({method:'POST',headers:{}},{},new URL('https://local/api/v1/payments/zid/webhook'));
  assert.equal(result.status,503);
  assert.equal(await handler({method:'GET'}, {}, new URL('https://local/api/v1/subscriptions/plans')),false);
  handler=createZidPaymentHandlers({...deps,env:{BLOFY_ZID_ENABLED:'true',BLOFY_ZID_STORE_ID:'3202741',
    BLOFY_ZID_WEBHOOK_SECRET:'x'.repeat(32),BLOFY_ZID_AUTHORIZATION:'test-app',BLOFY_ZID_MANAGER_TOKEN:'test-manager',BLOFY_ZID_PLANS_JSON:JSON.stringify([plan])}});
  await handler({method:'POST',headers:{authorization:'Basic forged'}},{},new URL('https://local/api/v1/payments/zid/webhook'));
  assert.equal(result.status,401);
  assert.equal(handler.purchasesAvailable,false,'Product URLs must be verified before checkout is enabled');
});

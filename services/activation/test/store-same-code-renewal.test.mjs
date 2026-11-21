import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStoreGeideaHandlers} from '../src/store-geidea-checkout.mjs';
import {encryptStreamCode,decryptStreamCode} from '../src/xtream-code-vault.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';
import {renewalStartAndExpiry,renewalPlanFor} from '../src/store-same-code-renewal.mjs';

const keyHex='a'.repeat(64);
const customerId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const voucherId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const publicKey='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const providerId='ffffffff-ffff-4fff-8fff-ffffffffffff';
const sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const codePlain='12345678';
const originHeaders={'origin':'https://blofyplayer.com','sec-fetch-site':'same-origin',
 'content-type':'application/json',cookie:'verified-customer'};
const rows=(xs=[])=>({rows:xs,rowCount:xs.length});

test('owner-based renewal policy preserves existing clock and requires activated account',()=>{
 const now=Date.parse('2026-11-18T00:00:00Z');
 const row={redeemed_at:new Date(now-200000),expires_at:new Date(now+20*86400000),
  account_expires_at:new Date(now+25*86400000),account_enabled:true,account_id:accountId,
  code_channel:'app',code_vault:'stored'};
 const a=renewalStartAndExpiry(row,90,now);
 assert.equal(new Date(a.startsAt).getTime(),now+25*86400000);
 assert.equal(new Date(a.expiresAt).getTime(),now+115*86400000);
 assert.equal(renewalStartAndExpiry({...row,redeemed_at:null},90,now),null);
 assert.equal(renewalStartAndExpiry({...row,revoked_at:new Date()},90,now),null);
 assert.equal(renewalStartAndExpiry({...row,account_enabled:false},90,now),null);
 assert.equal(renewalStartAndExpiry({...row,code_vault:null},90,now),null);
 assert.equal(renewalStartAndExpiry({...row,expires_at:new Date(now-5000),
  account_expires_at:new Date(now-5000)},365,now).expiresAt,
  new Date(now+365*86400000).toISOString());
 const plans=[{sku:'stream-6m',channel:'app',durationDays:180,
  priceMinor:7000,currency:'SAR'}];
 assert.equal(renewalPlanFor('xtream-6m','app',plans),null);
 assert.equal(renewalPlanFor('stream-6m','app',plans).priceMinor,7000);
});

test('one verified Geidea payment extends the same code once, never issues a new code',async()=>{
 const storeOrderId='11111111-1111-4111-8111-111111111111';
 const codeExpiry='2026-12-31T00:00:00.000Z';
 const ownedOrders=new Map([[storeOrderId,customerId]]);
 const voucher={id:voucherId,code_channel:'app',code_hint:'12••••78',
  code_hash:streamCodeProof(codePlain,keyHex),
  code_vault:encryptStreamCode(voucherId,codePlain,keyHex),
  redeemed_at:new Date('2026-10-01T00:00:00Z'),expires_at:new Date(codeExpiry),
  account_id:accountId,revoked_at:null,extended_days:0};
 const account={id:accountId,enabled:true,expires_at:new Date(codeExpiry)};
 const orders=new Map(),renewalOrders=new Map(),linked=new Map(),events=[];
 let providerCalls=0,settledCalls=0,extensions=0,rollback=0;
 const db={async query(input,args=[]){
  const sql=String(input).trim();
  if(sql==='BEGIN'||sql==='COMMIT'||sql.startsWith('CREATE ')||
     sql.startsWith('ALTER ')||sql.startsWith('SELECT pg_advisory'))return rows();
  if(sql==='ROLLBACK'){rollback++;return rows();}
  if(sql.startsWith('SELECT id FROM blofy_xtream_gateway_duration_codes WHERE id=$1 FOR UPDATE'))
   return rows(args[0]===voucherId?[{id:voucherId}]:[]);
  if(sql.startsWith('SELECT v.id AS voucher_id')){
   if(args[0]!==customerId||args[1]!==voucherId)return rows();
   return rows([{voucher_id:voucherId,...voucher,account_enabled:account.enabled,
    account_expires_at:account.expires_at}]);
  }
  if(sql.startsWith('SELECT o.id,o.public_order_number,o.session_id,o.session_expires_at')){
   const [customer,voucherSearch]=args;
   return rows([...renewalOrders].filter(([id,item])=>linked.get(id)===customer&&
      item.voucher_id===voucherSearch&&orders.get(id)?.status==='pending')
     .map(([id])=>orders.get(id)).slice(-1));
  }
  if(sql.startsWith('INSERT INTO blofy_store_geidea_orders')){
   const [id,sku,channel,days,amount,hash,publicNumber]=args;
   orders.set(id,{id,sku,channel,duration_days:days,amount_minor:amount,
    access_hash:hash,public_order_number:publicNumber,
    coupon_discount_minor:0,coupon_code:null,currency:'SAR',
    status:'pending',provider_reference:null,session_id:null,
    created_at:new Date(),paid_at:null});
   return rows([{id}]);
  }
  if(sql.startsWith('INSERT INTO blofy_store_customer_orders')){
   linked.set(args[0],args[1]);return rows([{order_id:args[0]}]);
  }
  if(sql.startsWith('INSERT INTO blofy_store_renewal_orders')){
   renewalOrders.set(args[0],{voucher_id:args[1],plan_sku:args[2]});return rows();
  }
  if(sql.startsWith('UPDATE blofy_store_geidea_orders SET session_id=')){
   const o=orders.get(args[0]);o.session_id=args[1];o.session_expires_at=args[2];
   return rows([{id:o.id}]);
  }
  if(sql.startsWith('SELECT * FROM blofy_store_geidea_orders WHERE id=$1'))
   return rows(orders.has(args[0])?[{...orders.get(args[0])}]:[]);
  if(sql.startsWith('SELECT voucher_id,plan_sku FROM blofy_store_renewal_orders'))
   return rows(renewalOrders.has(args[0])?[renewalOrders.get(args[0])]:[]);
  if(sql.startsWith('SELECT id AS voucher_id,code_channel,code_hash,code_vault')){
   return rows(args[0]===voucherId?[{voucher_id:voucherId,...voucher}]:[]);
  }
  if(sql.startsWith('SELECT id,enabled AS account_enabled,expires_at AS account_expires_at'))
   return rows(args[0]===accountId?[{id:accountId,
     account_enabled:account.enabled,account_expires_at:account.expires_at}]:[]);
  if(sql.startsWith('UPDATE blofy_xtream_gateway_accounts SET expires_at=')){
   account.expires_at=args[1];return rows([{id:accountId}]);
  }
  if(sql.startsWith('UPDATE blofy_xtream_gateway_duration_codes SET expires_at=')){
   voucher.expires_at=args[1];voucher.extended_days+=args[2];extensions++;
   return rows([{id:voucherId}]);
  }
  if(sql.startsWith('INSERT INTO blofy_xtream_gateway_code_events')){
   events.push(args);return rows();
  }
  if(sql.startsWith("UPDATE blofy_store_geidea_orders SET status='paid'")){
   const o=orders.get(args[0]);o.status='paid';o.provider_reference=args[1];o.paid_at=new Date();
   return rows([{id:o.id}]);
  }
  throw Error('Unexpected renewal SQL: '+sql.slice(0,200));
 },release(){}};
 const pool={connect:async()=>db,query:(...args)=>db.query(...args)};
 let merchantReference=null;
 const provider=async(url,opts)=>{
  if(url.includes('/payment-intent/api/v2/direct/session')){
   const body=JSON.parse(opts.body);
   assert.equal(body.amount,'70.00');
   assert.equal(body.currency,'SAR');
   assert.equal(body.paymentOperation,'Pay');
   merchantReference=body.merchantReferenceId;providerCalls++;
   return {ok:true,json:async()=>({responseCode:'000',detailedResponseCode:'000',
    session:{id:sessionId,expiryDate:new Date(Date.now()+600000).toISOString()}})};
  }
  if(url.includes('/pgw/api/v1/direct/order')){
   settledCalls++;
   return {ok:true,json:async()=>({responseCode:'000',detailedResponseCode:'000',
    order:{orderId:providerId,merchantReferenceId:merchantReference,merchantPublicKey:publicKey,
     isTest:false,status:'Success',detailedStatus:'Paid',amount:'70.00',currency:'SAR',
     totalAmount:'70.00',totalCapturedAmount:'70.00',totalRefundedAmount:'0.00',
     paymentOperation:'Pay',transactions:[{type:'Pay',status:'Success',currency:'SAR',
      amount:'70.00',paymentMethod:{type:'Card',brand:'visa'},
      codes:{responseCode:'000',detailedResponseCode:'000'}}]}})};
  }
  throw Error('Unexpected provider URL: '+url);
 };
 const env={BLOFY_PAYMENT_PROVIDER:'geidea',BLOFY_GEIDEA_CHECKOUT_ENABLED:'true',
  BLOFY_STORE_GEIDEA_ENABLED:'true',BLOFY_STORE_REQUIRE_CUSTOMER_LOGIN:'true',
  BLOFY_STORE_SAME_CODE_RENEWAL_ENABLED:'true',
  GEIDEA_LIVE_MERCHANT_PUBLIC_KEY:publicKey,
  GEIDEA_LIVE_API_PASSWORD:'test-renewal-merchant-secret-12345678'};
 const handler=createStoreGeideaHandlers({
  pool,keyHex,env,fetchImpl:provider,
  json:(res,status,data)=>{res.status=status;res.data=data;},
  readJson:async req=>req.body,
  requireCheckoutCustomer:async req=>req.headers.cookie==='verified-customer'?
   {ok:true,customerId}:{ok:false,status:401,error:'customer_login_required'}
 });
 const request=(body,authenticated=true)=>({method:'POST',body,
  headers:authenticated?originHeaders:{...originHeaders,cookie:''},
  socket:{remoteAddress:'127.0.0.1'}});
 async function call(route,body,auth=true){
  const res={};
  await handler(request(body,auth),res,{pathname:route});
  return res;
 }
 const payPath='/api/v1/store/renewals/checkout',pendingPath='/api/v1/store/renewals/pending';
 const denied=await call(payPath,{voucherId,planSku:'stream-6m'},false);
 assert.equal(denied.status,401,'login is enforced at server');
 const wrong=await call(payPath,{voucherId,planSku:'xtream-6m'});
 assert.equal(wrong.status,400,'cannot renew app code at xtream price');
 const start=await call(payPath,{voucherId,planSku:'stream-6m'});
 assert.equal(start.status,201);
 assert.equal(start.data.sku,'renewal');
 assert.equal(start.data.priceMinor,7000);
 assert.equal(start.data.sessionId,sessionId);
 assert.equal(start.data.voucherId,voucherId);
 assert.equal(providerCalls,1);
 assert.equal(voucher.expires_at.toISOString(),codeExpiry,'creating session never adds time');
 const repeated=await call(payPath,{voucherId,planSku:'stream-6m'});
 assert.equal(repeated.status,409,'same voucher has only one pending renewal');
 assert.equal(repeated.data.error,'store_renewal_pending');
 assert.equal(providerCalls,1);
 const waiting=await call(pendingPath,{voucherId});
 assert.equal(waiting.status,200);assert.equal(waiting.data.pending,true);
 assert.equal(waiting.data.sessionId,sessionId);
 assert.equal(Object.hasOwn(waiting.data,'accessToken'),false);
 const secret=env.GEIDEA_LIVE_API_PASSWORD,stamp=new Date().toISOString();
 const sig=crypto.createHmac('sha256',secret)
  .update(publicKey+'70.00'+'SAR'+providerId+'Success'+start.data.orderId+stamp)
  .digest('base64');
 const cb={timeStamp:stamp,signature:sig,order:{
  orderId:providerId,merchantReferenceId:start.data.orderId,
  merchantPublicKey:publicKey,amount:'70.00',currency:'SAR',
  status:'Success',isTest:false}};
 const first=await call('/api/v1/store/geidea/webhook',cb,false);
 assert.equal(first.status,200);
 assert.equal(voucher.extended_days,180);
 assert.equal(voucher.account_id,accountId);
 assert.equal(voucher.code_hash,streamCodeProof(codePlain,keyHex));
 assert.equal(decryptStreamCode(voucherId,voucher.code_vault,keyHex),codePlain);
 assert.equal(account.expires_at.toISOString(),voucher.expires_at.toISOString());
 assert.equal(voucher.expires_at.toISOString(),
  new Date(Date.parse(codeExpiry)+180*86400000).toISOString());
 assert.equal(extensions,1);
 assert.equal(events.length,1);
 const again=await call('/api/v1/store/geidea/webhook',cb,false);
 assert.equal(again.status,200,'callback replay returns success without new extension');
 assert.equal(extensions,1);
 assert.equal(voucher.extended_days,180);
 assert.equal(events.length,1);
 const after=await call(pendingPath,{voucherId});
 assert.equal(after.data.pending,false);
 assert.equal(settledCalls,1);
});

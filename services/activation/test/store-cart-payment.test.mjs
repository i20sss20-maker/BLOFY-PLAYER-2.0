import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStoreGeideaHandlers} from '../src/store-geidea-checkout.mjs';

test('Three cart codes require one paid Geidea capture and never duplicate on callback replay',async()=>{
 const publicKey='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const pwd='test-store-payment-secret-12345678';
 const providerId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const sourceId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const orders=new Map(),codes=new Map(),delivered=[];
 let captureCalls=0,paid=0,rolledBack=0,paymentSessions=0,allowLink=true;
 const linked=[];
 const rows=(items=[])=>({rows:items,rowCount:items.length});
 const db={async query(input,args=[]){
   const sql=String(input).trim();
   if(sql==='BEGIN'||sql==='COMMIT'||sql.startsWith('CREATE ')||
      sql.startsWith('ALTER ')||sql.startsWith('SELECT pg_advisory'))return rows();
   if(sql==='ROLLBACK'){rolledBack++;return rows();}
   if(sql.startsWith("SELECT to_regclass('public.blofy_xtream_servers')"))
     return rows([{n:'blofy_xtream_servers'}]);
   if(sql.startsWith('SELECT id FROM blofy_xtream_servers'))
     return rows([{id:sourceId}]);
   if(sql.startsWith('SELECT o.id,o.public_order_number,o.session_id,o.session_expires_at')){
     const [customerId,sku,cartJson,coupon]=args;
     const result=linked.filter(x=>x.customerId===customerId).map(x=>orders.get(x.id))
       .filter(o=>o&&o.sku===sku&&o.status==='pending'&&
         JSON.stringify(o.cart_items)===cartJson&&(o.coupon_code||'')===(coupon||''))
       .map(o=>({id:o.id,public_order_number:o.public_order_number,
         session_id:o.session_id,session_expires_at:o.session_expires_at,created_at:o.created_at}));
     return rows(result.slice(-1));
   }
   if(sql.startsWith('SELECT o.id FROM blofy_store_customer_orders co')){
     const [customerId,sku,cartJSON,coupon]=args;
     return rows([...linked].map(item=>orders.get(item.id)).filter(o=>
       o && o.sku===sku && o.status==='pending' &&
       JSON.stringify(o.cart_items)===cartJSON &&
       (o.coupon_code||'')===(coupon||'') &&
       Date.now()-Date.parse(o.created_at)<20*60000).map(o=>({id:o.id})));
   }
   if(sql.startsWith('INSERT INTO blofy_store_customer_orders')){
     if(!allowLink)return rows();
     linked.push({id:args[0],customerId:args[1]});
     return rows([{order_id:args[0]}]);
   }
   if(sql.startsWith('INSERT INTO blofy_store_geidea_orders')){
     const [id,sku,channel,days,minor,access_hash,cartJson,gross,number,coupon,discount]=args;
     orders.set(id,{id,sku,channel,duration_days:days,amount_minor:minor,access_hash,
       cart_items:JSON.parse(cartJson),cart_gross_minor:gross,public_order_number:number,
       coupon_code:coupon,coupon_discount_minor:discount,currency:'SAR',status:'pending',
       session_id:null,provider_reference:null,created_at:new Date().toISOString(),
       last_checked_at:null});
     return rows();
   }
   if(sql.startsWith("UPDATE blofy_store_geidea_orders SET status='cancelled'")){
     const row=orders.get(args[0]);if(row)row.status='cancelled';return rows([row].filter(Boolean));
   }
   if(sql.startsWith('UPDATE blofy_store_geidea_orders SET apple_pay_test=TRUE')){
     orders.get(args[0]).apple_pay_test=true;return rows();
   }
   if(sql.startsWith('UPDATE blofy_store_geidea_orders SET session_id=')){
     orders.get(args[0]).session_id=args[1];
     orders.get(args[0]).session_expires_at=args[2];return rows();
   }
   if(sql.startsWith('SELECT * FROM blofy_store_geidea_orders WHERE id=$1'))
     return rows(orders.has(args[0])?[{...orders.get(args[0])}]:[]);
   if(sql.startsWith('SELECT i.voucher_id FROM blofy_store_inventory'))return rows();
   if(sql.includes('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes'))
     return rows([{n:codes.size}]);
   if(sql.startsWith('INSERT INTO blofy_xtream_gateway_duration_codes')){
     const [id,hash,hint,label,source,durationDays,channel,vault,priceMinor]=args;
     codes.set(id,{id,code_hash:hash,code_vault:vault,revoked_at:null,source,
       duration_days:durationDays,channel,priceMinor});
     return rows([{id}]);
   }
   if(sql.startsWith('INSERT INTO blofy_store_cart_vouchers')){
     const [order_id,position,voucher_id,channel,days,sku]=args;
     delivered.push({order_id,position,voucher_id,channel,duration_days:days,sku});
     return rows();
   }
   if(sql.startsWith('SELECT c.position,c.channel,c.duration_days,c.sku,v.id')){
     return rows(delivered.filter(item=>item.order_id===args[0]).map(item=>({
       position:item.position,channel:item.channel,duration_days:item.duration_days,
       sku:item.sku,...codes.get(item.voucher_id)
     })));
   }
   if(sql.startsWith("UPDATE blofy_store_geidea_orders SET status='paid'")){
     const order=orders.get(args[0]);order.status='paid';order.provider_reference=args[1];
     order.paid_at=new Date();paid++;return rows();
   }
   throw Error('Unexpected SQL: '+sql.slice(0,220));
 },release(){}};
 const pool={query:(...args)=>db.query(...args),connect:async()=>db};
 let currentReference;
 const provider=async(url,options)=>{
   if(url.includes('/payment-intent/api/v2/direct/session')){
     paymentSessions++;
     const payload=JSON.parse(options.body);
     assert.equal(payload.amount,'270.00');
     assert.deepEqual(payload.hideWallets,[],'Apple Pay enabled: Geidea may offer its verified Apple wallet');
     assert.equal(payload.expressCheckouts.length,0,'do not add an unconfigured standalone wallet SDK');
     currentReference=payload.merchantReferenceId;
     return {ok:true,json:async()=>({
       responseCode:'000',detailedResponseCode:'000',
       session:{id:sessionId,expiryDate:new Date(Date.now()+600000).toISOString()}
     })};
   }
   if(url.includes('/pgw/api/v1/direct/order')){
     captureCalls++;
     return {ok:true,json:async()=>({responseCode:'000',detailedResponseCode:'000',order:{
       orderId:providerId,merchantReferenceId:currentReference,merchantPublicKey:publicKey,
       isTest:false,status:'Success',detailedStatus:'Paid',amount:'270.00',currency:'SAR',
       totalAmount:'270.00',totalCapturedAmount:'270.00',totalRefundedAmount:'0.00',
       paymentOperation:'Pay',paymentMethod:{type:'Wallet',brand:'visa',wallet:'ApplePay'},
       transactions:[{type:'Pay',status:'Success',currency:'SAR',
         amount:'270.00',paymentMethod:{type:'Wallet',brand:'visa',wallet:'ApplePay'},
         codes:{responseCode:'000',detailedResponseCode:'000'}}]
     }})};
   }
   throw Error('Unexpected Geidea API: '+url);
 };
 const applePayToken='Testing_Apple_Pay_Wallet_26_Nov_2026_AB';
 const env={BLOFY_PAYMENT_PROVIDER:'geidea',BLOFY_GEIDEA_CHECKOUT_ENABLED:'true',
   BLOFY_STORE_GEIDEA_ENABLED:'true',BLOFY_STORE_REQUIRE_CUSTOMER_LOGIN:'true',
   BLOFY_GEIDEA_APPLE_PAY_ENABLED:'false',
   BLOFY_GEIDEA_APPLE_PAY_PILOT_ENABLED:'true',
   BLOFY_GEIDEA_APPLE_PAY_PILOT_TOKEN_SHA256:crypto.createHash('sha256').update(applePayToken).digest('hex'),
   BLOFY_GEIDEA_APPLE_PAY_PILOT_EXPIRES_AT:new Date(Date.now()+6*86400000).toISOString(),
   GEIDEA_LIVE_MERCHANT_PUBLIC_KEY:publicKey,
   GEIDEA_LIVE_API_PASSWORD:pwd};
 const handler=createStoreGeideaHandlers({
   pool,keyHex:'a'.repeat(64),env,fetchImpl:provider,
   onCheckoutOrder:async()=>{throw Error('cart must link atomically rather than via callback');},
   requireCheckoutCustomer:async(req)=>req.headers?.cookie==='verified-customer'
     ?{ok:true,customerId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}:{ok:false,status:401,error:'customer_login_required'},
   json:(res,status,data)=>{res.status=status;res.data=data;},
   readJson:async(req)=>req.body
 });
 const request=(body,origin=true,authenticated=false)=>({
   method:'POST',headers:origin?{'content-type':'application/json',
     origin:'https://blofyplayer.com','sec-fetch-site':'same-origin',
     ...(authenticated?{cookie:'verified-customer'}:{})}:{},

   socket:{remoteAddress:'127.0.0.1'},body
 });
 const items=[{sku:'stream-6m',quantity:1},
   {sku:'bundle-2y',quantity:1,bundleSelection:['app','xtream']}];
 const regularOptions={};
 await handler({method:'GET',headers:{}},regularOptions,{pathname:'/api/v1/store/products'});
 assert.equal(regularOptions.status,200);
 assert.deepEqual(regularOptions.data.paymentMethods,{cards:true,applePay:false,applePayTestMode:false},
  'regular shoppers must never see pilot wallet');
 const paymentOptions={};
 await handler({method:'GET',headers:{'x-blofy-apple-pay-pilot':applePayToken}},
   paymentOptions,{pathname:'/api/v1/store/products'});
 assert.equal(paymentOptions.status,200);
 assert.deepEqual(paymentOptions.data.paymentMethods,{cards:true,applePay:true,applePayTestMode:true});
 const quote={};
 await handler(request({items}),quote,{pathname:'/api/v1/store/cart/quote'});
 assert.equal(quote.status,200);
 assert.equal(quote.data.totalMinor,27000);
 assert.equal(quote.data.codeCount,3);
 const guestCheckout={};
 await handler(request({items}),guestCheckout,{pathname:'/api/v1/store/cart/checkout'});
 assert.equal(guestCheckout.status,401,'server forbids unauthenticated checkout');
 const guestDirect={};
 await handler(request({sku:'stream-3m'}),guestDirect,{pathname:'/api/v1/store/checkout'});
 assert.equal(guestDirect.status,401,'old direct-buy endpoint cannot bypass account requirement');
 assert.equal(paymentSessions,0);
 allowLink=false;
 const linkFailure={};
 await handler(request({items},true,true),linkFailure,{pathname:'/api/v1/store/cart/checkout'});
 assert.equal(linkFailure.status,503,'cannot pay if order cannot be attached to the account');
 assert.equal(paymentSessions,0,'never open payment session before secure order association');
 allowLink=true;
 const checkout={};
 await handler(request({items,applePayTestToken:applePayToken},true,true),checkout,
   {pathname:'/api/v1/store/cart/checkout'});
 assert.equal(checkout.status,201);
 assert.equal(checkout.data.priceMinor,27000);
 assert.equal(paymentSessions,1);
 assert.equal(orders.get(checkout.data.orderId).apple_pay_test,true,
  'only the authorized pilot order permits a verified Apple Pay capture');
 assert.equal(linked.length,1);
 assert.equal(linked[0].id,checkout.data.orderId);
 assert.equal(linked[0].customerId,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
 const duplicate={};
 await handler(request({items},true,true),duplicate,{pathname:'/api/v1/store/cart/checkout'});
 assert.equal(duplicate.status,409,'same customer cannot create second pending Geidea session');
 assert.equal(duplicate.data.error,'store_pending_checkout_exists');
 assert.equal(paymentSessions,1,'duplicate checkout did not contact provider');
 assert.match(checkout.data.orderNumber,/^BF-\d{6}-[0-9A-F]{8}$/);
 assert.equal(delivered.length,0,'never issue codes before verified capture');
 const owned={};
 await handler(request({items},true,true),owned,{pathname:'/api/v1/store/cart/pending'});
 assert.equal(owned.status,200);
 assert.equal(owned.data.pending,true);
 assert.equal(owned.data.orderId,checkout.data.orderId);
 assert.equal(owned.data.sessionId,sessionId);
 assert.equal(typeof owned.data.sessionExpiresAt,'string');
 assert.equal(Object.hasOwn(owned.data,'accessToken'),false,
   'cross-device recovery never exposes the private receipt token');
 const notOwner={};
 await handler(request({items}),notOwner,{pathname:'/api/v1/store/cart/pending'});
 assert.equal(notOwner.status,401,'anonymous users cannot retrieve payment sessions');
 const invalid={};
 await handler(request({orderId:checkout.data.orderId,accessToken:'z'.repeat(43)}),
   invalid,{pathname:'/api/v1/store/orders/status'});
 assert.equal(invalid.status,404,'another browser cannot retrieve the codes');
 const stamp=new Date().toISOString();
 const sig=crypto.createHmac('sha256',pwd)
   .update(publicKey+'270.00'+'SAR'+providerId+'Success'+checkout.data.orderId+stamp)
   .digest('base64');
 const callback={timeStamp:stamp,signature:sig,order:{
   orderId:providerId,merchantReferenceId:checkout.data.orderId,merchantPublicKey:publicKey,
   amount:'270.00',currency:'SAR',isTest:false,status:'Success'
 }};
 const confirmation={};
 await handler(request(callback,false),confirmation,{pathname:'/api/v1/store/geidea/webhook'});
 assert.equal(confirmation.status,200);
 assert.equal(delivered.length,3);
 assert.equal(paid,1);
 const repeated={};
 await handler(request(callback,false),repeated,{pathname:'/api/v1/store/geidea/webhook'});
 assert.equal(repeated.status,200);
 assert.equal(delivered.length,3);
 assert.equal(paid,1);
 const settledPending={};
 await handler(request({items},true,true),settledPending,{pathname:'/api/v1/store/cart/pending'});
 assert.equal(settledPending.data.pending,false,'paid orders cannot reopen a Geidea session');
 const receipt={};
 await handler(request({orderId:checkout.data.orderId,accessToken:checkout.data.accessToken}),
   receipt,{pathname:'/api/v1/store/orders/status'});
 assert.equal(receipt.status,200);
 assert.equal(receipt.data.fulfilled,true);
 assert.equal(receipt.data.amountMinor,27000);
 assert.equal(receipt.data.codes.length,3);
 assert.deepEqual(receipt.data.codes.map(x=>x.channel),['app','app','xtream']);
 assert.deepEqual(receipt.data.codes.map(x=>x.durationDays),[180,365,365]);
 assert.equal(new Set(receipt.data.codes.map(x=>x.code)).size,3);
 assert.equal(rolledBack,2,'failed ownership and duplicate attempts roll back safely');
 assert.equal(captureCalls,1);
});

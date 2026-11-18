import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStoreGeideaHandlers} from '../src/store-geidea-checkout.mjs';

test('Geidea annual bundle: one capture issues exactly two separate codes, replay is idempotent',async()=>{
 const pk='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const pwd='test-store-payment-secret-12345678';
 const providerId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const sourceId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const vault=new Map(),orderItems=[],orders=new Map();
 let webCalls=0,paidTransactions=0,commits=0;
 const select=(rows=[])=>({rows,rowCount:rows.length});
 const db={
   async query(query,args=[]){
     const sql=String(query).trim();
     if(sql==='COMMIT'){commits++;return select();}
     if(sql==='ROLLBACK'||sql==='BEGIN'||sql.startsWith('CREATE ')||sql.startsWith('ALTER TABLE')||
       sql.startsWith('SELECT pg_advisory'))return select();
     if(sql.startsWith("SELECT to_regclass('public.blofy_xtream_servers')"))return select([{n:'blofy_xtream_servers'}]);
     if(sql.startsWith('SELECT id FROM blofy_xtream_servers'))return select([{id:sourceId}]);
     if(sql.startsWith('INSERT INTO blofy_store_geidea_orders')){
       const [id,sku,channel,days,minor,access_hash,bundleJson,coupon_code,coupon_discount_minor]=args;
       orders.set(id,{id,sku,channel,duration_days:days,amount_minor:minor,currency:'SAR',
         access_hash,bundle_selection:bundleJson?JSON.parse(bundleJson):null,coupon_code,
         coupon_discount_minor,status:'pending',session_id:null,voucher_id:null,
         provider_reference:null,created_at:new Date().toISOString(),last_checked_at:null});
       return select();
     }
     if(sql.startsWith('UPDATE blofy_store_geidea_orders SET session_id=')){
       orders.get(args[0]).session_id=args[1];return select();
     }
     if(sql.startsWith('UPDATE blofy_store_geidea_orders SET status=')){
       if(sql.includes("status='paid'")){const row=orders.get(args[0]);row.status='paid';row.provider_reference=args[1];row.paid_at=new Date();paidTransactions++;return select();}
       orders.get(args[0]).status=args[1];return select();
     }
     if(sql.startsWith('SELECT * FROM blofy_store_geidea_orders WHERE id=$1'))return select(orders.has(args[0])?[{...orders.get(args[0])}]:[]);
     if(sql.startsWith('SELECT i.voucher_id FROM blofy_store_inventory'))return select([]);
     if(sql.includes('SELECT COUNT(*)::int AS n FROM blofy_xtream_gateway_duration_codes'))return select([{n:vault.size}]);
     if(sql.startsWith('INSERT INTO blofy_xtream_gateway_duration_codes')){
       const [id,code_hash,code_hint,label,source_id,channel,code_vault,priceMinor]=args;
       vault.set(id,{id,code_hash,code_vault,revoked_at:null,channel,priceMinor,source_id});
       return select([{id}]);
     }
     if(sql.startsWith('INSERT INTO blofy_store_order_vouchers')){
       const [order_id,position,voucher_id,channel]=args;
       if(orderItems.some(x=>x.order_id===order_id&&x.position===position))throw Error('duplicate voucher position');
       orderItems.push({order_id,position,voucher_id,channel});
       return select();
     }
     if(sql.startsWith('SELECT ov.position,ov.channel,v.id')){
       return select(orderItems.filter(x=>x.order_id===args[0])
         .sort((a,b)=>a.position-b.position).map(x=>({position:x.position,channel:x.channel,...vault.get(x.voucher_id)})));
     }
     throw Error('Unexpected SQL: '+sql.slice(0,230));
   },release(){}
 };
 const pool={query:(...args)=>db.query(...args),connect:async()=>db};
 let createdReference=null;
 const provider=async(url,options)=>{
   webCalls++;
   if(url.includes('payment-intent/api/v2/direct/session')){
     const parsed=JSON.parse(options.body);
     createdReference=parsed.merchantReferenceId;
     assert.equal(parsed.amount,'200.00');
     return {ok:true,json:async()=>({
       responseCode:'000',detailedResponseCode:'000',session:{id:sessionId,expiryDate:new Date(Date.now()+600000).toISOString()}
     })};
   }
   if(url.includes('/pgw/api/v1/direct/order')){
     const order=orders.get(createdReference);
     const data={
       orderId:providerId,merchantReferenceId:createdReference,merchantPublicKey:pk,
       isTest:false,status:'Success',detailedStatus:'Paid',amount:'200.00',currency:'SAR',
       totalAmount:'200.00',totalCapturedAmount:'200.00',totalRefundedAmount:'0.00',
       paymentOperation:'Pay',transactions:[{type:'Pay',status:'Success',currency:'SAR',
         amount:'200.00',paymentMethod:{type:'Card',brand:'visa'},
         codes:{responseCode:'000',detailedResponseCode:'000'}}]
     };
     assert.equal(order.amount_minor,20000);
     return {ok:true,json:async()=>({responseCode:'000',detailedResponseCode:'000',order:data})};
   }
   throw Error('Unexpected provider endpoint: '+url);
 };
 const env={BLOFY_PAYMENT_PROVIDER:'geidea',BLOFY_GEIDEA_CHECKOUT_ENABLED:'true',
   BLOFY_STORE_GEIDEA_ENABLED:'true',GEIDEA_LIVE_MERCHANT_PUBLIC_KEY:pk,
   GEIDEA_LIVE_API_PASSWORD:pwd};
 const handler=createStoreGeideaHandlers({
   pool,keyHex:'a'.repeat(64),env,fetchImpl:provider,
   json:(res,status,data)=>{res.status=status;res.data=data;},
   readJson:async(req)=>req.mockBody
 });
 const request=(path,body,origin=true)=>({
   method:'POST',headers:origin?{origin:'https://blofyplayer.com','sec-fetch-site':'same-origin'}:{},
   socket:{remoteAddress:'127.0.0.1'},mockBody:body
 });
 const checkout={};
 const req=request('/api/v1/store/checkout',{sku:'bundle-2y',bundleSelection:['app','xtream']});
 assert.equal(await handler(req,checkout,{pathname:'/api/v1/store/checkout'}),true);
 assert.equal(checkout.status,201);
 assert.equal(checkout.data.priceMinor,20000);
 assert.equal(orderItems.length,0,'no vouchers issued before confirmed payment');
 assert.equal(orders.get(checkout.data.orderId).status,'pending');
 const stamp=new Date().toISOString();
 const signed=pk+'200.00'+'SAR'+providerId+'Success'+checkout.data.orderId+stamp;
 const signature=crypto.createHmac('sha256',pwd).update(signed).digest('base64');
 const callback={timeStamp:stamp,signature,order:{
   orderId:providerId,merchantReferenceId:checkout.data.orderId,merchantPublicKey:pk,
   amount:'200.00',currency:'SAR',isTest:false,status:'Success'
 }};
 const first={};
 assert.equal(await handler(request('',callback,false),first,{pathname:'/api/v1/store/geidea/webhook'}),true);
 assert.equal(first.status,200);
 assert.equal(orderItems.length,2);
 assert.equal(paidTransactions,1);
 const replay={};
 await handler(request('',callback,false),replay,{pathname:'/api/v1/store/geidea/webhook'});
 assert.equal(replay.status,200);
 assert.equal(orderItems.length,2,'replayed callback must not create extra codes');
 assert.equal(paidTransactions,1);
 const receipt={};
 await handler(request('',{orderId:checkout.data.orderId,accessToken:checkout.data.accessToken}),receipt,
   {pathname:'/api/v1/store/orders/status'});
 assert.equal(receipt.status,200);
 assert.equal(receipt.data.status,'paid');
 assert.equal(receipt.data.fulfilled,true);
 assert.deepEqual(receipt.data.codes.map(x=>x.channel),['app','xtream']);
 assert.equal(new Set(receipt.data.codes.map(x=>x.code)).size,2);
 assert.ok(commits>=3);
 assert.ok(webCalls>=2);
});

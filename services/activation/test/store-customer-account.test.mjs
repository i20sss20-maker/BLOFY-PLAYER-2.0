import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createStoreCustomerHandlers,expiryAlert,customerCookie,safeOwnedSubscriptionExpiry,normalizeCustomerPhone,normalizeCustomerName} from '../src/store-customer-account.mjs';
import {encryptStreamCode} from '../src/xtream-code-vault.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';

test('expiry warnings are computed from real redemption expiry and not purchase date',()=>{
 const base=Date.UTC(2026,10,18);
 assert.equal(expiryAlert(null,base),null);
 assert.equal(expiryAlert(new Date(base+8*86400000),base),null);
 assert.equal(expiryAlert(new Date(base+7*86400000),base),'expiring');
 assert.equal(expiryAlert(new Date(base-1000),base),'expired');
 assert.match(customerCookie('test'),/HttpOnly; Secure; SameSite=Strict/);
});

test('verified email owns linked guest order; no code before login and proof',async()=>{
 const keyHex='f'.repeat(64);
 const orderId=crypto.randomUUID(),voucherId=crypto.randomUUID();
 const secret=crypto.randomBytes(32).toString('base64url'),code='12345678';
 const order={id:orderId,sku:'stream-3m',status:'paid',channel:'app',duration_days:90,
   amount_minor:4000,currency:'SAR',created_at:new Date().toISOString(),
   public_order_number:'BF-261118-12345678',voucher_id:voucherId,paid_at:new Date().toISOString(),
   access_hash:crypto.createHash('sha256').update(secret).digest('hex')};
 const voucher={id:voucherId,code_channel:'app',duration_days:90,
   code_hash:streamCodeProof(code,keyHex),code_vault:encryptStreamCode(voucherId,code,keyHex),
   revoked_at:null,redeemed_at:null,expires_at:null};
 const challenges=new Map(),customers=new Map(),sessions=new Map(),claims=new Map(),carts=new Map();
 const rows=(arr=[])=>({rows:arr,rowCount:arr.length});
 const db={async query(sql,args=[]){
  sql=String(sql).trim();
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('CREATE ')||
      sql.startsWith('SELECT pg_advisory')||sql.startsWith('ALTER TABLE'))return rows();
  if(sql.startsWith('INSERT INTO blofy_store_customer_challenges')){
   const old=challenges.get(args[0]);
   if(old&&Date.now()-old.issued_at<60000)return rows();
   challenges.set(args[0],{email:args[0],code_hash:args[1],attempts:0,
     issued_at:Date.now(),expires_at:new Date(Date.now()+600000)});
   return rows([{email:args[0]}]);
  }
  if(sql.startsWith('SELECT * FROM blofy_store_customer_challenges'))
   return rows(challenges.has(args[0])?[challenges.get(args[0])]:[]);
  if(sql.startsWith('UPDATE blofy_store_customer_challenges SET attempts')){
   challenges.get(args[0]).attempts++;return rows();
  }
  if(sql.startsWith('DELETE FROM blofy_store_customer_challenges')){
   challenges.delete(args[0]);return rows();
  }
  if(sql.startsWith('INSERT INTO blofy_store_customers')){
   let c=customers.get(args[1]);
   if(!c){c={id:args[0],email:args[1],alerts_opt_in:false};customers.set(args[1],c);}
   return rows([{id:c.id}]);
  }
  if(sql.startsWith('INSERT INTO blofy_store_customer_sessions')){
   sessions.set(args[0],{customer_id:args[1]});return rows();
  }
  if(sql.startsWith('SELECT items,coupon_code,revision,updated_at FROM blofy_store_customer_carts')){
   const row=carts.get(args[0]);return rows(row?[row]:[]);
  }
  if(sql.startsWith('INSERT INTO blofy_store_customer_carts')){
   const [id,serialized,coupon,revision]=args,existing=carts.get(id);
   if(existing&&existing.revision!==revision)return rows();
   const saved={items:JSON.parse(serialized),coupon_code:coupon,revision:(existing?.revision||0)+1,
     updated_at:new Date().toISOString()};
   carts.set(id,saved);return rows([saved]);
  }
  if(sql.startsWith('SELECT c.id,c.email,c.alerts_opt_in')){
   const session=sessions.get(args[0]);
   return rows(session?[...customers.values()].filter(c=>c.id===session.customer_id):[]);
  }
  if(sql.startsWith('SELECT id,access_hash FROM blofy_store_geidea_orders')){
   return rows(args[0]===orderId?[order]:[]);
  }
  if(sql.startsWith('INSERT INTO blofy_store_customer_orders')){
   if(!claims.has(args[0]))claims.set(args[0],args[1]);return rows();
  }
  if(sql.startsWith('SELECT customer_id FROM blofy_store_customer_orders'))
   return rows(claims.has(args[0])?[{customer_id:claims.get(args[0])}]:[]);
  if(sql.startsWith('SELECT order_number,channel,expires_at FROM ('))return rows([]);
  if(sql.startsWith('SELECT o.id,o.sku,o.status,o.amount_minor'))
   return rows(claims.get(orderId)===args[0]?[order]:[]);
  if(sql.startsWith('SELECT o.id,o.status,o.session_id FROM blofy_store_customer_orders')){
   return rows(claims.get(args[1])===args[0]?[order]:[]);
  }
  if(sql.startsWith('UPDATE blofy_store_geidea_orders SET last_checked_at=NOW()')){
   if(order.id!==args[0]||order.status!=='pending')return rows();
   if(order.last_checked_at&&Date.now()-Date.parse(order.last_checked_at)<15000)return rows();
   order.last_checked_at=new Date().toISOString();
   return rows([{id:order.id}]);
  }
  if(sql.startsWith('SELECT o.status,o.paid_at FROM blofy_store_customer_orders')){
   return rows(claims.get(args[1])===args[0]?[{status:order.status,paid_at:order.paid_at}]:[]);
  }
  if(sql.startsWith('SELECT o.* FROM blofy_store_customer_orders'))
   return rows(claims.get(args[1])===args[0]?[order]:[]);
  if(sql.startsWith('SELECT v.id,v.code_channel AS channel'))
   return rows(args[0]===voucherId?[{...voucher,channel:'app'}]:[]);
  if(sql.startsWith('DELETE FROM blofy_store_customer_sessions')){
   sessions.delete(args[0]);return rows();
  }
  throw Error('Unexpected SQL '+sql.slice(0,190));
 },release(){}};
 const pool={query:(...a)=>db.query(...a),connect:async()=>db};
 let delivered=null;
 const handler=createStoreCustomerHandlers({pool,keyHex,
   env:{BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',BLOFY_STORE_REQUIRE_CUSTOMER_LOGIN:'true'},
   sendCode:async(email,otp)=>{delivered={email,otp};},
   json:(res,status,data,headers={})=>{res.status=status;res.data=data;res.headers=headers;},
   readJson:async(req)=>req.body
 });
 let reconciliationCalls=0;
 handler.setReconciler(async id=>{
   assert.equal(id,orderId);reconciliationCalls++;
   order.status='paid';order.paid_at=new Date().toISOString();return true;
 });
 const request=(method,body,extra={})=>({method,body,headers:{
   origin:'https://blofyplayer.com','sec-fetch-site':'same-origin',
   'content-type':'application/json',...extra},socket:{remoteAddress:'127.0.0.1'}});
 const call=async(path,method='GET',body={},extra={})=>{
   const response={};await handler(request(method,body,extra),response,{pathname:path});return response;
 };
 const detail='/api/v1/store/account/orders/'+orderId;
 const before=await call(detail);
 assert.equal(before.status,401);
 assert.deepEqual(await handler.checkoutIdentity(request('POST',{})),
   {ok:false,status:401,error:'customer_login_required'});
 const anonymousCart=await call('/api/v1/store/account/cart');
 assert.equal(anonymousCart.status,401);
 const requested=await call('/api/v1/store/account/request-code','POST',{email:'TEST@Example.com'});
 assert.equal(requested.status,202);
 assert.equal(delivered.email,'test@example.com');
 const bad=await call('/api/v1/store/account/verify-code','POST',{email:delivered.email,code:delivered.otp==='000000'?'999999':'000000'});
 assert.equal(bad.status,401);
 const verified=await call('/api/v1/store/account/verify-code','POST',{email:delivered.email,code:delivered.otp});
 assert.equal(verified.status,200);
 const sessionCookie=verified.headers['set-cookie'].split(';')[0];
 const auth={cookie:sessionCookie};
 assert.equal((await handler.checkoutIdentity(request('POST',{},auth))).ok,true);
 const initialCart=await call('/api/v1/store/account/cart','GET',{},auth);
 assert.equal(initialCart.status,200);
 assert.equal(initialCart.data.revision,0);
 const invalidCart=await call('/api/v1/store/account/cart','POST',
   {items:[{sku:'stream-1y',quantity:10}],revision:0},auth);
 assert.equal(invalidCart.status,400);
 const savedCart=await call('/api/v1/store/account/cart','POST',
   {items:[{sku:'stream-3m',quantity:1},{sku:'xtream-6m',quantity:2}],couponCode:'',revision:0},auth);
 assert.equal(savedCart.status,200);
 assert.equal(savedCart.data.revision,1);
 const again=await call('/api/v1/store/account/cart','GET',{},auth);
 assert.equal(again.status,200);
 assert.deepEqual(again.data.items,[{sku:'stream-3m',quantity:1},{sku:'xtream-6m',quantity:2}]);
 const stale=await call('/api/v1/store/account/cart','POST',
   {items:[],revision:0},auth);
 assert.equal(stale.status,409,'stale devices cannot erase or resurrect a newer cart');
 const cleared=await call('/api/v1/store/account/cart','POST',
   {items:[],revision:1},auth);
 assert.equal(cleared.status,200);
 assert.equal(cleared.data.revision,2);
 const unlinked=await call(detail,'GET',{},auth);
 assert.equal(unlinked.status,404);
 const unlinkedReceipt=await call(detail+'/payment-receipt','GET',{},auth);
 assert.equal(unlinkedReceipt.status,404,'customer cannot see another unlinked receipt');
 const theft=await call('/api/v1/store/account/claim','POST',{orderId,accessToken:'x'.repeat(43)},auth);
 assert.equal(theft.status,404);
 const claimed=await call('/api/v1/store/account/claim','POST',{orderId,accessToken:secret},auth);
 assert.equal(claimed.status,200);
 const account=await call('/api/v1/store/account','GET',{},auth);
 assert.equal(account.status,200);
 assert.equal(account.data.orders.length,1);
 const alerts=await call('/api/v1/store/account/alerts','GET',{},auth);
 assert.equal(alerts.status,200);
 assert.deepEqual(alerts.data.alerts,[]);
 assert.equal(Object.hasOwn(account.data.orders[0],'code'),false,'summary has no full code field');
 assert.equal(Object.hasOwn(account.data.orders[0],'codes'),false,'summary has no raw code list');
 const paymentReceipt=await call(detail+'/payment-receipt','GET',{},auth);
 assert.equal(paymentReceipt.status,200,'paid order owner may retrieve a printable receipt');
 assert.equal(paymentReceipt.data.totalMinor,4000);
 assert.equal(paymentReceipt.data.provider,'Geidea');
 assert.equal(paymentReceipt.data.isTaxInvoice,false);
 assert.equal(Object.hasOwn(paymentReceipt.data,'codes'),false);
 assert.equal(Object.hasOwn(paymentReceipt.data,'code'),false);
 // The owner, not an anonymous browser, may request a real provider
 // reconciliation without the old guest receipt token.
 order.status='pending';order.session_id=crypto.randomUUID();order.last_checked_at=null;
 const pendingPaymentReceipt=await call(detail+'/payment-receipt','GET',{},auth);
 assert.equal(pendingPaymentReceipt.status,409,'unconfirmed payments have no paid receipt');
 const checkPath=detail+'/check';
 const unauthorized=await call(checkPath,'POST',{},{
   cookie:'__Host-blofy_customer='+crypto.randomBytes(32).toString('base64url')});
 assert.equal(unauthorized.status,401,'an unrelated browser cannot poll payment');
 assert.equal(reconciliationCalls,0);
 const checked=await call(checkPath,'POST',{},auth);
 assert.equal(checked.status,200);
 assert.equal(checked.data.confirmedPaid,true);
 assert.equal(checked.data.status,'paid');
 assert.equal(reconciliationCalls,1);
 const replayCheck=await call(checkPath,'POST',{},auth);
 assert.equal(replayCheck.status,200);
 assert.equal(reconciliationCalls,1,'already paid orders do not re-query Geidea');
 const receipt=await call(detail,'GET',{},auth);
 assert.equal(receipt.status,200);
 assert.deepEqual(receipt.data.codes.map(v=>v.code),[code]);
 const otherOrigin=await call('/api/v1/store/account/claim','POST',{orderId,accessToken:secret},
   {...auth,origin:'https://evil.example'});
 assert.equal(otherOrigin.status,403);
 const logout=await call('/api/v1/store/account/logout','POST',{},auth);
 assert.equal(logout.status,200);
 const after=await call(detail,'GET',{},auth);
 assert.equal(after.status,401);
 const afterReceipt=await call(detail+'/payment-receipt','GET',{},auth);
 assert.equal(afterReceipt.status,401,'logout revokes access to purchased receipt');
 assert.equal((await handler.checkoutIdentity(request('POST',{},auth))).status,401);
});


test('customer subscriptions never show 1970 expiry for unactivated or unlinked vouchers',()=>{
 const voucher='2027-11-18T18:00:00.000Z';
 const account='2027-09-18T18:00:00.000Z';
 const linked={redeemed_at:'2026-11-18T18:00:00.000Z',expires_at:voucher,account_expires_at:account};
 assert.equal(safeOwnedSubscriptionExpiry(linked),account,'earlier verified account expiry wins');
 assert.equal(safeOwnedSubscriptionExpiry({...linked,account_expires_at:null}),voucher,
  'no linked-account expiry must not be interpreted as Unix epoch');
 assert.equal(safeOwnedSubscriptionExpiry({...linked,account_expires_at:undefined}),voucher);
 assert.equal(safeOwnedSubscriptionExpiry({...linked,redeemed_at:null}),null,
  'unactivated code cannot already be expired');
 assert.equal(safeOwnedSubscriptionExpiry({...linked,expires_at:null}),null);
 assert.equal(safeOwnedSubscriptionExpiry({...linked,expires_at:'invalid-date'}),null);
 assert.equal(safeOwnedSubscriptionExpiry({...linked,account_expires_at:'bad-date'}),voucher);
 assert.equal(safeOwnedSubscriptionExpiry(null),null);
});

test('verified customer profile requires a valid name and non-duplicated Saudi phone',()=>{
 assert.equal(normalizeCustomerPhone('0551234567'),'+966551234567');
 assert.equal(normalizeCustomerPhone('551234567'),'+966551234567');
 assert.equal(normalizeCustomerPhone('+966551234567'),'+966551234567');
 assert.equal(normalizeCustomerPhone('00966551234567'),'+966551234567');
 for(const bad of ['','123','009665512345678','050000000','not a phone']){
  assert.equal(normalizeCustomerPhone(bad),null);
 }
 assert.equal(normalizeCustomerName('  أحمد   محمد  '),'أحمد محمد');
 assert.equal(normalizeCustomerName('<script>'),null);
 assert.equal(normalizeCustomerName('a'),null);
 const source=readFileSync(new URL('../src/store-customer-account.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../web/store-account.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/store-account.js',import.meta.url),'utf8');
 assert.match(source,/idx_blofy_store_customer_phone_unique/);
 assert.match(source,/customer_profile_required/);
 assert.match(source,/\/api\/v1\/store\/account\/profile/);
 assert.match(html,/id="profile-name"/);
 assert.match(html,/id="profile-phone"/);
 assert.match(js,/showProfileRequired/);
 assert.match(js,/await api\('\/profile'/);
 assert.match(js,/appendActivationGuide/);
});

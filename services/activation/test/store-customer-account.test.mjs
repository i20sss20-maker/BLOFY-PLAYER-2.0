import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createStoreCustomerHandlers,expiryAlert,customerCookie} from '../src/store-customer-account.mjs';
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
 const challenges=new Map(),customers=new Map(),sessions=new Map(),claims=new Map();
 const rows=(arr=[])=>({rows:arr,rowCount:arr.length});
 const db={async query(sql,args=[]){
  sql=String(sql).trim();
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('CREATE ')||
      sql.startsWith('SELECT pg_advisory'))return rows();
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
  if(sql.startsWith('SELECT c.id,c.email,c.alerts_opt_in FROM blofy_store_customer_sessions')){
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
  if(sql.startsWith('SELECT o.id,o.sku,o.status,o.amount_minor'))
   return rows(claims.get(orderId)===args[0]?[order]:[]);
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
   env:{BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true'},
   sendCode:async(email,otp)=>{delivered={email,otp};},
   json:(res,status,data,headers={})=>{res.status=status;res.data=data;res.headers=headers;},
   readJson:async(req)=>req.body
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
 const requested=await call('/api/v1/store/account/request-code','POST',{email:'TEST@Example.com'});
 assert.equal(requested.status,202);
 assert.equal(delivered.email,'test@example.com');
 const bad=await call('/api/v1/store/account/verify-code','POST',{email:delivered.email,code:delivered.otp==='000000'?'999999':'000000'});
 assert.equal(bad.status,401);
 const verified=await call('/api/v1/store/account/verify-code','POST',{email:delivered.email,code:delivered.otp});
 assert.equal(verified.status,200);
 const sessionCookie=verified.headers['set-cookie'].split(';')[0];
 const auth={cookie:sessionCookie};
 const unlinked=await call(detail,'GET',{},auth);
 assert.equal(unlinked.status,404);
 const theft=await call('/api/v1/store/account/claim','POST',{orderId,accessToken:'x'.repeat(43)},auth);
 assert.equal(theft.status,404);
 const claimed=await call('/api/v1/store/account/claim','POST',{orderId,accessToken:secret},auth);
 assert.equal(claimed.status,200);
 const account=await call('/api/v1/store/account','GET',{},auth);
 assert.equal(account.status,200);
 assert.equal(account.data.orders.length,1);
 assert.equal(JSON.stringify(account.data).includes(code),false,'list cannot leak codes');
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
});

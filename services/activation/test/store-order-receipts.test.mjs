import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buildStorePaymentReceipt,receiptEmailMessage,receiptEmailConfig,
 createStoreReceiptEmailEngine} from '../src/store-order-receipts.mjs';

const id=crypto.randomUUID(),paidAt='2026-11-18T20:00:00Z';
const baseOrder={id,sku:'stream-3m',channel:'app',duration_days:90,
  currency:'SAR',status:'paid',created_at:'2026-11-18T19:00:00Z',
  paid_at:paidAt,amount_minor:4000,coupon_discount_minor:0,
  public_order_number:'BF-261118-12345678',
  code_vault:'RAW-SECRET-MUST-NOT-SEND',code:'76543210'};
const config={BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',BLOFY_CUSTOMER_RECEIPTS_ENABLED:'true',
  BLOFY_CUSTOMER_RESEND_API_KEY:'re_test_key',BLOFY_CUSTOMER_MAIL_FROM:'BLOFY <notify@blofyplayer.com>',
  BLOFY_CUSTOMER_RECEIPTS_SINCE:'2026-11-18T19:55:00Z'};

test('verified payments have customer printable receipts without secrets or claimed VAT invoices',()=>{
 const direct=buildStorePaymentReceipt(baseOrder);
 assert.equal(direct.ok,true);
 assert.equal(direct.kind,'payment_receipt');
 assert.equal(direct.isTaxInvoice,false);
 assert.equal(direct.totalMinor,4000);
 assert.equal(direct.subtotalMinor,4000);
 assert.equal(direct.provider,'Geidea');
 assert.equal(direct.items[0].sku,'stream-3m');
 assert.equal(Object.hasOwn(direct,'code'),false);
 assert.equal(Object.hasOwn(direct,'email'),false);
 assert.equal(JSON.stringify(direct).includes('RAW-SECRET-MUST-NOT-SEND'),false);
 const cart=buildStorePaymentReceipt({...baseOrder,sku:'cart',
  cart_items:[{sku:'xtream-1y',quantity:2},{sku:'stream-3m',quantity:1}],
  cart_gross_minor:999999,amount_minor:19500,coupon_discount_minor:1500});
 assert.equal(cart.items.length,2);
 assert.equal(cart.items[0].quantity,2);
 assert.equal(cart.subtotalMinor,21000,'use actual amount + discount, not repriced current catalog');
 assert.equal(cart.discountMinor,1500);
 assert.equal(cart.totalMinor,19500);
 const renewal=buildStorePaymentReceipt({...baseOrder,sku:'renewal',
   duration_days:180,amount_minor:7000});
 assert.equal(renewal.sameCodeRenewal,true);
 assert.equal(renewal.items[0].durationDays,180);
 assert.match(renewal.items[0].description,/نفس الكود/);
 assert.equal(buildStorePaymentReceipt({...baseOrder,status:'pending'}),null);
 assert.equal(buildStorePaymentReceipt({...baseOrder,currency:'USD'}),null);
 assert.equal(buildStorePaymentReceipt({...baseOrder,paid_at:null}),null);
 assert.equal(buildStorePaymentReceipt({...baseOrder,amount_minor:-1}),null);
 assert.equal(buildStorePaymentReceipt({...baseOrder,sku:'cart',cart_items:[{sku:'unlisted',quantity:1}]}),null);
 const mail=receiptEmailMessage(direct);
 assert.match(mail.subject,/BLOFY/);
 assert.match(mail.text,/4000|40\.00/);
 assert.match(mail.text,/store\/account/);
 assert.match(mail.text,/ليست فاتورة ضريبية/);
 assert.doesNotMatch(JSON.stringify(mail),/76543210|RAW-SECRET-MUST-NOT-SEND|accessToken|cardNumber/);
});
test('feature requires explicit on-state, verified sender and exact UTC cutoff',()=>{
 assert.equal(receiptEmailConfig({}).enabled,false);
 assert.equal(receiptEmailConfig({...config,BLOFY_CUSTOMER_RECEIPTS_ENABLED:'false'}).enabled,false);
 assert.equal(receiptEmailConfig({...config,BLOFY_CUSTOMER_RECEIPTS_SINCE:''}).enabled,false);
 assert.equal(receiptEmailConfig({...config,BLOFY_CUSTOMER_RECEIPTS_SINCE:'2026-01-01'}).enabled,false);
 assert.equal(receiptEmailConfig({...config,BLOFY_CUSTOMER_MAIL_FROM:'invalid'}).enabled,false);
 assert.equal(receiptEmailConfig(config).enabled,true);
});

test('owned paid order receives one idempotent email; retries never duplicate after acknowledgement',async()=>{
 let accepted=0,ddl=0,leases=0,inserted=0;
 let queued=false,sent=false,attempts=0,locked=false;
 const sqls=[];
 const rows=(data=[])=>({rows:data,rowCount:data.length});
 const db={
  async query(sql,args=[]){
   sql=String(sql).trim();sqls.push(sql);
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SELECT pg_advisory'))return rows();
   if(sql.startsWith('SELECT to_regclass'))return rows([{t0:'yes',t1:'yes',t2:'yes'}]);
   if(sql.startsWith('CREATE TABLE')){ddl++;return rows();}
   if(sql.startsWith('INSERT INTO blofy_store_payment_receipt_emails')){
    if(!queued){queued=true;inserted++;}
    assert.equal(args[0],new Date(config.BLOFY_CUSTOMER_RECEIPTS_SINCE).toISOString());
    return rows();
   }
   if(sql.startsWith('WITH todo AS')){
    leases++;
    if(!queued||sent||locked||attempts>=3)return rows();
    locked=true;attempts++;return rows([{order_id:id}]);
   }
   if(sql.startsWith('SELECT o.*,c.email')){
    assert.equal(args[0],id);
    return rows([{...baseOrder,email:'purchaser@example.com'}]);
   }
   if(sql.startsWith('UPDATE blofy_store_payment_receipt_emails')){
    assert.equal(args[0],id);sent=true;locked=false;return rows();
   }
   throw Error('Unexpected SQL '+sql.slice(0,180));
  },
  release(){}
 };
 const pool={connect:async()=>db,query:(...params)=>db.query(...params)};
 const sender=async(email,msg,key)=>{
  accepted++;
  assert.equal(email,'purchaser@example.com');
  assert.equal(key,'blofy-payment-receipt-v1-'+id);
  assert.doesNotMatch(JSON.stringify(msg),/RAW-SECRET-MUST-NOT-SEND|76543210/);
  return 'email-provider-ack-'+accepted;
 };
 const engine=createStoreReceiptEmailEngine({pool,env:config,sendEmail:sender});
 assert.equal(engine.configured,true);
 const first=await engine.run();
 assert.equal(first.accepted,1);assert.equal(first.failed,0);
 assert.equal(accepted,1);assert.equal(ddl,1);assert.equal(inserted,1);
 const second=await engine.run();
 assert.equal(second.accepted,0);assert.equal(accepted,1);
 assert.equal(leases,2);
});
test('browser invoice is print-only and paid-order customer access is protected',()=>{
 const js=readFileSync(new URL('../web/store-account.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../web/store-account.html',import.meta.url),'utf8');
 assert.match(js,/payment-receipt/);
 assert.match(js,/paymentReceiptGeneration/);
 assert.match(js,/window\.print\(\)/);
 assert.match(html,/id="payment-receipt"/);
 assert.match(html,/ليس فاتورة ضريبية/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
});

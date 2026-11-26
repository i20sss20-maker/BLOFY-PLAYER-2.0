import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStoreCustomerHandlers} from '../src/store-customer-account.mjs';

test('GET-only Resend inspection 401 does not falsely mark a sending key invalid',async()=>{
 const pool={query:async()=>({rows:[{}]})};
 const env={
   BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
   BLOFY_CUSTOMER_RESEND_API_KEY:'re_invalid_test_example',
   BLOFY_CUSTOMER_MAIL_FROM:'BLOFY <support@blofyplayer.com>'
 };
 const handler=createStoreCustomerHandlers({
   pool,keyHex:'f'.repeat(64),env,
   authorizeAdmin:()=>true,
   json:(res,status,value)=>{res.status=status;res.value=value;},
   readJson:async()=>({}),
   fetchImpl:async()=>({ok:false,status:401})
 });
 const get=async()=>{
   const res={};
   await handler({method:'GET'},res,{pathname:'/api/v1/admin/store/customer-accounts/summary'});
   return res;
 };
 let report=await get();
 assert.equal(report.status,200);
 assert.equal(report.value.emailConfigured,true);
 assert.equal(report.value.emailProviderVerified,false);
 assert.equal(report.value.emailDeliveryVerified,false);
 assert.ok(['provider_probe_pending','key_inspection_unauthorized'].includes(report.value.emailProviderStatus));
 await new Promise(resolve=>setTimeout(resolve,2150));
 report=await get();
 assert.equal(report.value.emailProviderStatus,'key_inspection_unauthorized');
 assert.equal(report.value.emailProviderVerified,false);
 assert.equal(report.value.emailDeliveryVerified,false);
 assert.equal(JSON.stringify(report).includes('re_invalid_test_example'),false);
});

test('send-only scope is not falsely marked provider-verified',async()=>{
 const pool={query:async()=>({rows:[{}]})};
 const handler=createStoreCustomerHandlers({
   pool,keyHex:'f'.repeat(64),
   env:{BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
     BLOFY_CUSTOMER_RESEND_API_KEY:'re_send_only_example',
     BLOFY_CUSTOMER_MAIL_FROM:'BLOFY <support@blofyplayer.com>'},
   authorizeAdmin:()=>true,readJson:async()=>({}),
   json:(res,status,value)=>{res.status=status;res.value=value;},
   fetchImpl:async()=>({ok:false,status:403})
 });
 await new Promise(resolve=>setTimeout(resolve,2150));
 const res={};
 await handler({method:'GET'},res,{pathname:'/api/v1/admin/store/customer-accounts/summary'});
 assert.equal(res.status,200);
 assert.equal(res.value.emailProviderStatus,'key_send_only_cannot_inspect');
 assert.equal(res.value.emailProviderVerified,false);
 assert.equal(res.value.emailDeliveryVerified,false);
});

test('BLOFY ONE never treats a configured email API token as proof of delivery',async()=>{
 const src=await readFile(new URL('../web/blofy-one-launch.js',import.meta.url),'utf8');
 assert.ok(src.includes("providerStatus==='key_invalid'"));
 assert.ok(src.includes('emailProviderStatus'));
 assert.ok(src.includes('اختبار استلام رمز حقيقي'));
 assert.ok(src.includes('مفتاح Resend مرفوض'));
 assert.ok(!src.includes("signal('customers',safeCount(customer.customers)+' حساب · البريد مهيأ'"));
});

test('admin readiness uses recent verified OTP as historical delivery evidence',async()=>{
 const pool={query:async(sql)=>{
  if(String(sql).includes('to_regclass'))return {rows:[{customers:'blofy_store_customers'}]};
  if(String(sql).includes('last_verified_at'))return {rows:[{
   n:3,recent:1,last_verified_at:'2026-11-18T18:32:00Z'
  }]};
  throw Error('unexpected query');
 }};
 const handler=createStoreCustomerHandlers({
  pool,keyHex:'f'.repeat(64),
  env:{BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
   BLOFY_CUSTOMER_RESEND_API_KEY:'re_send_only_example',
   BLOFY_CUSTOMER_MAIL_FROM:'BLOFY <support@blofyplayer.com>'},
  authorizeAdmin:()=>true,json:(res,status,value)=>{res.status=status;res.value=value;},
  readJson:async()=>({}),fetchImpl:async()=>({ok:false,status:401})
 });
 const res={};
 await handler({method:'GET'},res,{pathname:'/api/v1/admin/store/customer-accounts/summary'});
 assert.equal(res.status,200);
 assert.equal(res.value.emailDeliveryVerified,true);
 assert.equal(res.value.emailDeliveryEvidence,'otp_verified_within_24h');
 assert.equal(res.value.lastOtpVerifiedAt,'2026-11-18T18:32:00Z');
 assert.equal(res.value.emailProviderVerified,false);
});

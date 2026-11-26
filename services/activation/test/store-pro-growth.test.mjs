import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createStoreRetentionInsightsHandlers} from '../src/store-retention-insights.mjs';
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
test('retention report is private, read only and excludes PII',async()=>{
 const queries=[];
 const handler=createStoreRetentionInsightsHandlers({
  pool:{query:async(sql)=>{
   queries.push(sql);
   if(sql.includes('to_regclass'))return {rows:[{customers:'blofy_store_customers',carts:'blofy_store_customer_carts',renewals:'blofy_store_renewal_orders',orders:'blofy_store_geidea_orders'}]};
   if(sql.includes('alerts_opt_in'))return {rows:[{total:10,opted_in:4,new_30d:3}]};
   if(sql.includes('jsonb_array_length'))return {rows:[{saved_total:5,changed_7d:2,older_than_day_30d:3}]};
   return {rows:[{renewal_orders:3,paid_renewals:2}]};
  }},
  json:(res,status,body)=>{res.status=status;res.body=body;},
  authorizeAdmin:(req,res)=>req.headers?.authorization==='admin'?true:(res.status=401,false)
 });
 let r={};await handler({method:'GET',headers:{}},r,{pathname:'/api/v1/admin/store/retention'});
 assert.equal(r.status,401);assert.equal(queries.length,0);
 r={};await handler({method:'GET',headers:{authorization:'admin'}},r,{pathname:'/api/v1/admin/store/retention'});
 assert.equal(r.status,200);
 assert.equal(r.body.customers.total,10);
 assert.equal(r.body.customers.marketingOptIn,4);
 assert.equal(r.body.savedCarts.total,5);
 assert.equal(r.body.renewals.paid30Days,2);
 assert.ok(queries.every(sql=>/^\s*SELECT /i.test(sql)));
 assert.doesNotMatch(JSON.stringify(r.body),/@|access_hash|voucher|code_vault|password/i);
 assert.equal(r.body.notifications.marketing,'not_automatically_sent');
});
test('safe store guide is honest, accessible and never touches private customer data',()=>{
 const html=source('../web/store-assistant.html'),
  js=source('../web/store-assistant.js'),
  server=source('../src/server.mjs');
 assert.match(html,/مساعد BLOFY التفاعلي/);
 assert.match(html,/ليست خدمة دردشة ذكاء اصطناعي/);
 assert.match(html,/id="assistant-form"/);
 assert.match(html,/id="messages"/);
 assert.match(html,/id="assistant-question"/);
 assert.match(js,/textContent=text/);
 assert.doesNotMatch(js,/innerHTML|eval\(|localStorage|token|secret|apiKey/i);
 assert.doesNotThrow(()=>new Function(js));
 assert.match(server,/pathname==='\/store\/assistant'/);
 assert.match(server,/PUBLIC_ANALYTICS_CSP/);
 assert.match(server,/serveStoreAssetFile\(res,'store-assistant\.js'/);
 assert.match(source('../web/store.html'),/href="\/store\/assistant"/);
});
test('store manager exposes safe marketing, real orders and distributor gateway without changing payments',()=>{
 const admin=source('../web/store-inventory.html');
 const js=source('../web/store-inventory.js');
 const css=source('../web/store-inventory.css');
 const server=source('../src/server.mjs');
 for(const id of ['store-pro-hub','retention-insights','retention-refresh','retention-metrics','commercial-reports','merchandising-form','merch-slide-0-title']){
  assert.ok(admin.includes('id="'+id+'"'),id+' missing from BLOFY STORE PRO');
 }
 assert.match(admin,/href="\/one#one-distributors"/);
 assert.match(admin,/href="\/admin\/visitors"/);
 assert.match(admin,/href="\/store\/assistant"/);
 assert.match(js,/api\/v1\/admin\/store\/retention/);
 assert.match(js,/api\/v1\/admin\/store\/insights/);
 assert.match(js,/api\/v1\/admin\/store\/merchandising/);
 assert.doesNotThrow(()=>new Function(js));
 assert.match(server,/storeRetentionInsights\(req,res,requestUrl\)/);
 assert.match(server,/storeCommercialInsights\(req,res,requestUrl\)/);
 assert.match(server,/storeMerchandising\(req,res,requestUrl\)/);
 assert.match(css,/\.retention-metrics/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStoreSocialProof,normalizeReview} from '../src/store-social-proof.mjs';

const customer='45a105b3-cfbd-4bbc-ad1f-700082e03e9a';
const reviewId='f219549a-29bd-4ac3-97b0-acbe7d85c9cd';
const json=(res,status,body,headers)=>{Object.assign(res,{status,body,headers});};
function fixture({authorized=true,customerReady=true}={}){
 const calls=[];
 const client={
  async query(sql,args=[]){
   calls.push({type:'transaction',sql,args});
   if(sql.includes('UPDATE blofy_store_reviews'))
     return {rows:[{id:reviewId,status:'approved'}]};
   return {rows:[]};
  },release(){}
 };
 const pool={
  async connect(){return client;},
  async query(sql,args=[]){
   calls.push({type:'pool',sql,args});
   if(sql.includes('to_regclass'))return {rows:[{orders:'orders',trials:'trials'}]};
   if(sql.includes('COUNT(*)::int AS n FROM blofy_store_geidea_orders'))return {rows:[{n:7}]};
   if(sql.includes('COUNT(*)::int AS n FROM blofy_store_trial_inventory'))return {rows:[{n:2}]};
   if(sql.includes('COUNT(*)::int AS n')&&sql.includes('AVG(rating)'))
      return {rows:[{n:1,average:'4.0'}]};
   if(sql.includes("WHERE status='approved'")&&sql.includes('LIMIT 6'))
      return {rows:[{id:reviewId,rating:4,body:'اشتريت اشتراكًا وكان التفعيل واضحًا وسهلًا.',
         display_name:'عميل BLOFY',approved_at:'2026-11-19T15:00:00Z'}]};
   if(sql.includes(' AS trial,')&&sql.includes(' AS paid'))
      return {rows:[{trial:true,paid:false}]};
   if(sql.includes('INSERT INTO blofy_store_reviews')&&sql.includes('ON CONFLICT'))
      return {rows:[{id:reviewId,status:'pending'}]};
   if(sql.includes('JOIN blofy_store_customers c'))
      return {rows:[]};
   return {rows:[]};
  }
 };
 const handler=createStoreSocialProof({
  pool,json,readJson:async req=>req.body,authorizeAdmin:()=>authorized,
  getAuthenticatedCustomer:async()=>customerReady?{id:customer,full_name:'أحمد محمد',
    email:'test@example.com'}:null,ensureCustomerSchema:async()=>{},
  ensureTrialSchema:async()=>{},ensureStoreSchema:async()=>{}
 });
 return {handler,calls};
}
test('feedback requires honest body, rating, and opt-in for first-name display',()=>{
 assert.deepEqual(normalizeReview({
  rating:4,body:'  تجربة الشراء سريعة و الخدمة واضحة.  ',showFirstName:false
 }),{rating:4,body:'تجربة الشراء سريعة و الخدمة واضحة.',showFirstName:false});
 assert.throws(()=>normalizeReview({rating:6,body:'اشتراكي ممتاز وسريع',showFirstName:false}),/review_rating_invalid/);
 assert.throws(()=>normalizeReview({rating:2,body:'اتصل بي على 0551234567 للتواصل',showFirstName:false}),/review_personal_info_disallowed/);
 assert.throws(()=>normalizeReview({rating:1,body:'تجربتي ليست جيدة بما يكفي'}),/review_consent_required/);
});
test('public order counts come directly from actual paid and trial data; published reviews are real only',async()=>{
 const {handler,calls}=fixture(),res={};
 assert.equal(await handler({method:'GET'},res,new URL('https://blofyplayer.com/api/v1/store/social-proof')),true);
 assert.equal(res.status,200);
 assert.deepEqual(res.body.metrics,{fulfilledPaidOrders:7,deliveredTrials:2,source:'confirmed_store_records'});
 assert.equal(res.body.syntheticReviews,false);
 assert.equal(res.body.reviews.total,1);
 assert.equal(res.body.reviews.items[0].text,'اشتريت اشتراكًا وكان التفعيل واضحًا وسهلًا.');
 assert.ok(calls.some(c=>c.sql.includes("o.status='paid'")));
 assert.ok(calls.some(c=>c.sql.includes("status='approved'")));
 assert.ok(!JSON.stringify(res.body).includes('test@example.com'));
});
test('OTP-verified customer with a previous trial can submit a review but it is pending by default',async()=>{
 const {handler,calls}=fixture(),res={};
 const req={method:'POST',headers:{origin:'https://blofyplayer.com','sec-fetch-site':'same-origin'},
  body:{rating:3,body:'التطبيق جيد لكن أتمنى تحسين سرعة التنقل.',showFirstName:true}};
 assert.equal(await handler(req,res,new URL('https://blofyplayer.com/api/v1/store/reviews')),true);
 assert.equal(res.status,201);
 assert.equal(res.body.status,'pending');
 const inserted=calls.find(c=>c.sql.includes('INSERT INTO blofy_store_reviews')&&c.type==='pool');
 assert.equal(inserted.args[4],'أحمد');
 assert.ok(inserted.sql.includes("status='pending'"));
});
test('anonymous users and cross-site mutations cannot publish feedback',async()=>{
 const {handler,calls}=fixture({customerReady:false}),res={};
 const req={method:'POST',headers:{origin:'https://blofyplayer.com'},
  body:{rating:1,body:'أحتاج تحسينات كبيرة في جودة الخدمة.',showFirstName:false}};
 await handler(req,res,new URL('https://blofyplayer.com/api/v1/store/reviews'));
 assert.equal(res.status,401);
 assert.equal(res.body.error,'review_login_required');
 assert.ok(!calls.some(c=>c.sql.includes('INSERT INTO blofy_store_reviews')));
 const blocked=fixture(),reply={};
 await blocked.handler({...req,headers:{origin:'https://malicious.example'}},reply,
  new URL('https://blofyplayer.com/api/v1/store/reviews'));
 assert.equal(reply.status,403);
});
test('admin moderation is authenticated and audited; no invented reviews can be created from it',async()=>{
 const x=fixture(),res={};
 await x.handler({method:'POST',headers:{origin:'https://blofyplayer.com'},
  body:{decision:'approved'}},res,new URL('https://blofyplayer.com/api/v1/admin/store/reviews/'+reviewId+'/decision'));
 assert.equal(res.status,200);
 assert.equal(res.body.status,'approved');
 assert.ok(x.calls.some(c=>c.sql.includes('INSERT INTO blofy_store_review_events')));
 const anon=fixture({authorized:false});
 assert.equal(await anon.handler({method:'GET'}, {},new URL('https://blofyplayer.com/api/v1/admin/store/reviews')),true);
 assert.equal(anon.calls.length,0);
});
test('storefront labels metrics as actual, and provides genuine customer submission UI',()=>{
 const store=readFileSync(new URL('../web/store.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/store-reviews.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/store-reviews.css',import.meta.url),'utf8');
 const admin=readFileSync(new URL('../web/blofy-one-reviews-admin.js',import.meta.url),'utf8');
 assert.match(store,/آراء العملاء وتجاربهم/);
 assert.match(store,/voices-orders-number/);
 assert.match(store,/voices-review-form/);
 assert.match(store,/بدون تعليقات مختلقة أو أعداد غير مؤكدة/);
 assert.match(js,/api\/v1\/store\/social-proof/);
 assert.match(js,/api\/v1\/store\/reviews/);
 assert.match(admin,/api\/v1\/admin\/store\/reviews/);
 assert.match(css,/voices-metrics/);
 assert.doesNotThrow(()=>new Function(js));
 assert.doesNotThrow(()=>new Function(admin));
});

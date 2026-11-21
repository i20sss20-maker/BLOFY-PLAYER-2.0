import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStoreSubscriptionAdmin,parseOpsOptions} from '../src/store-subscription-admin.mjs';

const url=q=>new URL('https://blofyplayer.com/api/v1/admin/store/subscription-operations'+q);
const uuid='11111111-1111-4111-8111-111111111111';
test('admin report rejects malicious filters and excessive pages before accessing data',async()=>{
 assert.equal(parseOpsOptions(url('?view=ren%20ewals')),null);
 assert.equal(parseOpsOptions(url('?status=paid')),null,'paid only applies to renewals');
 assert.equal(parseOpsOptions(url('?view=renewals&status=expiring')),null);
 assert.equal(parseOpsOptions(url('?page=201')),null);
 assert.equal(parseOpsOptions(url('?page=-1')),null);
 assert.equal(parseOpsOptions(url('?page=1.5')),null);
 assert.equal(parseOpsOptions(url('?q='+encodeURIComponent('x'.repeat(101)))),null);
 assert.equal(parseOpsOptions(url('?q='+encodeURIComponent('\\u0000')))?.q,'\\u0000');
 assert.equal(parseOpsOptions(url('?view=renewals&status=pending&page=2')).page,2);
 let accessed=0,schemaCalls=0;
 const admin=createStoreSubscriptionAdmin({pool:{query:async()=>{accessed++;throw Error('leaked');}},
  ensureStoreSchema:async()=>{schemaCalls++;},
  json:(res,code,data)=>{res.code=code;res.data=data;},
  authorizeAdmin:(_req,res)=>{res.code=401;return false;}});
 const res={};
 await admin.handler({},res,url(''));
 assert.equal(res.code,401);
 assert.equal(accessed,0,'anonymous browser cannot read even table metadata');
 assert.equal(schemaCalls,0,'anonymous users cannot trigger any DDL or schema migration');
});
test('real owner-linked orders power the dashboard without exposing codes or vaults',async()=>{
 const queries=[],rows=result=>({rows:result,rowCount:result.length});
 let schemaReady=false,schemaCalls=0;
 const db={async query(sql,args=[]){
  queries.push({sql,args});
  if(sql.startsWith('SELECT to_regclass')){
   assert.equal(schemaReady,true,'admin page initializes store schema before read queries');
   return rows([Object.fromEntries(Array.from({length:7},(_,i)=>['t'+i,'present']))]);
  }
  if(sql.startsWith('SELECT COUNT(*)::int AS total,')&&sql.includes('blofy_store_renewal_orders')){
   return rows([{total:5,paid:3,pending:1,failed:1,cancelled:0,overdue:1,paid_amount_minor:'21000'}]);
  }
  if(sql.includes('FROM blofy_store_customer_reminders')){
   return rows([{sent:2,exhausted:1,retrying:3}]);
  }
  if(sql.startsWith('WITH bought AS')&&sql.includes('COUNT(*) FILTER')){
   return rows([{total:4,active:1,expiring:1,expired:1,unused:1,revoked:0,disabled:0}]);
  }
  if(sql.startsWith('WITH bought AS')&&sql.includes('COUNT(*) OVER')){
   return rows([{customer_id:uuid,email:'client@example.com',voucher_id:uuid,
     code_channel:'app',code_hint:'12••••78',redeemed_at:new Date(),
     expires_at:new Date(),state:'expiring',matched:'1',
     code_vault:'NEVER EXPOSE',code_hash:'DO NOT DISCLOSE'}]);
  }
  if(sql.startsWith('SELECT o.id AS order_id')){
   return rows([{order_id:uuid,public_order_number:'BF-123',
    voucher_id:uuid,plan_sku:'stream-6m',email:'client@example.com',
    code_hint:'12••••78',code_channel:'app',status:'pending',
    duration_days:180,amount_minor:7000,created_at:new Date(),
    paid_at:null,expires_at:new Date(),matched:'1',code_vault:'PRIVATE'}]);
  }
  throw Error('Unexpected SQL '+sql.slice(0,150));
 }};
 const admin=createStoreSubscriptionAdmin({pool:db,
  ensureStoreSchema:async()=>{schemaReady=true;schemaCalls++;},
  json:(res,code,data)=>{res.code=code;res.data=data;},
  authorizeAdmin:()=>true});
 const subscribe={};
 await admin.handler({},subscribe,url('?view=subscriptions&status=expiring&q=client&page=1'));
 assert.equal(subscribe.code,200);
 assert.equal(schemaCalls,1);
 assert.equal(subscribe.data.subscriptions.expiring,1);
 assert.equal(subscribe.data.renewals.pendingOver20m,1);
 assert.deepEqual(subscribe.data.reminders,
  {acceptedByProvider:2,exhaustedRetries:1,retrying:3});
 assert.equal(subscribe.data.items[0].status,'expiring');
 assert.equal(JSON.stringify(subscribe.data).includes('NEVER EXPOSE'),false);
 assert.equal(JSON.stringify(subscribe.data).includes('DO NOT DISCLOSE'),false);
 assert.ok(queries.find(q=>q.sql.includes('COUNT(*) OVER')&&q.args.includes('expiring')));
 const renewal={};
 await admin.handler({},renewal,url('?view=renewals&status=pending&q=BF-123'));
 assert.equal(renewal.code,200);
 assert.equal(renewal.data.items[0].orderNumber,'BF-123');
 assert.equal(renewal.data.items[0].amountMinor,7000);
 assert.equal(renewal.data.items[0].status,'pending');
 assert.equal(JSON.stringify(renewal.data).includes('PRIVATE'),false);
 assert.ok(queries.find(q=>q.sql.includes('JOIN blofy_store_renewal_orders')||
  q.sql.includes('FROM blofy_store_renewal_orders')));
 const noEntry={};
 await admin.handler({},noEntry,url('?view=renewals&status=expiring'));
 assert.equal(noEntry.code,400);
});
test('BLOFY ONE loads only existing signed admin endpoints and renders text safely',()=>{
 const script=readFileSync(new URL('../web/blofy-one-store-ops.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../web/blofy-one.html',import.meta.url),'utf8');
 assert.match(html,/id="one-renewal-ops"/);
 assert.match(html,/blofy-one-store-ops\.js/);
 assert.match(html,/blofy-one-store-ops\.css/);
 assert.match(script,/\/api\/v1\/admin\/store\/subscription-operations/);
 assert.match(script,/textContent/);
 assert.doesNotMatch(script,/innerHTML|eval\(/);
 assert.doesNotMatch(script,/POST|PUT|PATCH|DELETE/,'dashboard is strictly read-only');
});

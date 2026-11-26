import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStoreSubscriptionAdmin,parseOpsOptions} from '../src/store-subscription-admin.mjs';

const url=q=>new URL('https://blofyplayer.com/api/v1/admin/store/subscription-operations'+q);
const uuid='11111111-1111-4111-8111-111111111111';
const rows=list=>({rows:list,rowCount:list.length});

function mockedSalesAdmin(){
 const queries=[];
 let schemaReady=false;
 const pool={async query(sql,args=[]){
  queries.push({sql,args});
  if(sql.startsWith('SELECT to_regclass')){
   assert.equal(schemaReady,true);
   return rows([Object.fromEntries(Array.from({length:7},(_,i)=>['t'+i,'public-table']))]);
  }
  if(sql.includes('AS paid_last30_minor'))
   return rows([{
    total:11,paid:6,pending:3,failed:1,cancelled:1,
    overdue:2,paid_amount_minor:'95000',paid_last30_minor:'68000'
   }]);
  if(sql.startsWith('SELECT o.id,o.public_order_number,o.status,o.sku')){
   return rows([{
    id:uuid,public_order_number:'BF-2026-00012',
    status:'pending',sku:'cart',channel:'app',amount_minor:11900,
    currency:'SAR',created_at:'2026-11-18T20:00:00Z',paid_at:null,
    email:'customer@example.com',matched:'1',
    access_hash:'NEVER_DISCLOSE_ACCESS_HASH',
    code_vault:'NEVER_DISCLOSE_FULL_CODE',code_hash:'NEVER_DISCLOSE_HASH',
    provider_reference:'NEVER_DISCLOSE_PROVIDER_REFERENCE'
   }]);
  }
  throw Error('Unexpected SQL: '+sql.slice(0,130));
 }};
 const admin=createStoreSubscriptionAdmin({
  pool,ensureStoreSchema:async()=>{schemaReady=true;},
  json:(res,code,data)=>{res.code=code;res.data=data;},
  authorizeAdmin:()=>true
 });
 return {admin,queries};
}

test('sales view strict query parser, allowed filters and bounded pagination',()=>{
 assert.equal(parseOpsOptions(url('?view=sales&status=pending&page=3')).page,3);
 assert.equal(parseOpsOptions(url('?view=sales&status=expired')),null);
 assert.equal(parseOpsOptions(url('?view=sales&status=refunded')),null,
  'schema only supports pending, paid, failed and cancelled');
 assert.equal(parseOpsOptions(url('?view=sales&status=pending&page=201')),null);
 assert.equal(parseOpsOptions(url('?view=sales&status=pending&page=0')),null);
 assert.equal(parseOpsOptions(url('?view=sales&status=pending&q='+encodeURIComponent('x'.repeat(101)))),null);
 assert.equal(parseOpsOptions(url('?view=sales&status=paid&q=email')).q,'email');
});

test('sales admin denies anonymous requests before touching PostgreSQL',async()=>{
 let calls=0,schemas=0;
 const admin=createStoreSubscriptionAdmin({
  pool:{query:async()=>{calls++;throw Error('unauthorized query');}},
  ensureStoreSchema:async()=>{schemas++;},
  json:(res,status,data)=>{res.code=status;res.data=data;},
  authorizeAdmin:(_req,res)=>{res.code=401;return false;}
 });
 const result={};
 await admin.handler({},result,url('?view=sales'));
 assert.equal(result.code,401);
 assert.equal(calls,0);
 assert.equal(schemas,0);
});

test('sales dashboard includes every recorded store order and does not leak secrets',async()=>{
 const {admin,queries}=mockedSalesAdmin();
 const response={};
 await admin.handler({},response,url('?view=sales&status=pending&q=BF-2026&page=2'));
 assert.equal(response.code,200);
 assert.equal(response.data.ok,true);
 assert.equal(response.data.readOnly,true);
 assert.equal(response.data.view,'sales');
 assert.equal(response.data.sales.total,11);
 assert.equal(response.data.sales.paid,6);
 assert.equal(response.data.sales.pending,3);
 assert.equal(response.data.sales.pendingOver20m,2);
 assert.equal(response.data.sales.paidAmountMinor,'95000');
 assert.equal(response.data.sales.paidLast30Minor,'68000');
 assert.equal(response.data.items[0].sku,'cart');
 assert.equal(response.data.items[0].email,'customer@example.com');
 assert.equal(response.data.items[0].orderNumber,'BF-2026-00012');
 assert.equal(response.data.page,2);
 assert.equal(response.data.pageSize,25);
 assert.equal(response.data.matched,1);
 assert.equal(response.data.renewals,null);
 assert.equal(response.data.subscriptions,null);
 for(const forbidden of ['NEVER_DISCLOSE_ACCESS_HASH','NEVER_DISCLOSE_FULL_CODE',
  'NEVER_DISCLOSE_HASH','NEVER_DISCLOSE_PROVIDER_REFERENCE'])
  assert.doesNotMatch(JSON.stringify(response.data),new RegExp(forbidden));
 const sql=queries.find(q=>q.sql.includes('COUNT(*) OVER'));
 assert.ok(sql.sql.includes('FROM blofy_store_geidea_orders o'));
 assert.ok(sql.sql.includes('o.status=$2'));
 assert.ok(sql.sql.includes('ORDER BY o.created_at DESC'));
 assert.equal(sql.args[1],'pending');
 assert.equal(sql.args[2],25);
 assert.equal(sql.args[3],25);
 assert.ok(queries.every(q=>/^SELECT /i.test(q.sql)),
  'admin report must only read, no order status or payment changes');
});

test('store sales dashboard is separate from older PLAYER activation sales',()=>{
 const js=readFileSync(new URL('../web/blofy-one-store-sales.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../web/blofy-one.html',import.meta.url),'utf8');
 assert.match(html,/id="one-store-sales"/);
 assert.match(html,/id="one-sales"/);
 assert.match(html,/id="one-renewal-ops"/);
 assert.match(html,/blofy-one-store-sales\.js/);
 assert.match(js,/view:'sales'/);
 assert.match(js,/credentials:'same-origin'/);
 assert.match(js,/data\.readOnly!==true/);
 assert.match(js,/textContent/);
 assert.doesNotMatch(js,/innerHTML|eval\(/);
 assert.doesNotMatch(js,/method:'(?:POST|PUT|PATCH|DELETE)'/);
 assert.doesNotThrow(()=>new Function(js));
});

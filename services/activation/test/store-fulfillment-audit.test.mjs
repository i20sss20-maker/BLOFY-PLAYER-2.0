import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assessPaidOrder,auditPaidFulfillment} from '../src/store-fulfillment-audit.mjs';
import {encryptStreamCode} from '../src/xtream-code-vault.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';
import {createStoreGeideaHandlers} from '../src/store-geidea-checkout.mjs';

const keyHex='e'.repeat(64);
const id=()=>crypto.randomUUID();
const cartOrder=(oid)=>({
 id:oid,sku:'cart',public_order_number:'BF-261118-12345678',channel:'app',
 cart_items:[{sku:'stream-6m',quantity:1},
   {sku:'bundle-2y',quantity:1,bundleSelection:['app','xtream']}],
 voucher_id:null,bundle_selection:null
});
const voucher=(orderId,position,sku,channel,duration,valid=true)=>{
 const codeId=id(),code='765432'+String(position)+String(position);
 return {order_id:orderId,position,sku,channel,duration_days:duration,
  id:codeId,code_vault:encryptStreamCode(codeId,code,keyHex),
  code_hash:streamCodeProof(code,keyHex),revoked_at:valid?null:new Date()};
};

test('paid cart with 3 required codes never passes audit with 1 or 2',()=>{
 const o=cartOrder(id());
 const rows=[voucher(o.id,1,'stream-6m','app',180),
  voucher(o.id,2,'stream-1y','app',365),
  voucher(o.id,3,'xtream-1y','xtream',365)];
 assert.deepEqual(assessPaidOrder(o,rows,keyHex),
  {ok:true,reason:null,expectedCodes:3,deliveredCodes:3});
 const missing=assessPaidOrder(o,rows.slice(0,2),keyHex);
 assert.equal(missing.ok,false);
 assert.equal(missing.reason,'code_count_mismatch');
 assert.equal(missing.expectedCodes,3);
 assert.equal(missing.deliveredCodes,2);
 const swapped=[rows[0],rows[2],rows[1]];
 assert.equal(assessPaidOrder(o,swapped,keyHex).reason,'code_position_mismatch');
 const wrongSku=[rows[0],{...rows[1],sku:'xtream-1y'},rows[2]];
 assert.equal(assessPaidOrder(o,wrongSku,keyHex).reason,'code_product_mismatch');
 const tampered=[...rows,{...rows[2],code_hash:'a'.repeat(64)}];
 assert.equal(assessPaidOrder(o,tampered.slice(1),keyHex).reason,'code_product_mismatch');
 assert.equal(assessPaidOrder(o,[rows[0],rows[1],{...rows[2],code_hash:'a'.repeat(64)}],keyHex).reason,
  'code_integrity_or_revocation');
 assert.equal(assessPaidOrder(o,[rows[0],rows[1],{...rows[2],revoked_at:new Date()}],keyHex).ok,false);
});

test('paid direct, bundle and corrupt cart detected independently',()=>{
 const single={sku:'stream-3m',channel:'app',duration_days:90,voucher_id:id()};
 const one={...voucher(id(),1,'stream-3m','app',90)};
 assert.equal(assessPaidOrder(single,[one],keyHex).ok,true);
 assert.equal(assessPaidOrder(single,[],keyHex).ok,false);
 assert.equal(assessPaidOrder({...single,voucher_id:null},[],keyHex).ok,false);
 const bundle={sku:'bundle-2y',bundle_selection:['app','xtream'],voucher_id:null};
 const rows=[voucher(id(),1,'stream-1y','app',365),voucher(id(),2,'xtream-1y','xtream',365)];
 assert.equal(assessPaidOrder(bundle,rows,keyHex).ok,true);
 assert.equal(assessPaidOrder(bundle,[rows[0]],keyHex).reason,'code_count_mismatch');
 assert.equal(assessPaidOrder({...cartOrder(id()),cart_items:{}},[],keyHex).reason,'invalid_paid_order');
});

test('read-only audit returns limited order references, never raw code, vault or email',async()=>{
 const oid=id(),o=cartOrder(oid);
 const rows=[voucher(oid,1,'stream-6m','app',180),
  voucher(oid,2,'stream-1y','app',365)];
 const db={async query(sql,args=[]){
  if(sql.startsWith('SELECT id,sku,channel,duration_days,cart_items'))
   return {rows:[o]};
  if(sql.includes('FROM blofy_store_cart_vouchers cv')){
   assert.deepEqual(args,[[oid]]);
   return {rows};
  }
  throw Error('unexpected query '+sql.slice(0,110));
 }};
 const report=await auditPaidFulfillment({pool:db,keyHex});
 assert.equal(report.auditedOrders,1);
 assert.equal(report.completeOrders,0);
 assert.equal(report.issueOrders,1);
 assert.equal(report.issues[0].expectedCodes,3);
 assert.equal(report.issues[0].deliveredCodes,2);
 assert.equal(report.issues[0].reason,'code_count_mismatch');
 assert.equal(report.scope,'last_90_days_latest_500_paid_orders');
 const serialized=JSON.stringify(report);
 for(const v of rows){
  assert.equal(serialized.includes(v.code_hash),false);
  assert.equal(serialized.includes(v.code_vault),false);
  assert.equal(serialized.includes(v.id),false);
 }
 assert.equal(Object.hasOwn(report,'customerEmail'),false);
});

test('fulfillment audit endpoint rejects unauthenticated admins before accessing database',async()=>{
 let queries=0,authChecked=0;
 const handler=createStoreGeideaHandlers({
  pool:{query:()=>{queries++;throw Error('not allowed');},
   connect:()=>{queries++;throw Error('not allowed');}},
  keyHex,readJson:async req=>req.body,
  json:(res,status,value)=>{res.status=status;res.value=value;},
  env:{},authorizeAdmin:(_req,res)=>{authChecked++;res.status=401;return false;}
 });
 const res={};
 await handler({method:'GET',headers:{}},res,{pathname:'/api/v1/admin/store/fulfillment-audit'});
 assert.equal(authChecked,1);
 assert.equal(queries,0);
 assert.equal(res.status,401);
});

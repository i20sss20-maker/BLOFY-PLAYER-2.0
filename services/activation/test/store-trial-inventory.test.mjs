import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {TRIAL_PLANS,trialStockRequest,publicTrialCode,createStoreTrialInventory}
 from '../src/store-trial-inventory.mjs';
import {publicStorePlans} from '../src/store-geidea-checkout.mjs';
import {encryptStreamCode,decryptStreamCode} from '../src/xtream-code-vault.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';

const KEY='5e'.repeat(32);
const SOURCE='5575e3a2-57c7-4458-9c80-a4108fe9fba6';
const CUSTOMER='b645e90e-699e-4739-b915-5ee8901ef3ea';
const env={
 BLOFY_STORE_TRIALS_ENABLED:'true',BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
 BLOFY_CUSTOMER_RESEND_API_KEY:'re_this-is-a-local-test-only',
 BLOFY_CUSTOMER_MAIL_FROM:'noreply@example.test'
};
const json=(res,status,body,headers)=>Object.assign(res,{status,body,headers});
const route=pathname=>({pathname});
const req=(payload={},headers={})=>({
 method:'POST',
 headers:{origin:'https://blofyplayer.com','content-type':'application/json',
  'x-blofy-trial':'1',cookie:'customer-session',...headers},
 socket:{remoteAddress:'127.0.0.1'},payload
});
const readJson=async request=>request.payload;
function fakeDatabase(){
 const state={queries:[],vouchers:new Map(),stock:[],source:SOURCE,claimed:false};
 const db={
  release(){},
  async query(sql,params=[]){
   state.queries.push({sql,params});
   const normalized=String(sql).replace(/\s+/g,' ').toLowerCase();
   if(normalized.includes("select id from blofy_xtream_servers"))
    return {rows:[{id:state.source}]};
   if(normalized.includes("select count(*)::int as n from blofy_xtream_gateway_duration_codes"))
    return {rows:[{n:state.vouchers.size}]};
   if(normalized.startsWith('insert into blofy_xtream_gateway_duration_codes')){
    const [id,hash,hint,label,source,channel,vault]=params;
    state.vouchers.set(id,{id,code_hash:hash,code_vault:vault,code_hint:hint,
     label,source_id:source,code_channel:channel,duration_days:1,
     redeemed_at:null,revoked_at:null,account_id:null});
    return {rows:[{id}]};
   }
   if(normalized.startsWith('insert into blofy_store_trial_inventory')){
    state.stock.push({voucher_id:params[0],sku:params[1],customer_id:null,claimed_at:null});
    return {rows:[]};
   }
   if(normalized.includes("from blofy_store_trial_inventory")&&
      normalized.includes("where i.customer_id=$1")){
    const item=state.stock.find(x=>x.customer_id===params[0]);
    const voucher=item?state.vouchers.get(item.voucher_id):null;
    return {rows:item?[{...item,...voucher,voucher_id:item.voucher_id}]:[]};
   }
   if(normalized.includes("from blofy_store_trial_inventory")&&
      normalized.includes("where i.sku=$1")&&
      normalized.includes("for update of i skip locked")){
    const item=state.stock.find(x=>x.sku===params[0]&&!x.customer_id);
    return {rows:item?[{voucher_id:item.voucher_id}]:[]};
   }
   if(normalized.includes("count(*)::int as n")&&normalized.includes("claimed_at > now()"))
    return {rows:[{n:state.stock.filter(x=>x.claimed_at).length}]};
   if(normalized.startsWith('update blofy_store_trial_inventory')){
    const item=state.stock.find(x=>x.voucher_id===params[0]);
    assert.ok(item&&!item.customer_id);
    item.customer_id=params[1];item.claimed_at=new Date('2026-11-19T12:00:00Z');
    return {rows:[],rowCount:1};
   }
   if(normalized.includes('group by i.sku')){
    return {rows:TRIAL_PLANS.map(plan=>({
     sku:plan.sku,total:state.stock.filter(x=>x.sku===plan.sku).length,
     available:state.stock.filter(x=>x.sku===plan.sku&&!x.customer_id).length,
     claimed:state.stock.filter(x=>x.sku===plan.sku&&x.customer_id).length
    }))};
   }
   if(normalized.includes('order by i.claimed_at desc limit 20')){
    return {rows:state.stock.filter(x=>x.customer_id).map(x=>({
     sku:x.sku,claimed_at:x.claimed_at,code_hint:state.vouchers.get(x.voucher_id).code_hint
    }))};
   }
   return {rows:[],rowCount:0};
  }
 };
 const pool={connect:async()=>db,query:db.query.bind(db)};
 return {pool,state};
}
function setup({enabled=true,admin=true,customer=true}={}){
 const {pool,state}=fakeDatabase();
 const handler=createStoreTrialInventory({
  pool,json,readJson,keyHex:KEY,
  env:enabled?env:{...env,BLOFY_STORE_TRIALS_ENABLED:'false'},
  authorizeAdmin:(request,res)=>admin&&request.headers.authorization==='owner',
  getAuthenticatedCustomer:async request=>customer&&request.headers.cookie==='customer-session'?
   {id:CUSTOMER,email:'verified@example.test'}:null,
  clock:()=>Date.UTC(2026,10,19,12)
 });
 return {handler,state};
}
test('trial SKUs are separate one-day offers and never paid checkout products',()=>{
 assert.equal(TRIAL_PLANS.length,2);
 assert.deepEqual(TRIAL_PLANS.map(p=>[p.sku,p.days,p.channel]),[
  ['trial-stream-1d',1,'app'],['trial-xtream-1d',1,'xtream']]);
 const commerce=new Set(publicStorePlans().map(p=>p.sku));
 assert.ok(TRIAL_PLANS.every(p=>!commerce.has(p.sku)));
 assert.equal(trialStockRequest({sku:'stream-1y'}),null);
 assert.equal(trialStockRequest({sku:'trial-xtream-1d'}).channel,'xtream');
});
test('encrypted trial code cannot be revealed after vault or HMAC tampering',()=>{
 const id=crypto.randomUUID(),code='12345678';
 const voucher={id,voucher_id:id,code_hash:streamCodeProof(code,KEY),
   code_vault:encryptStreamCode(id,code,KEY)};
 assert.equal(publicTrialCode(voucher,KEY),code);
 assert.equal(decryptStreamCode(id,voucher.code_vault,KEY),code);
 assert.throws(()=>publicTrialCode({...voucher,code_hash:'not-correct'},KEY),
  /trial_code_integrity_unavailable/);
});
test('feature is disabled until explicitly enabled and email OTP is configured',async()=>{
 const {handler,state}=setup({enabled:false});let res={};
 assert.equal(await handler(req(),res,route('/api/v1/store/orders/status')),false);
 await handler({...req(),method:'GET'},res,route('/api/v1/store/trials/availability'));
 assert.equal(res.status,200);assert.equal(res.body.enabled,false);
 await handler(req({sku:'trial-stream-1d'}),res,route('/api/v1/store/trials/claim'));
 assert.equal(res.status,503);assert.equal(state.queries.length,0);
});
test('not logged-in or cross-site browsers never reserve a trial voucher',async()=>{
 const {handler,state}=setup();
 for(const [headers,status] of [
  [{origin:'https://other.example'},403],
  [{'x-blofy-trial':'wrong'},403],
  [{'content-type':'text/plain'},415],
  [{'content-length':'2000'},413],
  [{cookie:''},401]
 ]){
  const res={};await handler(req({sku:'trial-stream-1d'},headers),res,
    route('/api/v1/store/trials/claim'));
  assert.equal(res.status,status);
 }
 assert.equal(state.stock.filter(x=>x.customer_id).length,0);
});
test('owner generates encrypted 1-day STREAM and Xtream stock, separately from paid inventory',async()=>{
 const {handler,state}=setup();
 for(const sku of ['trial-stream-1d','trial-xtream-1d']){
  const res={};await handler(req({sku,quantity:2},{authorization:'owner'}),res,
    route('/api/v1/admin/store/trials/generate'));
  assert.equal(res.status,200);assert.equal(res.body.generated,2);
 }
 assert.equal(state.vouchers.size,4);
 assert.equal(state.stock.length,4);
 assert.ok(state.stock.every(x=>!x.claimed_at&&!x.customer_id));
 assert.deepEqual([...state.vouchers.values()].map(v=>v.code_channel),['app','app','xtream','xtream']);
 const rows=state.queries.filter(x=>/insert into blofy_xtream_gateway_duration_codes/i.test(x.sql));
 assert.ok(rows.every(x=>x.sql.includes('FALSE')&&x.sql.includes('1,1')));
 assert.ok(state.queries.some(x=>/pg_advisory_xact_lock\(718420682\)/i.test(x.sql)));
 assert.ok(state.queries.every(x=>!/(insert|update|delete) into blofy_store_geidea_orders/i.test(x.sql)));
 const summary={};
 await handler({...req({},{authorization:'owner'}),method:'GET'},summary,
    route('/api/v1/admin/store/trials/summary'));
 assert.equal(summary.status,200);
 assert.equal(summary.body.products[0].available,2);
 assert.equal(summary.body.products[1].available,2);
 assert.doesNotMatch(JSON.stringify(summary.body),/12345678|code_vault|code_hash/);
});
test('admin generation is protected and rejects paid SKU or oversized batches',async()=>{
 const {handler,state}=setup();for(const [payload,status,headers] of [
  [{sku:'trial-stream-1d',quantity:10},undefined,{}],
  [{sku:'stream-3m',quantity:1},400,{authorization:'owner'}],
  [{sku:'trial-xtream-1d',quantity:31},400,{authorization:'owner'}]
 ]){
  const res={};await handler(req(payload,headers),res,route('/api/v1/admin/store/trials/generate'));
  if(status)assert.equal(res.status,status);
 }
 assert.equal(state.vouchers.size,0);
});
test('verified account claims one stock voucher globally, can recover it and cannot get a second channel',async()=>{
 const {handler,state}=setup();
 for(const sku of ['trial-stream-1d','trial-xtream-1d']){
  const res={};
  await handler(req({sku,quantity:1},{authorization:'owner'}),res,
   route('/api/v1/admin/store/trials/generate'));
  assert.equal(res.status,200);
 }
 const first={};
 await handler(req({sku:'trial-stream-1d'}),first,route('/api/v1/store/trials/claim'));
 assert.equal(first.status,200);
 assert.equal(first.body.channel,'app');
 assert.equal(first.body.durationDays,1);
 assert.equal(first.body.alreadyClaimed,false);
 assert.match(first.body.code,/^\d{8,12}$/);
 assert.equal(first.body.expiresAt,null);
 const second={};
 await handler(req({sku:'trial-xtream-1d'}),second,route('/api/v1/store/trials/claim'));
 assert.equal(second.status,200);
 assert.equal(second.body.alreadyClaimed,true);
 assert.equal(second.body.channel,'app');
 assert.equal(second.body.code,first.body.code);
 assert.equal(state.stock.filter(x=>x.customer_id).length,1);
 const mine={};
 await handler({...req(),method:'GET'},mine,route('/api/v1/store/trials/mine'));
 assert.equal(mine.status,200);
 assert.equal(mine.body.trial.code,first.body.code);
 assert.equal(mine.headers['cache-control'],'no-store, private');
});
test('customer-facing page and owner stock are completely separate from card checkout',()=>{
 const html=readFileSync(new URL('../web/store-trial.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../web/store-trial.js',import.meta.url),'utf8');
 const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const commerce=readFileSync(new URL('../src/commercial-handlers.mjs',import.meta.url),'utf8');
 const account=readFileSync(new URL('../src/store-customer-account.mjs',import.meta.url),'utf8');
 const adminHtml=readFileSync(new URL('../web/store-inventory.html',import.meta.url),'utf8');
 const adminJs=readFileSync(new URL('../web/store-inventory.js',import.meta.url),'utf8');
 for(const label of ['trial-stream-stock','trial-xtream-stock','trial-result-code',
  'trial-claim-stream','trial-claim-xtream'])
  assert.ok(html.includes('id="'+label+'"'));
 for(const label of ['trial-stock-admin','trial-stock-generate','trial-stock-quantity',
  'trial-stock-counts'])
  assert.ok(adminHtml.includes('id="'+label+'"'));
 assert.match(js,/x-blofy-trial/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|GeideaCheckout/);
 assert.doesNotThrow(()=>new Function(js));
 assert.doesNotThrow(()=>new Function(adminJs));
 assert.match(server,/serveStoreTrialPage/);
 assert.match(server,/frame-ancestors 'none'/);
 assert.match(commerce,/createStoreTrialInventory/);
 assert.match(account,/handler\.authenticatedCustomer=async req/);
 assert.match(adminJs,/\/api\/v1\/admin\/store\/trials\/generate/);
});

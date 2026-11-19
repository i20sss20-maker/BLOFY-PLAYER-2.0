import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeCodeLedgerRow,createStoreCodeRegister} from '../src/store-code-register.mjs';
import {encryptStreamCode} from '../src/xtream-code-vault.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';

const keyHex='a'.repeat(64);
const id='823f6034-d15c-42ba-b27a-29d93c20a844';
const customerId='304a3c62-bc03-4b16-bfb9-de4ae4c23294';
const code='12345678';
const voucher={
 id,code_hash:streamCodeProof(code,keyHex),code_vault:encryptStreamCode(id,code,keyHex)
};
const entry={
 ...voucher,code_recoverable:true,label:'BLOFY STREAM يوم',
 code_hint:'12••••78',code_channel:'app',dual_access_enabled:false,
 duration_days:1,max_connections:1,
 created_at:'2026-11-18T10:00:00.000Z',redeemed_at:null,
 expires_at:null,account_id:null,redeemed_device_hash:null,revoked_at:null,
 trial_sku:'trial-stream-1d',paid_sku:null,claimed_at:'2026-11-19T12:00:00.000Z',
 stock_sold_at:null,sold_at:null,transfer_count:0,admin_relogin_count:0,
 customer_id:customerId,email:'owner-of-voucher@example.test',
 full_name:'مختبر بلوفي',phone_e164:'+966551234567',
 order_id:null,public_order_number:null,order_status:null,buyer_name:null,buyer_phone:null
};
const json=(res,status,payload,headers)=>{
 Object.assign(res,{status,payload,headers});return payload;
};
function fixture(allow=true) {
 const calls=[];
 let released=0;
 const connection={
  async query(sql,args=[]){
   calls.push({scope:'transaction',sql,args});
   if(sql.startsWith('SELECT id,code_hash,code_vault,revoked_at FROM'))
     return {rows:[{...voucher,revoked_at:null}]};
   return {rows:[],rowCount:1};
  },
  release(){released++;}
 };
 const pool={
  async query(sql,args=[]){
   calls.push({scope:'pool',sql,args});
   if(sql.includes('WITH enriched AS'))return {rows:[{...entry,matched:1}]};
   return {rows:[],rowCount:0};
  },
  async connect(){return connection;}
 };
 const handle=createStoreCodeRegister({
  pool,json,keyHex,readJson:async req=>req.body,
  authorizeAdmin:()=>allow,ensureSchema:async()=>{}
 });
 return {handle,calls,get released(){return released;}};
}
test('unified ledger safely categorizes trial claim with verified email, name and phone',()=>{
 const safe=safeCodeLedgerRow(entry);
 assert.equal(safe.kind,'trial');
 assert.equal(safe.status,'delivered');
 assert.equal(safe.customer.email,'owner-of-voucher@example.test');
 assert.equal(safe.customer.name,'مختبر بلوفي');
 assert.equal(safe.customer.phone,'+966551234567');
 assert.equal(safe.codeHint,'12••••78');
 assert.equal(safe.canReveal,true);
 assert.equal(safe.canRelogin,false);
 assert.equal(safe.activatedAt,null);
 assert.equal(safe.expiresAt,null);
 assert.ok(!JSON.stringify(safe).includes(code),'no plaintext voucher in list');
 assert.ok(!JSON.stringify(safe).includes(voucher.code_vault),'no encrypted secret in list');
});
test('active code may use existing one-time admin relogin without resetting subscription',()=>{
 const active=safeCodeLedgerRow({...entry,claimed_at:null,trial_sku:null,paid_sku:'stream-3m',
  redeemed_at:'2026-11-19T12:00:00Z',expires_at:'2027-02-19T12:00:00Z',
  redeemed_device_hash:'a'.repeat(64),account_id:customerId,
  dual_access_enabled:true,stock_sold_at:'2026-11-19T11:00:00Z'},Date.parse('2026-11-19T20:00:00Z'));
 assert.equal(active.kind,'paid');
 assert.equal(active.canRelogin,true);
 assert.equal(active.manager.status,'redeemed');
 assert.equal(active.manager.expiresAt,Date.parse('2027-02-19T12:00:00Z'));
 const expired=safeCodeLedgerRow({...entry,revoked_at:'2026-11-19T12:30:00Z'});
 assert.equal(expired.canReveal,false);
});
test('admin-only pagination and search use parameterized query without plaintext bulk output',async()=>{
 const f=fixture();
 const res={};
 assert.equal(await f.handle({},res,new URL('https://blofyplayer.com/api/v1/admin/store/codes/register?kind=trial&state=delivered&q=0551234567')),true);
 assert.equal(res.status,200);
 assert.equal(res.payload.matched,1);
 assert.equal(res.payload.items[0].kind,'trial');
 const query=f.calls.find(x=>x.sql.includes('WITH enriched AS'));
 assert.ok(query);
 assert.equal(query.args[0],'0551234567');
 assert.equal(query.args[2],'+966551234567');
 assert.equal(query.args[3],'trial');
 assert.equal(query.args[4],'delivered');
 assert.ok(!JSON.stringify(res.payload).includes(code));
 assert.equal(res.headers['cache-control'],'no-store, private');
});
test('owner-only reveal verifies stored code and writes an audit event without secrets',async()=>{
 const f=fixture();
 const res={};
 const handled=await f.handle({headers:{},body:{voucherId:id,purpose:'customer_support'}},
  res,new URL('https://blofyplayer.com/api/v1/admin/store/codes/reveal'));
 assert.equal(handled,true);
 assert.equal(res.status,200);
 assert.equal(res.payload.code,code);
 assert.equal(f.released,1);
 const audit=f.calls.find(x=>x.sql.includes('owner_code_revealed_for_support')||
  x.sql.startsWith('INSERT INTO blofy_xtream_gateway_code_events'));
 assert.ok(audit,'reveals are logged for owner audit');
 assert.ok(!JSON.stringify(audit).includes(code),'audit must not contain raw voucher');
 assert.ok(f.calls.some(x=>x.sql==='COMMIT'));
});
test('non-admin cannot list customer details or reveal vouchers',async()=>{
 const f=fixture(false);
 const res={};
 assert.equal(await f.handle({},res,
  new URL('https://blofyplayer.com/api/v1/admin/store/codes/register')),true);
 assert.equal(await f.handle({body:{voucherId:id,purpose:'customer_support'}},res,
  new URL('https://blofyplayer.com/api/v1/admin/store/codes/reveal')),true);
 assert.equal(f.calls.length,0);
});
test('invalid owner search filters are rejected before touching database',async()=>{
 const f=fixture();
 const res={};
 await f.handle({},res,new URL(
  'https://blofyplayer.com/api/v1/admin/store/codes/register?kind=account_password'));
 assert.equal(res.status,400);
 assert.equal(f.calls.length,0);
});
test('one visible code register includes paid/free/manual lookup and re-login manager',()=>{
 const html=readFileSync(new URL('../web/blofy-one.html',import.meta.url),'utf8');
 const center=readFileSync(new URL('../web/blofy-one-code-center.js',import.meta.url),'utf8');
 const script=readFileSync(new URL('../web/blofy-one-code-register.js',import.meta.url),'utf8');
 const css=readFileSync(new URL('../web/blofy-one-code-register.css',import.meta.url),'utf8');
 assert.match(html,/blofy-one-code-register\.js/);
 assert.match(html,/blofy-one-code-register\.css/);
 assert.match(center,/one-code-register/);
 assert.match(center,/data-plan-product|one-register-kind/);
 assert.match(script,/\/api\/v1\/admin\/store\/codes\/register/);
 assert.match(script,/\/api\/v1\/admin\/store\/codes\/reveal/);
 assert.match(script,/blofy-one:manage-code/);
 assert.match(script,/codeBox\.textContent=''/);
 assert.match(script,/customer\.phone/);
 assert.match(css,/one-register-detail-fields/);
 assert.doesNotThrow(()=>new Function(center));
 assert.doesNotThrow(()=>new Function(script));
});

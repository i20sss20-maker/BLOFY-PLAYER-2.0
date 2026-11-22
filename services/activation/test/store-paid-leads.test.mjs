import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {listPaidLeads,renderPaidLead,preparePaidLeadSchema,updatePaidLeadFollowup}
 from '../src/store-paid-leads.mjs';
import {createStoreCustomerHandlers} from '../src/store-customer-account.mjs';

const keyHex='a'.repeat(64);
const ORDER='abc11234-56ab-4567-89ab-abcd1234faac';
const CUSTOMER='a8c01234-56ab-4567-89ab-abcd1234faaf';
const row={
 order_id:ORDER,public_order_number:'BF-20261122-CUSTOMER',
 sku:'cart',channel:'app',amount_minor:4900,
 created_at:new Date('2026-11-21T19:00:00Z'),
 paid_at:new Date('2026-11-21T19:02:00Z'),
 customer_id:CUSTOMER,full_name:'Test Buyer',email:'buyer@example.test',
 phone_e164:'+966555000234',marketing_consent_at:null,
 code_count:2,activated_count:1,
 first_activated_at:new Date('2026-11-21T20:00:00Z'),
 last_expires_at:new Date('2027-11-21T20:00:00Z'),
 followup_status:'new',followup_note:null,followup_updated_at:null,matched:1
};
const route=pathname=>({pathname});
const json=(res,status,body,headers)=>Object.assign(res,{status,body,headers});
const req=(payload={},admin=false)=>({
 method:'POST',
 headers:{origin:'https://blofyplayer.com','content-type':'application/json',
  'sec-fetch-site':'same-origin',cookie:'__Host-blofy_customer='+('A'.repeat(43)),
  ...(admin?{'x-demo-admin':'1'}:{})},
 payload
});
const readJson=async request=>request.payload;

test('paid order is not confused with a free trial and only exposes verified linked contact',()=>{
 const lead=renderPaidLead(row);
 assert.equal(lead.recordedPaid,true);
 assert.equal(lead.orderId,ORDER);
 assert.equal(lead.customer.name,'Test Buyer');
 assert.equal(lead.customer.phone,'+966555000234');
 assert.equal(lead.customer.verifiedEmail,true);
 assert.equal(lead.amountMinor,4900);
 assert.equal(lead.codeCount,2);
 assert.equal(lead.activatedCount,1);
 assert.equal(lead.paidAt,'2026-11-21T19:02:00.000Z');
 assert.equal(lead.marketingOptIn,false);
 assert.ok(!JSON.stringify(lead).includes('code_hash'));
 assert.equal(renderPaidLead({...row,customer_id:null}).customer,null,
  'legacy guest orders must never inherit another customer\'s identity');
});
test('bounded owner list returns real paid orders, not pending, with safe SQL params',async()=>{
 const calls=[];
 const pool={query:async(sql,params)=>{calls.push({sql,params});return {rows:[row]};}};
 const data=await listPaidLeads(pool,{q:'+966555000234',channel:'all',followup:'all',offset:0});
 assert.equal(data.ok,true);
 assert.equal(data.items.length,1);
 assert.equal(data.matched,1);
 assert.equal(data.readOnly,true);
 assert.equal(data.nextOffset,null);
 assert.match(calls[0].sql,/WHERE o.status='paid'/);
 assert.match(calls[0].sql,/LEFT JOIN blofy_store_customer_orders/);
 assert.match(calls[0].sql,/LEFT JOIN blofy_store_customers/);
 assert.match(calls[0].sql,/blofy_store_cart_vouchers/);
 assert.match(calls[0].sql,/blofy_store_renewal_orders/);
 assert.deepEqual(calls[0].params,['+966555000234','all','all',0]);
 assert.ok(!calls[0].sql.includes('+966555000234'),'never interpolate phone into SQL');
 for(const search of [{q:'a'},{offset:1000000},{followup:'code'},
  {channel:'unknown'},{q:'x'.repeat(101)}])
  await assert.rejects(listPaidLeads(pool,search),/paid_leads_filters_invalid/);
 assert.equal(calls.length,1);
});
test('paid followup schema is separate and does not alter orders',async()=>{
 const sql=[];
 await preparePaidLeadSchema({query:async query=>{sql.push(query);return {rows:[]};}});
 assert.equal(sql.length,2);
 assert.ok(sql.every(x=>x.includes('CREATE TABLE IF NOT EXISTS')));
 assert.ok(sql.every(x=>!/(UPDATE|DELETE FROM) blofy_store_geidea_orders/i.test(x)));
});
function followupFixture({paid=true,consent=false,prior='new'}={}){
 const queries=[];
 const db={release(){},async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.includes('SELECT o.id,o.status,c.marketing_consent_at'))
   return {rows:[{id:ORDER,status:paid?'paid':'pending',
     marketing_consent_at:consent?new Date():null,
     followup_status:prior}]};
  return {rows:[]};
 }};
 return {queries,pool:{connect:async()=>db}};
}
test('manual service follow-up saves status+note, never sends messages',async()=>{
 const f=followupFixture();
 const x=await updatePaidLeadFollowup(f.pool,{orderId:ORDER,
  followupStatus:'contacted',note:'تم حل مشكلة رمز العميل'});
 assert.equal(x.saved,true);
 assert.equal(x.followupStatus,'contacted');
 assert.ok(f.queries.some(x=>x.sql.includes('FOR UPDATE OF o')));
 const audit=f.queries.find(x=>x.sql.includes('INSERT INTO blofy_store_paid_followup_events'));
 assert.deepEqual(audit.params,[ORDER,'contacted']);
 const change=f.queries.find(x=>x.sql.includes('INSERT INTO blofy_store_paid_followups'));
 assert.deepEqual(change.params,[ORDER,'contacted','تم حل مشكلة رمز العميل']);
 assert.doesNotMatch(audit.sql,/email|phone|password|wa\.me/i);
 assert.ok(!f.queries.some(x=>/Geidea|checkout|redeem|payment|send/i.test(x.sql)&&
   /UPDATE blofy_store_geidea_orders/i.test(x.sql)));
});
test('marketing offers require explicit consent and honor do-not-contact',async()=>{
 const no=foll=>followupFixture(foll);
 const unconsented=no();
 await assert.rejects(updatePaidLeadFollowup(unconsented.pool,{
  orderId:ORDER,followupStatus:'offer_sent',note:'عرض جديد'
 }),/paid_lead_marketing_consent_required/);
 assert.ok(!unconsented.queries.some(x=>x.sql.includes('INSERT INTO blofy_store_paid_followups')));
 const opted=no({consent:true});
 const ok=await updatePaidLeadFollowup(opted.pool,{
  orderId:ORDER,followupStatus:'offer_sent',note:'عرض مسموح'
 });
 assert.equal(ok.followupStatus,'offer_sent');
 const stopped=no({consent:true,prior:'do_not_contact'});
 await assert.rejects(updatePaidLeadFollowup(stopped.pool,{
  orderId:ORDER,followupStatus:'offer_sent'
 }),/paid_lead_do_not_contact/);
 const pending=no({paid:false,consent:true});
 await assert.rejects(updatePaidLeadFollowup(pending.pool,{
  orderId:ORDER,followupStatus:'contacted'
 }),/paid_lead_not_found/);
});
test('unprivileged requester cannot fetch paid buyer emails or phones',async()=>{
 const pool={async connect(){throw Error('unprivileged should not connect')},
  async query(){throw Error('unprivileged should not query')}};
 const handler=createStoreCustomerHandlers({pool,json,readJson,keyHex,
  env:{BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'false'},authorizeAdmin:()=>false});
 for(const path of ['/api/v1/admin/store/paid-leads',
  '/api/v1/admin/store/paid-leads/followup']){
  const result={};
  assert.equal(await handler(req({q:''}),result,route(path)),true);
  assert.equal(result.body,undefined);
 }
});
test('customer may opt in and opt out for offers independently of expiry reminders',async()=>{
 const queries=[];
 const db={release(){},async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.includes('FROM blofy_store_customer_sessions s'))
   return {rows:[{id:CUSTOMER,email:'buyer@example.test',
    full_name:'Buyer',phone_e164:'+966555000234',
    alerts_opt_in:true,marketing_consent_at:null}]};
  if(sql.includes('UPDATE blofy_store_customers')&&sql.includes('marketing_consent_at'))
   return {rowCount:1,rows:[{marketing_consent_at:params[1]?
      new Date('2026-11-22T00:00:00Z'):null}]};
  return {rowCount:1,rows:[]};
 }};
 const pool={connect:async()=>db,query:db.query.bind(db)};
 const handler=createStoreCustomerHandlers({pool,json,readJson,keyHex,
  env:{BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true'},sendCode:async()=>{},
  authorizeAdmin:()=>false});
 const on={},off={};
 await handler(req({marketingOptIn:true}),on,route('/api/v1/store/account/marketing-preferences'));
 await handler(req({marketingOptIn:false}),off,route('/api/v1/store/account/marketing-preferences'));
 assert.equal(on.status,200);assert.equal(on.body.marketingOptIn,true);
 assert.equal(off.status,200);assert.equal(off.body.marketingOptIn,false);
 assert.ok(queries.filter(x=>x.sql.includes('UPDATE blofy_store_customers')&&
   x.sql.includes('marketing_consent_at')).length===2);
 assert.ok(queries.every(x=>!x.sql.includes('SET alerts_opt_in')));
});
test('admin UI includes buyer table, Saudi time, and no automatic outreach',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const html=read('web/blofy-one.html');
 const js=read('web/blofy-one-paid-leads.js');
 const css=read('web/blofy-one-paid-leads.css');
 const account=read('web/store-account.html');
 const accountJS=read('web/store-account.js');
 const server=read('src/store-customer-account.mjs');
 const allow=read('src/admin-console-hook.mjs');
 assert.match(html,/one-paid-leads-rows/);
 assert.match(html,/one-paid-lead-followup-form/);
 assert.match(html,/blofy-one-paid-leads\.js/);
 assert.match(allow,/\['\/blofy-one-paid-leads\.js'/);
 assert.match(allow,/\['\/blofy-one-paid-leads\.css'/);
 assert.match(js,/Asia\/Riyadh/);
 assert.match(js,/paid-leads\/followup/);
 assert.match(js,/marketingOptIn/);
 assert.match(js,/wa\.me/);
 assert.match(js,/no-store/);
 assert.match(css,/one-paid-leads/);
 assert.match(account,/account-marketing-optin/);
 assert.match(accountJS,/marketing-preferences/);
 assert.match(server,/marketing_consent_at/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|innerHTML|document\.cookie|sendEmail|sendSMS/);
 assert.doesNotThrow(()=>new Function(js));
 assert.doesNotThrow(()=>new Function(accountJS));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 safeTrialLead,listTrialLeads,updateTrialLeadFollowup,FOLLOWUP_STATES
} from '../src/store-trial-leads.mjs';
import {createStoreTrialInventory} from '../src/store-trial-inventory.mjs';

const keyHex='a'.repeat(64),id='e06e09f5-2e33-4522-a093-4f0a55a550fd';
const customerId='70c612f1-67cd-461d-9bd1-0d17244d6c38';
const item={
 voucher_id:id,sku:'trial-xtream-1d',code_hint:'12****78',
 claimed_at:new Date('2026-11-21T18:05:30.574Z'),
 redeemed_at:null,expires_at:null,revoked_at:null,
 email:'buyer@example.test',full_name:'Customer Test',
 phone_e164:'+966555000123',marketing_consent_at:null,
 followup_status:'new',followup_note:null,followup_updated_at:null,matched:1
};
const response=(res,code,body,headers)=>Object.assign(res,{code,body,headers});
const route=pathname=>({pathname});
const req=(payload={},headers={})=>({
 method:'POST',payload,headers:{origin:'https://blofyplayer.com',
  'content-type':'application/json','x-blofy-trial':'1',...headers},
 socket:{remoteAddress:'127.0.0.1'}
});

test('owner trial lead row joins a verified customer rather than guessing from request IP',()=>{
 const lead=safeTrialLead(item,Date.UTC(2026,10,22));
 assert.equal(lead.customer.email,'buyer@example.test');
 assert.equal(lead.customer.name,'Customer Test');
 assert.equal(lead.customer.phone,'+966555000123');
 assert.equal(lead.claimedAt,'2026-11-21T18:05:30.574Z');
 assert.equal(lead.channel,'xtream');
 assert.equal(lead.state,'unactivated');
 assert.equal(lead.marketingOptIn,false,'older trials must never imply consent');
 assert.equal(lead.followupStatus,'new');
 assert.ok(!('password' in lead));
 assert.ok(!('code' in lead));
 const active=safeTrialLead({...item,redeemed_at:new Date('2026-11-21T19:00:00Z'),
  expires_at:new Date('2026-11-22T19:00:00Z')},Date.UTC(2026,10,22));
 assert.equal(active.state,'active');
 assert.equal(safeTrialLead({...item,revoked_at:new Date()},Date.now()).state,'revoked');
});

test('owner lead search is bounded, parameterized, paginated, and returns no voucher secrets',async()=>{
 const statements=[];
 const pool={query:async(sql,params)=>{
  statements.push({sql,params});return {rows:[item]};
 }};
 const res=await listTrialLeads(pool,{q:'Customer Test',sku:'trial-xtream-1d',
  state:'unactivated',offset:0});
 assert.equal(res.ok,true);
 assert.equal(res.matched,1);
 assert.equal(res.items.length,1);
 assert.equal(res.items[0].customer.phone,'+966555000123');
 assert.match(statements[0].sql,/LEFT JOIN blofy_store_customers/);
 assert.match(statements[0].sql,/i\.customer_id/);
 assert.match(statements[0].sql,/i\.claimed_at IS NOT NULL/);
 assert.deepEqual(statements[0].params,['Customer Test','trial-xtream-1d','unactivated',0]);
 assert.ok(!statements[0].sql.includes('Customer Test'));
 assert.ok(!JSON.stringify(res).includes('code_vault'));
 assert.ok(!JSON.stringify(res).includes('code_hash'));
 for(const body of [{q:'X'},{q:'x'.repeat(101)},
  {offset:-1},{offset:NaN},{offset:9999999999},{sku:'all);drop table users'},
  {state:'unknown'}])await assert.rejects(listTrialLeads(pool,body),/trial_leads_filters_invalid/);
 assert.equal(statements.length,1,'invalid filters must not access the DB');
});

function contactPool({consent=false,currentStatus='new'}={}){
 let selected={voucher_id:id,marketing_consent_at:consent?new Date():null,
  followup_status:currentStatus};
 const queries=[];
 const db={
  release(){},
  async query(sql,args=[]){
   queries.push({sql,args});
   if(sql.includes('SELECT voucher_id,marketing_consent_at,followup_status'))
    return {rows:[selected]};
   if(sql.startsWith('UPDATE blofy_store_trial_inventory')){
    selected={...selected,followup_status:args[1]};return {rows:[]};
   }
   return {rows:[]};
  }
 };
 return {pool:{connect:async()=>db},queries};
}
test('operators can log a follow-up safely without emailing or texting customer automatically',async()=>{
 const f=contactPool({consent:true});
 const res=await updateTrialLeadFollowup(f.pool,{
  voucherId:id,followupStatus:'offer_sent',note:'عرض 49 ر.س سنويًا'});
 assert.equal(res.followupStatus,'offer_sent');
 assert.ok(FOLLOWUP_STATES.includes(res.followupStatus));
 const query=f.queries.map(x=>x.sql).join('\n');
 assert.match(query,/FOR UPDATE/);
 assert.match(query,/INSERT INTO blofy_store_trial_followup_events/);
 assert.doesNotMatch(query,/sendEmail|sendSMS|sendWhatsapp|geidea/i);
 const audit=f.queries.find(x=>x.sql.includes('INSERT INTO blofy_store_trial_followup_events'));
 assert.deepEqual(audit.args,[id,'offer_sent']);
 assert.ok(!JSON.stringify(audit).includes('49 ر.س'));
 const write=f.queries.find(x=>x.sql.startsWith('UPDATE blofy_store_trial_inventory'));
 assert.deepEqual(write.args,[id,'offer_sent','عرض 49 ر.س سنويًا']);
});
test('promotional offers are denied for historical, unconsented trials',async()=>{
 const f=contactPool();
 await assert.rejects(updateTrialLeadFollowup(f.pool,{
  voucherId:id,followupStatus:'offer_sent',note:'promo'}),
 /trial_marketing_consent_required/);
 assert.ok(!f.queries.some(x=>x.sql.startsWith('UPDATE blofy_store_trial_inventory')));
 assert.ok(f.queries.some(x=>x.sql==='ROLLBACK'));
});
test('do-not-contact is honored, invalid notes do not get saved',async()=>{
 const f=contactPool({consent:true,currentStatus:'do_not_contact'});
 await assert.rejects(updateTrialLeadFollowup(f.pool,{
  voucherId:id,followupStatus:'offer_sent',note:'hello'}),/trial_do_not_contact/);
 await assert.rejects(updateTrialLeadFollowup(f.pool,{
  voucherId:id,followupStatus:'contacted',note:'long'.repeat(100)}),
 /trial_followup_invalid/);
 assert.ok(!f.queries.some(x=>x.sql.startsWith('UPDATE blofy_store_trial_inventory')));
});
test('public caller cannot read admin trial lead personal information',async()=>{
 let queries=0;
 const pool={
  async connect(){throw Error('unauthorized should not connect')},
  async query(){queries++;throw Error('unauthorized should not query')}
 };
 const handler=createStoreTrialInventory({
  pool,json:response,readJson:async r=>r.payload,keyHex,
  authorizeAdmin:()=>false,getAuthenticatedCustomer:async()=>null,
  env:{BLOFY_STORE_TRIALS_ENABLED:'false'}
 });
 const res={};
 assert.equal(await handler(req({q:''}),res,route('/api/v1/admin/store/trials/leads')),true);
 assert.equal(queries,0);
 assert.equal(res.body,undefined);
 const followup={};
 assert.equal(await handler(req({voucherId:id,followupStatus:'contacted'}),
  followup,route('/api/v1/admin/store/trials/leads/followup')),true);
 assert.equal(followup.body,undefined);
 assert.equal(queries,0);
});
test('BLOFY ONE links verified trial leads, user consent and follow-up without public PII',()=>{
 const base=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const admin=base('web/blofy-one-code-center.js'),
  ui=base('web/blofy-one-trial-leads.js'),
  css=base('web/blofy-one-trial-leads.css'),
  html=base('web/blofy-one.html'),
  customer=base('web/store-trial.html'),
  claim=base('web/store-trial.js'),
  server=base('src/store-trial-inventory.mjs'),
  allow=base('src/admin-console-hook.mjs');
 assert.match(admin,/one-trial-leads-rows/);
 assert.match(admin,/one-trial-lead-dialog/);
 assert.match(admin,/one-trial-lead-followup-status/);
 assert.match(admin,/blofy-one:trial-leads-visible/);
 assert.match(html,/blofy-one-trial-leads\.js/);
 assert.match(allow,/\['\/blofy-one-trial-leads\.js'/);
 assert.match(allow,/\['\/blofy-one-trial-leads\.css'/);
 assert.match(ui,/Asia\/Riyadh/);
 assert.match(ui,/trial_lead/i);
 assert.match(ui,/marketingOptIn/);
 assert.match(ui,/no-store/);
 assert.match(css,/one-trial-leads/);
 assert.match(customer,/id="trial-marketing-opt-in"/);
 assert.match(customer,/type="checkbox"/);
 assert.match(customer,/الموافقة ليست شرطًا/);
 assert.match(claim,/marketingOptIn:\$\('trial-marketing-opt-in'\)\.checked===true/);
 assert.match(claim,/contact-preferences/);
 assert.match(server,/marketing_consent_at/);
 assert.match(server,/adminFollowup/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|CSV|innerHTML|document\.cookie/);
 assert.doesNotThrow(()=>new Function(ui));
 assert.doesNotThrow(()=>new Function(admin));
 assert.doesNotThrow(()=>new Function(claim));
});

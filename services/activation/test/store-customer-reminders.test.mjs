import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerReminderEngine,reminderConfig} from '../src/store-customer-reminders.mjs';

test('expiry email loop requires separate explicit opt-in flag and sender',()=>{
 const env={BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
  BLOFY_CUSTOMER_REMINDERS_ENABLED:'true',BLOFY_CUSTOMER_RESEND_API_KEY:'re_test',
  BLOFY_CUSTOMER_MAIL_FROM:'BLOFY <support@example.com>'};
 assert.equal(reminderConfig(env).enabled,true);
 for(const key of Object.keys(env)){
  assert.equal(reminderConfig({...env,[key]:''}).enabled,false,key);
 }
});

test('multiple expiry checks send at most one consented reminder per code',async()=>{
 const cfg={BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
  BLOFY_CUSTOMER_REMINDERS_ENABLED:'true',BLOFY_CUSTOMER_RESEND_API_KEY:'re_test',
  BLOFY_CUSTOMER_MAIL_FROM:'BLOFY <support@example.com>'};
 const recipient='person@example.com';
 const customer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const voucher='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const expiry=new Date(Date.now()+5*86400000);
 const jobs=new Map();
 const sent=[];
 const rows=(a=[])=>({rows:a,rowCount:a.length});
 const db={async query(sql,args=[]){
  sql=String(sql);
  if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.startsWith('SELECT pg_advisory')||
    sql.startsWith('CREATE TABLE'))return rows();
  if(sql.startsWith('SELECT to_regclass('))return rows([{
   t0:'a',t1:'b',t2:'c',t3:'d',t4:'e',t5:'f'
  }]);
  if(sql.includes('SELECT DISTINCT customer_id,voucher_id'))
   return rows([{customer_id:customer,voucher_id:voucher}]);
  if(sql.startsWith('INSERT INTO blofy_store_customer_reminders')){
   const key=args.join(':');
   if(jobs.has(key))return rows();
   jobs.set(key,{customer_id:args[0],voucher_id:args[1],attempts:0,lease_until:null,sent_at:null});
   return {rows:[],rowCount:1};
  }
  if(sql.startsWith('WITH todo AS (')){
   const eligible=[...jobs.values()].filter(j=>!j.sent_at&&j.attempts<3&&
    (!j.lease_until||j.lease_until<Date.now()));
   for(const j of eligible){j.attempts++;j.lease_until=Date.now()+300000;}
   return rows(eligible);
  }
  if(sql.startsWith('SELECT c.email,v.expires_at FROM blofy_store_customers'))
   return rows(args[0]===customer&&args[1]===voucher?[{email:recipient,expires_at:expiry}]:[]);
  if(sql.startsWith('UPDATE blofy_store_customer_reminders SET sent_at=NOW()')){
   const j=jobs.get(args.join(':'));j.sent_at=new Date();return rows();
  }
  throw Error('Unexpected SQL: '+sql.slice(0,240));
 },release(){}};
 const engine=createCustomerReminderEngine({
  pool:{query:(...args)=>db.query(...args),connect:async()=>db},env:cfg,
  sendEmail:async(to,message,idempotencyKey)=>{sent.push({to,message,idempotencyKey});}
 });
 assert.equal(engine.configured,true);
 const first=await engine.run(),again=await engine.run();
 assert.equal(first.sent,1);
 assert.equal(again.sent,0);
 assert.equal(sent.length,1);
 assert.equal(sent[0].to,recipient);
 assert.match(sent[0].idempotencyKey,/^blofy-expiry-v1-/);
 assert.match(sent[0].message.text,/blofyplayer.com\/store\/account/);
 assert.equal(sent[0].message.text.includes(voucher),false);
 assert.equal(sent[0].message.text.includes('code'),false);
 assert.equal(jobs.size,1);
});

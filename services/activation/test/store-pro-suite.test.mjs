import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {safeGuideMessage,guideReply,assistantEnabled,createStoreAssistantHandlers}
 from '../src/store-assistant.mjs';
import {cartRecoveryEnabled,createCartRecoveryEngine} from '../src/store-cart-recovery.mjs';
import {publicStoreProFlags,createStoreProReadinessHandlers} from '../src/store-pro-readiness.mjs';
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('BLOFY shopping guide explains safe routes without asking customers for secrets',()=>{
 const renewal=guideReply('كيف أجدد اشتراكي؟');
 assert.equal(renewal.mode,'guide');
 assert.equal(renewal.url,'/store/account');
 assert.match(renewal.answer,/تجديد/);
 assert.equal(guideReply('كيف استلم كودي؟').url,'/store/orders');
 assert.equal(guideReply('وش يشتغل على اندرويد؟').url,'/products/xtream');
 assert.equal(guideReply('ابل باي').url,'/store/cart');
 assert.equal(safeGuideMessage('A'.repeat(501)),null);
 assert.equal(safeGuideMessage('\u0001danger'),null);
 assert.equal(safeGuideMessage(' سؤال '),'سؤال');
 assert.equal(assistantEnabled({}),false);
});
test('public guide is rate-limited and uses no OpenAI API without explicit opt-in',async()=>{
 let apiCalls=0;
 const handler=createStoreAssistantHandlers({
  json:(res,status,body)=>{res.status=status;res.data=body;},
  readJson:async()=>({message:'كيف اجدد كودي؟'}),
  requestClientKey:()=> 'test-visitor',
  env:{OPENAI_API_KEY:'sk-this-is-not-enabled',BLOFY_STORE_AI_ENABLED:'false'},
  fetchImpl:async()=>{apiCalls++;throw Error('must not send to external AI');}
 });
 const target={pathname:'/api/v1/store/assistant'};
 const res={};await handler({method:'POST',headers:{origin:'https://blofyplayer.com'}},res,target);
 assert.equal(res.status,200);
 assert.equal(res.data.mode,'guide');
 assert.equal(apiCalls,0);
 const other={};
 await handler({method:'POST',headers:{origin:'https://attacker.example'}},other,target);
 assert.equal(other.status,403);
 let last;
 for(let i=0;i<12;i++){last={};await handler({method:'POST',headers:{}},last,target);}
 assert.equal(last.status,429);
});
test('marketing consent is explicit and separate from expiry reminders',()=>{
 const account=read('../src/store-customer-account.mjs');
 const html=read('../web/store-account.html');
 const client=read('../web/store-account.js');
 assert.match(account,/ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE/);
 assert.match(account,/marketing_opt_in_at/);
 assert.match(account,/invalid_marketing_preferences/);
 assert.match(account,/api\/v1\/store\/account\/marketing-preferences/);
 assert.match(account,/alertsOptIn:customer\.alerts_opt_in,marketingOptIn:customer\.marketing_opt_in===true/);
 assert.match(html,/id="marketing-optin"/);
 assert.match(html,/الموافقة منفصلة/);
 assert.match(client,/marketing-preferences/);
 assert.match(client,/marketingOptIn===true/);
});
test('abandoned carts cannot trigger email without provider and explicit operator opt-in',async()=>{
 const disabled={BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
  BLOFY_CUSTOMER_RESEND_API_KEY:'re_test_only',BLOFY_CUSTOMER_MAIL_FROM:'store@example.com'};
 assert.equal(cartRecoveryEnabled(disabled),false);
 assert.equal(cartRecoveryEnabled({...disabled,BLOFY_STORE_CART_RECOVERY_ENABLED:'true'}),true);
 let touched=0;
 const engine=createCartRecoveryEngine({
  pool:{connect:()=>{touched++;throw Error('db should not be reached');},query:()=>{touched++;throw Error('db should not be reached');}},
  env:disabled,sendEmail:()=>{touched++;throw Error('no send');}
 });
 assert.equal(engine.start(),false);
 assert.deepEqual(await engine.run(),{enabled:false});
 assert.equal(touched,0);
 const code=read('../src/store-cart-recovery.mjs');
 assert.match(code,/u\.marketing_opt_in=TRUE/g);
 assert.match(code,/status='paid'/g);
 assert.match(code,/lease_until/);
 assert.match(code,/Idempotency-Key/);
 assert.match(code,/ON CONFLICT DO NOTHING/);
 assert.match(code,/BLOFY_STORE_CART_RECOVERY_ENABLED==='true'/);
});
test('BLOFY PRO readiness is admin-only and never exposes payment keys',async()=>{
 const flags=publicStoreProFlags({});
 assert.equal(flags.payment.applePayVisible,false);
 assert.equal(flags.assistant.aiConfigured,false);
 assert.equal(flags.marketing.bulkMessagesEnabled,false);
 const handler=createStoreProReadinessHandlers({
  pool:{query:()=>{throw Error('db query before authentication');}},
  json:(res,status,body)=>{res.status=status;res.body=body;},
  authorizeAdmin:(req,res)=>{res.status=401;return false;}
 });
 const res={};
 await handler({method:'GET'},res,{pathname:'/api/v1/admin/store/pro-readiness'});
 assert.equal(res.status,401);
});
test('dashboard and new assistant UI wiring are present without changing checkout',()=>{
 const page=read('../web/store.html'),admin=read('../web/store-inventory.html');
 const js=read('../web/store-assistant.js'),server=read('../src/server.mjs');
 for(const id of ['blofy-assistant','blofy-assistant-input','blofy-assistant-panel',
  'blofy-assistant-messages','blofy-assistant-toggle'])assert.match(page,new RegExp('id="'+id+'"'));
 for(const id of ['commercial-metrics','commercial-trend','commercial-period','merchandising-form',
  'merch-slide-0-title','merch-slide-1-title','store-pro-status','store-pro-refresh'])
  assert.match(admin,new RegExp('id="'+id+'"'));
 assert.match(server,/createStoreAssistantHandlers/);
 assert.match(server,/createStoreProReadinessHandlers/);
 assert.match(server,/\/store\/assistant\.js/);
 assert.match(server,/storeCommercialInsights\(req,res,requestUrl\)/);
 assert.match(server,/storeMerchandising\(req,res,requestUrl\)/);
 assert.doesNotThrow(()=>new Function(js));
 assert.match(page,/data-cart-add="stream"/);
 assert.match(page,/data-cart-add="xtream"/);
 assert.match(page,/id="bundle-add-cart"/);
});

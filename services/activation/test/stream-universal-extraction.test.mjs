import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {createStreamDurationCodes,streamCodeProof}
 from '../src/xtream-duration-codes.mjs';
import {createStoreCustomerHandlers}
 from '../src/store-customer-account.mjs';
import {encryptGatewayAccountPassword}
 from '../src/xtream-account-vault.mjs';
import {gatewayCredentialProof} from '../src/xtream-gateway-core.mjs';

const keyHex='a'.repeat(64),code='58472916',now=Date.UTC(2026,10,22,10);
const codeId='6e8919af-4674-445f-b207-c36cb6362add';
const accountId='18de0f14-6b76-478c-8514-27fab80828dc';
const customerId='8b19b319-b272-45a9-ae5c-2b706f605f77';
const source='52eaa162-99b6-493b-9003-59306361f587';
const safe=(a=[])=>({rows:a,rowCount:a.length});

function fixture(channel){
 const record={id:codeId,code_hash:streamCodeProof(code,keyHex),
  code_channel:channel,dual_access_enabled:false,
  source_id:source,label:channel==='app'?'BLOFY STREAM':'Xtream',
  duration_days:30,max_connections:2,account_id:null,
  redeemed_at:null,expires_at:null,revoked_at:null,
  redeemed_device_hash:null,transfer_count:0,extended_days:0,
  created_at:new Date(now),sold_at:new Date(now)};
 let account=null,created=0,duals=0;
 const calls=[];
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return safe();
  if(sql.includes('SELECT * FROM blofy_xtream_gateway_duration_codes')
   &&sql.includes('FOR UPDATE'))
   return safe(record.code_hash===args[0]?[record]:[]);
  if(sql.includes('SET dual_access_enabled=TRUE')){
   duals++;
   if(record.redeemed_at||record.revoked_at||record.account_id)return safe();
   record.dual_access_enabled=true;return safe([{dual_access_enabled:true}]);
  }
  if(sql.includes('FROM blofy_xtream_servers'))return safe([{id:source}]);
  if(sql.includes('INSERT INTO blofy_xtream_gateway_accounts')){
   created++;
   account={id:args[0],username:args[2],password_proof:args[3],
    enabled:true,max_connections:args[4],expires_at:args[5],
    source_id:args[6],credential_vault:args[7]};
   return safe();
  }
  if(sql.includes('SET redeemed_at=$2')){
   assert.equal(record.redeemed_at,null);
   Object.assign(record,{redeemed_at:args[1],expires_at:args[2],
    account_id:args[3],redeemed_device_hash:args[4]});
   return safe([{id:record.id}]);
  }
  if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE id=$1'))
   return safe(account?.id===args[0]?[account]:[]);
  if(sql.includes('SET redeemed_device_hash=$2 WHERE id=$1 AND redeemed_device_hash IS NULL')){
   record.redeemed_device_hash=args[1];return safe([{id:record.id}]);
  }
  throw Error('unexpected SQL: '+sql.slice(0,140));
 };
 return {record,calls,pool:{query,connect:async()=>({query,release(){}})},
  get created(){return created},get duals(){return duals}};
}

for(const channel of ['app','xtream']){
 test('a new '+channel+' voucher extracts ONE Xtream account and remains same subscription for app',async()=>{
  const f=fixture(channel);
  const manager=createStreamDurationCodes({pool:f.pool,keyHex,clock:()=>now});
  if(channel==='app')await assert.rejects(manager.redeem(
   code,'https://y.blofyplayer.com'),/stream_code_wrong_product/);
  assert.equal(f.duals,0);
  const response=await manager.redeem(code,'https://y.blofyplayer.com',{
   webDualAccess:true
  });
  assert.equal(response.ok,true);
  assert.equal(response.credentials.username.length>0,true);
  assert.equal(response.credentials.password.length>0,true);
  assert.equal(response.account.activatedAt,now);
  assert.equal(response.account.expiresAt,now+30*86400000);
  assert.equal(f.record.code_channel,channel,'do not reclassify original product');
  assert.equal(f.record.dual_access_enabled,true);
  assert.equal(f.created,1);
  assert.equal(f.duals,1);
  assert.equal(f.record.redeemed_device_hash,null);
  await assert.rejects(manager.redeem(code,'https://y.blofyplayer.com',{
    webDualAccess:true
  }),/stream_code_unavailable/);
  assert.equal(f.created,1,'web retries must never produce second subscription');
  assert.equal(f.duals,1,'web retries must not modify the account');
  const fromApp=await manager.redeem(code,'https://y.blofyplayer.com',{
   appOnly:true,deviceKey:'b'.repeat(64)
  });
  assert.equal(fromApp.tokenType,'Bearer');
  assert.equal(fromApp.account.activatedAt,now);
  assert.equal(fromApp.account.expiresAt,now+30*86400000);
  assert.equal(f.record.redeemed_device_hash!==null,true);
  assert.equal(f.created,1);
 });
}

test('a previously used STREAM code never becomes anonymously extractable',async()=>{
 const f=fixture('app'),manager=createStreamDurationCodes({pool:f.pool,keyHex,clock:()=>now});
 const app=await manager.redeem(code,'https://y.blofyplayer.com',{
  appOnly:true,deviceKey:'c'.repeat(64)
 });
 assert.ok(app.accessToken);
 assert.equal(f.record.dual_access_enabled,false);
 await assert.rejects(manager.redeem(code,'https://y.blofyplayer.com',{
  webDualAccess:true
 }),/stream_code_unavailable/);
 assert.equal(f.record.dual_access_enabled,false);
 assert.equal(f.duals,0);
 assert.equal(f.created,1);
});
test('revoked unused code cannot be activated from either product',async()=>{
 const f=fixture('app');
 f.record.revoked_at=new Date(now);
 await assert.rejects(createStreamDurationCodes({pool:f.pool,keyHex,clock:()=>now})
  .redeem(code,'https://y.blofyplayer.com',{webDualAccess:true}),
  /stream_code_unavailable/);
 assert.equal(f.duals,0);assert.equal(f.created,0);
});

function customerFixture({owner=true,channel='app',redeemed=true,enabled=true,expiry=Date.now()+86400000}={}){
 const pass='A_SecretTest123',username='ClientSecure12';
 const voucher={
  id:codeId,code_channel:channel,duration_days:30,
  redeemed_at:redeemed?new Date(now):null,
  expires_at:new Date(expiry),revoked_at:null,account_id:accountId,
  account_identity:accountId,username,enabled,
  account_expiry:new Date(expiry),
  credential_vault:encryptGatewayAccountPassword(accountId,pass,keyHex)
 };
 const sql=[];
 const db={
  release(){},async query(query,args=[]){
   sql.push({query,args});
   if(['BEGIN','COMMIT','ROLLBACK'].includes(query)||
      /^(?:CREATE|ALTER|SELECT pg_advisory)/.test(query))return safe();
   if(query.includes('FROM blofy_store_customer_sessions s'))
    return safe([{id:customerId,email:'owner@example.test'}]);
   if(query.includes("to_regclass('public.blofy_store_trial_inventory')"))
    return safe([{table_name:'blofy_store_trial_inventory'}]);
   if(query.includes('FROM blofy_xtream_gateway_duration_codes v')&&
      query.includes('v.code_hash=$2')){
    assert.match(query,/PAID_OWNED|blofy_store_customer_orders/);
    assert.match(query,/blofy_store_trial_inventory/);
    assert.equal(args[0],customerId);
    return safe(owner&&args[1]===streamCodeProof(code,keyHex)?[voucher]:[]);
   }
   throw Error('Unexpected SQL: '+query.slice(0,180));
  }
 };
 const handler=createStoreCustomerHandlers({pool:{
  connect:async()=>db,query:db.query.bind(db)
 },json:(res,status,body,headers)=>Object.assign(res,{status,body,headers}),
  readJson:async req=>req.body,
  env:{BLOFY_CUSTOMER_ACCOUNTS_ENABLED:'true',
   BLOFY_XTREAM_PUBLIC_ORIGIN:'https://y.blofyplayer.com'},
  sendCode:async()=>{},keyHex,authorizeAdmin:()=>false});
 const request=(body,auth=true)=>({
  method:'POST',
  headers:{
   origin:'https://blofyplayer.com','sec-fetch-site':'same-origin',
   'content-type':'application/json',
   ...(auth?{cookie:'__Host-blofy_customer='+('X'.repeat(43))}:{})
  },body,socket:{remoteAddress:'127.0.0.1'}
 });
 return {handler,sql,call:async(body,auth=true)=>{
  const res={};
  await handler(request(body,auth),res,{pathname:'/api/v1/store/account/extract-xtream'});
  return res;
 }};
}
test('used app code is retrievable only to verified owner of same code',async()=>{
 const f=customerFixture();
 const response=await f.call({code,acknowledge:true});
 assert.equal(response.status,200);
 assert.equal(response.body.recovered,true);
 assert.equal(response.body.universalExtraction,true);
 assert.equal(response.body.originalVoucherPreserved,true);
 assert.equal(response.body.credentials.password,'A_SecretTest123');
 assert.equal(response.body.credentials.username,'ClientSecure12');
 assert.ok(response.body.credentials.m3uUrl.includes('/get.php?'));
 assert.equal(response.body.account.activatedAt,now);
 assert.match(response.headers['cache-control'],/no-store/);
 assert.equal(f.sql.some(row=>/UPDATE blofy_xtream_gateway/.test(row.query)),false);
});
test('an unlinked code, wrong code, or missing login cannot disclose credentials',async()=>{
 const foreign=await customerFixture({owner:false}).call({code,acknowledge:true});
 assert.equal(foreign.status,404);
 const incorrect=await customerFixture().call({code:'11118888',acknowledge:true});
 assert.equal(incorrect.status,404);
 const guest=await customerFixture().call({code,acknowledge:true},false);
 assert.equal(guest.status,401);
 assert.ok(!JSON.stringify(foreign).includes('A_SecretTest123'));
 assert.ok(!JSON.stringify(incorrect).includes('A_SecretTest123'));
});
test('expired, inactive and not-yet-activated codes cannot recover secrets',async()=>{
 for(const options of [{enabled:false},{expiry:Date.now()-86400000},{redeemed:false}]){
  const response=await customerFixture(options).call({code,acknowledge:true});
  assert.equal(response.status,409);
  assert.equal(response.body.credentials,undefined);
 }
});
test('unified web UI uses no local storage and routes only verified recovery',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const html=read('web/stream-activate.html');
 const js=read('web/stream-activate.js');
 const gateway=read('src/xtream-gateway-hook.mjs');
 const account=read('src/store-customer-account.mjs');
 assert.match(html,/BLOFY STREAM/);
 assert.match(html,/Xtream/);
 assert.match(html,/confirm-start/);
 assert.match(html,/id="result-title"/);
 assert.match(js,/\/api\/v1\/stream\/extract/);
 assert.match(js,/\/api\/v1\/store\/account\/extract-xtream/);
 assert.match(js,/credentials:owned\?'same-origin':'omit'/);
 assert.match(js,/visibilitychange/);
 assert.match(js,/pagehide/);
 assert.match(js,/SECRET_DISPLAY_MS=90\*1000/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|console\.log|\?code=/);
 assert.doesNotThrow(()=>new Script(js));
 assert.match(gateway,/webDualAccess:true/);
 assert.match(gateway,/streamCodeLimiter\.consume/);
 assert.match(account,/PAID_OWNED_VOUCHERS_SQL/);
});

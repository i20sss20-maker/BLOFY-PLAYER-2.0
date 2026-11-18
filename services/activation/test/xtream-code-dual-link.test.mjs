import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createStreamCodeXtreamLink} from '../src/xtream-code-dual-link.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';
import {encryptStreamCode} from '../src/xtream-code-vault.mjs';
import {encryptGatewayAccountPassword} from '../src/xtream-account-vault.mjs';

const KEY='be'.repeat(32);
const SALEH='d2bb0397-1c56-4751-adc9-1a17758022f6';
const OTHER='d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a';
const ACCOUNT='49e7e9e5-4c18-4caa-a14e-e51ab39d8ba9';
const VOUCHER='c8081f67-c405-4f08-a512-7d188bf1ae1b';
const NOW=Date.parse('2026-11-18T10:00:00.000Z');
const expiry=new Date(NOW+90*86400000).toISOString();
const code='12345678';
const cred='QwerTy123456';
const account=()=>({
 id:ACCOUNT,label:'BLOFY STREAM',enabled:true,source_id:SALEH,
 max_connections:2,username:'BOB98765',
 credential_vault:encryptGatewayAccountPassword(ACCOUNT,cred,KEY),
 created_at:new Date(NOW-12*86400000).toISOString(),expires_at:expiry
});
const voucher=()=>({
 id:VOUCHER,account_id:ACCOUNT,code_channel:'xtream',
 code_hash:streamCodeProof(code,KEY),
 code_vault:encryptStreamCode(VOUCHER,code,KEY),
 redeemed_at:new Date(NOW-10*86400000).toISOString(),
 expires_at:expiry,revoked_at:null,dual_access_enabled:false
});
function mockDatabase(handle){
 const calls=[];
 const query=async(sql,values=[])=>{
  calls.push({sql,values});
  return handle(sql,values);
 };
 const db={query,release(){}};
 return {pool:{query,connect:async()=>db},calls};
}

test('redeemed BLOFY voucher reveals ONLY its existing local Xtream account, no new subscription',async()=>{
 const acc=account(),v=voucher();
 const {pool,calls}=mockDatabase(sql=>{
  if(sql.includes('LEFT JOIN blofy_xtream_gateway_accounts'))
    return {rows:[{...acc,...v,voucher_id:VOUCHER,voucher_expiry:expiry,
      id:ACCOUNT,credential_vault:acc.credential_vault,
      code_channel:'app',redeemed_at:v.redeemed_at}]};
  throw Error('unexpected_query');
 });
 const svc=createStreamCodeXtreamLink({pool,keyHex:KEY,clock:()=>NOW});
 const result=await svc.codeToXtream({code,serverUrl:'https://blofyplayer.com'});
 assert.equal(result.ok,true);
 assert.equal(result.created,false);
 assert.equal(result.accountId,ACCOUNT);
 assert.deepEqual({username:result.credentials.username,password:result.credentials.password},
  {username:'BOB98765',password:cred});
 assert.ok(result.credentials.m3uUrl.includes('/get.php?'));
 assert.ok(result.credentials.m3uUrl.includes('username=BOB98765'));
 assert.equal(calls.length,1);
 assert.doesNotMatch(calls[0].sql,/INSERT|UPDATE/);
 assert.deepEqual(calls[0].values,[streamCodeProof(code,KEY)]);
});
test('Xtream -> SAME original code enables app access and never issues a new credential',async()=>{
 const acc=account(),v=voucher();
 const {pool,calls}=mockDatabase(sql=>{
  if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE'))return{rows:[acc]};
  if(sql.includes('FROM blofy_xtream_gateway_duration_codes'))return{rows:[v]};
  if(sql.includes('UPDATE blofy_xtream_gateway_duration_codes'))
    return{rows:[],rowCount:1};
  return{rows:[],rowCount:1};
 });
 const svc=createStreamCodeXtreamLink({pool,keyHex:KEY,clock:()=>NOW});
 const result=await svc.xtreamToCode({accountId:ACCOUNT});
 assert.equal(result.code,code);
 assert.equal(result.created,false);
 assert.equal(result.expiresAt,new Date(expiry).getTime());
 assert.equal(result.subscriptionUnchanged,true);
 assert.equal(calls.filter(x=>x.sql.includes('INSERT')).length,0);
 assert.equal(calls.filter(x=>/^UPDATE\s/i.test(x.sql)).length,1);
 assert.match(calls.find(x=>/^UPDATE\s/i.test(x.sql)).sql,/dual_access_enabled=TRUE/);
 assert.equal(calls.at(-1).sql,'COMMIT');
});
test('standalone Xtream -> one device-bindable code, same account and exact expiry',async()=>{
 const acc=account();
 const {pool,calls}=mockDatabase(sql=>{
  if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE'))return{rows:[acc]};
  if(sql.includes('FROM blofy_xtream_gateway_duration_codes'))return{rows:[]};
  if(sql.includes('COUNT(*)'))return{rows:[{count:4}]};
  if(sql.includes('INSERT INTO blofy_xtream_gateway_duration_codes'))
    return{rows:[{id:VOUCHER}]};
  return{rows:[],rowCount:1};
 });
 const svc=createStreamCodeXtreamLink({pool,keyHex:KEY,clock:()=>NOW,
   randomBytes:n=>Buffer.alloc(n,0),uuid:()=>VOUCHER});
 const result=await svc.xtreamToCode({accountId:ACCOUNT});
 assert.equal(result.created,true);
 assert.equal(result.accountId,ACCOUNT);
 assert.equal(result.expiresAt,new Date(expiry).getTime());
 assert.equal(result.code,'00000000');
 const inserted=calls.find(x=>x.sql.includes('INSERT INTO blofy_xtream_gateway_duration_codes'));
 assert.ok(inserted);
 assert.match(inserted.sql,/dual_access_enabled,account_id,redeemed_at,expires_at/);
 assert.equal(inserted.values[8],ACCOUNT);
 assert.equal(new Date(inserted.values[10]).getTime(),new Date(expiry).getTime());
 assert.ok(!calls.some(x=>/INSERT INTO blofy_xtream_gateway_accounts|UPDATE blofy_xtream_gateway_accounts/.test(x.sql)));
 assert.equal(calls.at(-1).sql,'COMMIT');
});
test('disabled, unlimited, expired, or wrong-source Xtream accounts never get implicit vouchers',async()=>{
 for(const change of [{enabled:false},{expires_at:null},
  {expires_at:new Date(NOW-100).toISOString()},{source_id:OTHER}]){
  const {pool,calls}=mockDatabase(sql=>{
   if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE'))
     return{rows:[{...account(),...change}]};
   return{rows:[],rowCount:1};
  });
  const svc=createStreamCodeXtreamLink({pool,keyHex:KEY,clock:()=>NOW});
  await assert.rejects(svc.xtreamToCode({accountId:ACCOUNT}),/stream_link_/);
  assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
  assert.ok(!calls.some(x=>x.sql.includes('INSERT INTO blofy_xtream_gateway_duration_codes')));
 }
});
test('unredeemed code can not mint a new Xtream account or start a clock',async()=>{
 const {pool,calls}=mockDatabase(sql=>({
  rows:[{...account(),...voucher(),voucher_id:VOUCHER,
    redeemed_at:null,account_id:null,id:null}]
 }));
 const svc=createStreamCodeXtreamLink({pool,keyHex:KEY,clock:()=>NOW});
 await assert.rejects(svc.codeToXtream({code,serverUrl:'https://blofyplayer.com'}),
  /stream_link_activate_first/);
 assert.equal(calls.length,1);
});
test('linked routes and device rules are administratively scoped and never reset expiry',async()=>{
 const gateway=await readFile(new URL('../src/xtream-gateway-hook.mjs',import.meta.url),'utf8');
 const duration=await readFile(new URL('../src/xtream-duration-codes.mjs',import.meta.url),'utf8');
 const relogin=await readFile(new URL('../src/xtream-code-relogin.mjs',import.meta.url),'utf8');
 const ui=await readFile(new URL('../web/xtream-gateway-admin.js',import.meta.url),'utf8');
 assert.ok(gateway.indexOf('if (!requireAdmin(req, res)) return;')<
   gateway.indexOf("'/api/v1/admin/xtream-gateway/link/code-to-xtream'"));
 assert.match(gateway,/link\/xtream-to-code/);
 assert.match(duration,/dual_access_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
 assert.match(duration,/row\.dual_access_enabled===true/);
 assert.match(duration,/transferPending=appOnly&&/);
 assert.match(relogin,/row\.dual_access_enabled!==true/);
 assert.match(ui,/استخراج كود BLOFY/);
 assert.match(ui,/استخراج Xtream من نفس الكود/);
 assert.match(ui,/ربط نفس الحساب بكود BLOFY/);
 assert.match(ui,/accountId:String\(items\[index\]\?\.id\|\|''\)/);
 assert.match(ui,/link\/xtream-to-code/);
 // Old path would create a SECOND independent code on an external host.
 assert.doesNotMatch(ui,/\/api\/v1\/admin\/blofy-codes/);
 assert.doesNotMatch(duration,/UPDATE blofy_xtream_gateway_accounts SET expires_at=NOW/);
});

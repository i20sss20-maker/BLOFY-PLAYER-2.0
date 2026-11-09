import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamDurationCodes,streamCodeProof} from '../src/xtream-duration-codes.mjs';

const keyHex='a'.repeat(64);
const now=Date.parse('2026-11-09T04:15:00Z');
const code='24681357'; // test fixture only, never a customer voucher
function fixture({label='BLOFY STREAM',sold=false,createdAt='2026-11-09T04:00:00Z',
  channel='xtream',redeemed=false,rawCode=code}={}){
 const row={id:'d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a',
   label,code_hash:streamCodeProof(rawCode,keyHex),code_hint:'83••••04',
   source_id:null,duration_days:30,max_connections:1,
   code_channel:channel,sold_at:sold?new Date(createdAt):null,
   created_at:new Date(createdAt),redeemed_at:redeemed?new Date(createdAt):null,
   revoked_at:null,account_id:null,expires_at:null,redeemed_device_hash:null};
 const accounts=[],sqlLog=[];
 async function query(sql,args=[]){
   sqlLog.push(sql);
   if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
   if(sql.includes('FROM blofy_xtream_gateway_duration_codes')&&sql.includes('FOR UPDATE')){
     return {rows:args[0]===row.code_hash?[row]:[]};
   }
   if(sql.includes("SET code_channel='app'")){
     if(row.redeemed_at||row.revoked_at||row.sold_at)return {rows:[]};
     row.code_channel='app';return {rows:[{code_channel:'app'}]};
   }
   if(sql.includes('INSERT INTO blofy_xtream_gateway_accounts')){
     accounts.push(args);return {rows:[]};
   }
   if(sql.includes('SET redeemed_at')){
     Object.assign(row,{redeemed_at:args[1],expires_at:args[2],
       account_id:args[3],redeemed_device_hash:args[4]});
     return {rows:[row]};
   }
   if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE id=$1'))
     return {rows:accounts.filter(a=>a[0]===args[0]).map(a=>({
       id:a[0],username:a[2],credential_vault:a[7],
       enabled:true,expires_at:a[5]}))};
   throw Error('unexpected SQL: '+sql);
 }
 const pool={query,async connect(){return {query,release(){}}}};
 return {row,accounts,sqlLog,system:createStreamDurationCodes({pool,keyHex,clock:()=>now})};
}
test('new, unsold numeric BLOFY STREAM voucher from old panel activates in app',async()=>{
 const state=fixture();
 const first=await state.system.redeem(code,'https://blofyplayer.com',
   {appOnly:true,deviceKey:'b'.repeat(64)});
 assert.equal(first.ok,true);
 assert.equal(first.tokenType,'Bearer');
 assert.equal(first.credentials,undefined);
 assert.equal(first.account.activatedAt,now);
 assert.equal(first.account.expiresAt,now+30*86400000);
 assert.equal(state.row.code_channel,'app');
 assert.equal(state.accounts.length,1);
 const retry=await state.system.redeem(code,'https://blofyplayer.com',
   {appOnly:true,deviceKey:'b'.repeat(64)});
 assert.equal(retry.recovered,true);
 assert.equal(retry.accessToken,first.accessToken);
 assert.equal(retry.account.expiresAt,first.account.expiresAt);
 await assert.rejects(state.system.redeem(code,'https://blofyplayer.com'),
   /stream_code_wrong_product/);
 assert.equal(state.accounts.length,1);
});
test('legacy Xtream products cannot silently migrate if sold or renamed',async()=>{
 for(const args of [
   {sold:true},
   {label:'Xtream legacy'},
   {createdAt:'2026-11-08T15:00:00Z'},
   {redeemed:true},
   {rawCode:'AB12AB12AB12AB12AB12AB12'}
 ]){
   const state=fixture(args);
   await assert.rejects(
     state.system.redeem(args.rawCode||code,'https://blofyplayer.com',
       {appOnly:true,deviceKey:'c'.repeat(64)}),
     /stream_code_wrong_product/);
   assert.equal(state.row.code_channel,'xtream');
   assert.equal(state.accounts.length,0);
   assert.equal(state.sqlLog.filter(s=>s.includes("SET code_channel='app'")).length,0);
 }
});

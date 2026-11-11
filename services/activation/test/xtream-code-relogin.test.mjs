import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamRelogin} from '../src/xtream-code-relogin.mjs';
import {streamDeviceProof,hasApprovedRelogin} from '../src/xtream-code-device-binding.mjs';
import {streamCodeProof} from '../src/xtream-duration-codes.mjs';

const secret='a'.repeat(64),code='24681357',original='c'.repeat(64),replacement='d'.repeat(64);
const now=Date.parse('2026-11-11T02:00:00Z');
function mock(){
 const row={id:'d9b0fcf1-0b7e-4209-b281-2b5cf1cef09a',
  code_hash:streamCodeProof(code,secret),code_channel:'app',
  redeemed_at:new Date(now-86400000),
  redeemed_device_hash:streamDeviceProof(original,secret),
  account_id:'d2bb0397-1c56-4751-adc9-1a17758022f6',
  expires_at:new Date(now+86400000),revoked_at:null};
 const account={enabled:true,expires_at:row.expires_at},events=[];
 let time=now;
 async function query(sql,args=[]){
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
  if(sql.includes('FROM blofy_xtream_gateway_duration_codes')&&sql.includes('FOR UPDATE'))
   return {rows:args[0]===row.code_hash?[row]:[]};
  if(sql.includes('FROM blofy_xtream_gateway_accounts WHERE id=$1 FOR UPDATE'))
   return {rows:[account]};
  if(sql.includes('SET relogin_device_hash=$2,relogin_request_hash=$3')){
   Object.assign(row,{relogin_device_hash:args[1],relogin_request_hash:args[2],
    relogin_requested_at:args[3],relogin_approved_at:null,relogin_expires_at:args[4]});
   return {rowCount:1,rows:[]};
  }
  if(sql.includes('SET relogin_approved_at=$2,relogin_expires_at=$3')){
   Object.assign(row,{relogin_approved_at:args[1],relogin_expires_at:args[2]});
   return {rowCount:1,rows:[]};
  }
  if(sql.includes('INSERT INTO blofy_xtream_gateway_code_events')){
   events.push(args);return {rowCount:1,rows:[]};
  }
  throw Error('Unexpected SQL');
 }
 const pool={async connect(){return {query,release(){}}}};
 const manager=createStreamRelogin({pool,keyHex:secret,
  clock:()=>time,randomInt:()=>514297});
 return {row,account,manager,events,advance:ms=>{time+=ms},now:()=>time};
}
test('same device needs no recovery and original binding stays unchanged',async()=>{
 const f=mock(),x=await f.manager.request({code,deviceKey:original});
 assert.equal(x.alreadyAuthorized,true);
 assert.equal(f.row.redeemed_device_hash,streamDeviceProof(original,secret));
});
test('new install requires a short-lived approval code, never another voucher',async()=>{
 const f=mock();
 const requested=await f.manager.request({code,deviceKey:replacement});
 assert.equal(requested.requestCode,'514297');
 assert.equal(requested.expiresAt,f.now()+20*60_000);
 assert.equal(f.row.redeemed_device_hash,streamDeviceProof(original,secret));
 assert.equal(hasApprovedRelogin(f.row,streamDeviceProof(replacement,secret),f.now()),false);
 await assert.rejects(f.manager.approve({code,requestCode:'000000'}),
  /stream_code_relogin_pin_incorrect/);
 const approved=await f.manager.approve({code,requestCode:'514297'});
 assert.equal(approved.expiresUnchanged,true);
 assert.equal(hasApprovedRelogin(f.row,streamDeviceProof(replacement,secret),f.now()),true);
 assert.equal(f.events.length,1);
});
test('expired request, revoked or disabled subscription cannot be recovered',async()=>{
 const f=mock();await f.manager.request({code,deviceKey:replacement});
 await assert.rejects(f.manager.request({code,deviceKey:'e'.repeat(64)}),
  /stream_code_relogin_already_pending/);
 f.advance(21*60_000);
 await assert.rejects(f.manager.approve({code,requestCode:'514297'}),
  /stream_code_relogin_request_unavailable/);
 f.row.revoked_at=new Date(f.now());
 await assert.rejects(f.manager.request({code,deviceKey:replacement}),
  /stream_code_relogin_unavailable/);
});

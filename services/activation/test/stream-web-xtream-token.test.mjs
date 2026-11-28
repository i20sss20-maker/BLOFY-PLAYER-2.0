import test from 'node:test';
import assert from 'node:assert/strict';
import {createXtreamWebToken,verifyXtreamWebToken,eligibleXtreamWebAccount} from '../src/stream-web-xtream-token.mjs';
import {verifyStreamAppToken} from '../src/xtream-code-app-token.mjs';
const now=Date.parse('2026-11-28T00:00:00Z'),key='a'.repeat(64),id='00000000-0000-4000-8000-000000000000';
const account={id,enabled:true,password_proof:'b'.repeat(64),expires_at:'2026-12-02T00:00:00Z'};
const voucher={account_id:id,code_channel:'xtream',dual_access_enabled:false,code_hash:'c'.repeat(64),redeemed_device_hash:null,redeemed_at:'2026-11-27',expires_at:'2026-12-01',revoked_at:null};
test('standalone Xtream token authenticates existing account and caps expiry by voucher',()=>{
 const session=createXtreamWebToken(account,voucher,key,now);
 assert.ok(session);assert.equal(session.expiresAt,Date.parse(voucher.expires_at));
 assert.equal(verifyXtreamWebToken(session.accessToken,account,voucher,key,now).id,id);
 assert.equal(verifyStreamAppToken(session.accessToken,{...voucher,redeemed_device_hash:'d'.repeat(64)},key),false);
 assert.ok(createXtreamWebToken(account,null,key,now));
});
test('password rotation, account disable, expiration and voucher reclassification invalidate token',()=>{
 const token=createXtreamWebToken(account,voucher,key,now).accessToken;
 for(const a of [{...account,password_proof:'e'.repeat(64)},{...account,enabled:false},{...account,expires_at:'2026-11-27'},{...account,expires_at:null}])assert.equal(verifyXtreamWebToken(token,a,voucher,key,now),null);
 for(const v of [{...voucher,code_channel:'app'},{...voucher,dual_access_enabled:true},{...voucher,redeemed_device_hash:'d'.repeat(64)},{...voucher,revoked_at:'2026-11-27'},{...voucher,expires_at:'2026-11-27'}])assert.equal(eligibleXtreamWebAccount(account,v,now),null);
 assert.equal(verifyXtreamWebToken(token,account,null,key,now),null);
 assert.equal(verifyXtreamWebToken(token,account,voucher,'f'.repeat(64),now),null);
});

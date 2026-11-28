import test from 'node:test';
import assert from 'node:assert/strict';
import {loginBoundStreamAccount} from '../src/stream-web-bound-login.mjs';
import {streamDeviceProof} from '../src/xtream-code-device-binding.mjs';
import {verifyStreamAppToken} from '../src/xtream-code-app-token.mjs';
const keyHex='a'.repeat(64),deviceKey='b'.repeat(64),now=Date.parse('2026-11-28T00:00:00Z'),id='00000000-0000-4000-8000-000000000000';
const account={id,enabled:true,expires_at:'2026-12-01T00:00:00Z'};
const voucher={account_id:id,code_hash:'c'.repeat(64),redeemed_device_hash:streamDeviceProof(deviceKey,keyHex),redeemed_at:'2026-11-27T00:00:00Z',expires_at:'2026-11-30T00:00:00Z',revoked_at:null};
const input={username:'fixture',password:'synthetic',deviceKey};
function fixture(a=account,v=voucher){return {keyHex,now,authenticate:async(u,p)=>u===input.username&&p===input.password?a:null,findVoucher:async()=>v}}
test('existing device binding can reuse exact original STREAM capability and expiry',async()=>{
 const r=await loginBoundStreamAccount(input,fixture());
 assert.equal(r.ok,true);assert.equal(verifyStreamAppToken(r.accessToken,voucher,keyHex),true);assert.equal(r.expiresAt,Date.parse(voucher.expires_at));
 assert.deepEqual(Object.keys(r).sort(),['accessToken','expiresAt','ok']);
});
test('different device, invalid password, standalone account and revoked/expired voucher fail without writes',async()=>{
 for(const [i,f] of [[{...input,deviceKey:'d'.repeat(64)},fixture()],[{...input,password:'wrong'},fixture()],[input,fixture(account,null)],[input,fixture({...account,enabled:false})],[input,fixture(account,{...voucher,revoked_at:'2026-11-27'})],[input,fixture(account,{...voucher,expires_at:'2026-11-27'})]])assert.equal((await loginBoundStreamAccount(i,f)).ok,false);
});

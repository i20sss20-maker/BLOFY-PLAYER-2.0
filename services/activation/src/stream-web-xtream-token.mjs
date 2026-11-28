// Distinct HMAC domain for first-party Xtream credentials. This does not
// create or modify vouchers, claim a device, or authorize an app-only account.
import crypto from 'node:crypto';
import {parseStreamAppToken} from './xtream-code-app-token.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/i;
export function eligibleXtreamWebAccount(account,voucher,now=Date.now()){
 if(!account||account.enabled!==true||!UUID.test(String(account.id||''))||!HEX.test(String(account.password_proof||'')))return null;
 const accountExpiry=account.expires_at?Date.parse(account.expires_at):NaN;
 // A bounded subscription is required for this pilot; perpetual accounts
 // remain on their existing Xtream authentication path.
 if(!Number.isFinite(accountExpiry)||accountExpiry<=now)return null;
 if(!voucher)return {expiresAt:accountExpiry,voucherTag:'none'};
 if(voucher.account_id!==account.id||voucher.code_channel!=='xtream'||voucher.dual_access_enabled!==false||
    voucher.redeemed_device_hash||voucher.revoked_at||!voucher.redeemed_at||!HEX.test(String(voucher.code_hash||'')))return null;
 const voucherExpiry=Date.parse(voucher.expires_at);
 if(!Number.isFinite(voucherExpiry)||voucherExpiry<=now)return null;
 return {expiresAt:Math.min(accountExpiry,voucherExpiry),voucherTag:voucher.code_hash};
}
export function createXtreamWebToken(account,voucher,keyHex,now=Date.now()){
 const eligibility=eligibleXtreamWebAccount(account,voucher,now);
 if(!eligibility||!HEX.test(String(keyHex||'')))return null;
 const mac=crypto.createHmac('sha256',Buffer.from(keyHex,'hex')).update(JSON.stringify([
  'BLOFY-XTREAM-WEB-CREDENTIAL-V1',account.id,account.password_proof,eligibility.voucherTag,eligibility.expiresAt
 ])).digest('base64url');
 return {accessToken:'v1.'+account.id+'.'+mac,expiresAt:eligibility.expiresAt};
}
export function verifyXtreamWebToken(token,account,voucher,keyHex,now=Date.now()){
 const parsed=parseStreamAppToken(token);
 if(!parsed||parsed.accountId!==account?.id)return null;
 const expected=createXtreamWebToken(account,voucher,keyHex,now);
 if(!expected)return null;
 const a=Buffer.from(token),b=Buffer.from(expected.accessToken);
 return a.length===b.length&&crypto.timingSafeEqual(a,b)?{...account,expires_at:new Date(expected.expiresAt)}:null;
}

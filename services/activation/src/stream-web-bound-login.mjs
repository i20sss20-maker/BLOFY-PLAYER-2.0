import {streamDeviceProof} from './xtream-code-device-binding.mjs';
import {createStreamAppToken} from './xtream-code-app-token.mjs';
// Read-only bridge for an existing, device-bound STREAM entitlement.
// Standalone Xtream accounts require a distinct session design; never mint
// a STREAM voucher or alter device bindings just because a password is valid.
export async function loginBoundStreamAccount({username,password,deviceKey},{authenticate,findVoucher,keyHex,now=Date.now()}){
 const fail={ok:false,error:'direct_login_unavailable'};
 if(typeof username!=='string'||!username||username.length>256||typeof password!=='string'||!password||password.length>256||
    /[\x00-\x1f\x7f]/.test(username+password)||typeof deviceKey!=='string'||!/^[a-f0-9]{64}$/.test(deviceKey))return fail;
 const proof=streamDeviceProof(deviceKey,keyHex);if(!proof)return fail;
 const account=await authenticate(username,password);
 if(!account||account.enabled!==true||!account.expires_at||!(Date.parse(account.expires_at)>now))return fail;
 const voucher=await findVoucher(account.id,proof);
 if(!voucher||voucher.account_id!==account.id||voucher.redeemed_device_hash!==proof||voucher.revoked_at||!voucher.redeemed_at||
    !voucher.expires_at||!(Date.parse(voucher.expires_at)>now))return fail;
 try{
  const accessToken=createStreamAppToken(voucher,keyHex);
  return {ok:true,accessToken,expiresAt:Math.min(Date.parse(account.expires_at),Date.parse(voucher.expires_at))}
 }catch{return fail}
}
